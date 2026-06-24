import { prisma } from "@/lib/prisma"
import {
  isPendingOcrContent,
  shouldRunMarkdownOcr,
} from "@/lib/pdf-engine"
import { analyzeSectionContent, generateCourseNotes, generateFlashcards, generateQuestions, setFileUrisMap, auditNotesAgainstSourceSpecific, validateQuestionsWithSolver, validateFlashcardsWithSolver, verifyNotesAgainstSource, needsBilingualStudyItems, translateFlashcardsToEnglish, translateQuestionsToEnglish, validateBilingualPairs, ApiQuotaExhaustedError, OcrChunkRateLimitError } from "@/lib/ai-service"
import { resolveRequiresQuestions } from "@/lib/glossary-utils"
import { getExamConfig, getCourseBySlug } from "@/lib/course-data"
import {
  getDocumentNoteInstructions,
  getDocumentProcessingProfile,
} from "@/lib/document-processing-profile"
import {
  getNotesGenerationPhaseLabel,
  isProfessionalProgram,
} from "@/lib/program-catalog"
import {
  isCancelled,
  releaseProcessing,
} from "@/lib/process-registry"
import {
  MAX_NOTES_GENERATION_RETRIES,
  MAX_OCR_ROUTE_ATTEMPTS,
  MAX_QUOTA_FAILURES_PER_SECTION,
  MAX_SECTION_OUTER_RETRIES,
} from "@/lib/quota-guard"
import {
  mergeVerificationIssues,
} from "@/lib/section-quality-gates"

// ==================== BACKGROUND PROCESSING ====================
// HTTP response döndükten sonra Node.js event loop'unda çalışmaya devam eder.
// Timeout problemi olmaz çünkü artık HTTP request'e bağlı değil.

/** Eski işçi «Devam Ettir» sonrası yeni oturumun durumunu ezmesin diye yalnızca hâlâ processing iken yazar. */
async function finalizeCourseStatusIfStillProcessing(
  slug: string,
  status: "ready" | "error" | "paused" | "uploaded",
): Promise<boolean> {
  const result = await prisma.course.updateMany({
    where: { slug, status: "processing" },
    data: { status, updatedAt: new Date() },
  })
  if (result.count === 0) {
    console.log(`[BG] ⏭️ Durum güncellenmedi (${status}) — başka işlem devralmış: ${slug}`)
  }
  return result.count > 0
}

export async function processInBackground(slug: string, course: any, forceRetry: boolean = false) {
  try {
    let fileUrisReady = false

    const staticMeta = getCourseBySlug(slug)
    const programSlug = course.program?.slug || ""
    const aiMode = course.program?.aiMode || "general"
    const documentProfile = getDocumentProcessingProfile({
      slug,
      name: course.name,
      sourceKind: staticMeta?.sourceKind,
      sourceKindLabel: staticMeta?.sourceKindLabel,
      gridGroup: staticMeta?.gridGroup,
      programSlug,
      aiMode,
      totalPages: course.totalPages ?? 0,
    })
    const isProfessional = isProfessionalProgram(programSlug)
    const shouldStop = async (): Promise<boolean> => {
      if (isCancelled(slug, course.name)) return true
      
      // Otomatik tarayıcı kapatma (Heartbeat) kontrolü kaldırıldı.
      // Sadece admin panelinden 'Duraklat'a basılırsa duracak.

      try {
        const fresh = await prisma.course.findUnique({
          where: { slug },
          select: { status: true },
        })
        return fresh?.status === "paused" || fresh?.status === "error"
      } catch {
        return false
      }
    }
    const ensureFileUrisForNotes = async () => {
      if (fileUrisReady) return
      const { ensureGeminiFileUris } = await import("@/lib/gemini-file-helper")
      const { uriMap, updated: updatedUris } = await ensureGeminiFileUris(
        course.pdfPath || "",
        course.geminiFileUris,
        course.slug || slug,
      )
      setFileUrisMap(uriMap)
      if (updatedUris) {
        await prisma.course.update({
          where: { id: course.id },
          data: {
            geminiFileUri: uriMap["0"] || course.geminiFileUri,
            geminiFileUris: JSON.stringify(uriMap),
          },
        })
        console.log(`[BG] 💾 PDF fileUri'ler not üretimi için hazırlandı.`)
      }
      fileUrisReady = true
    }

    const savedSections = await prisma.section.findMany({
      where: { courseId: course.id, processed: false },
      orderBy: { order: "asc" }
    })

    const totalSections = await prisma.section.count({ where: { courseId: course.id } })
    const alreadyDone = totalSections - savedSections.length
    console.log(`[BG] AI: ${savedSections.length} kalan (${alreadyDone}/${totalSections} bitti)`)

    // Limit — kota israfını önlemek için düşürüldü (eski: 15)
    const MAX_RETRIES = MAX_NOTES_GENERATION_RETRIES;
    const sourceMode = getExamConfig(programSlug)?.sourceMode ?? "strict"
    let hasCriticalError = false

    for (let sIdx = 0; sIdx < savedSections.length; sIdx++) {
      if (await shouldStop()) {
        console.log(`[BG] 🛑 İPTAL/DURAKLATMA: ${course.name} işleme süreci durduruluyor...`);
        break;
      }
      const section = savedSections[sIdx]
      const fullCourseName = `${course.program?.name || ""} > ${course.name}`.replace(/^\s*>\s*/, "");

      // OCR bekleyen taranmış bölümler kısa placeholder içerir — atlanmamalı
      if (section.rawContent.length < 100 && !isPendingOcrContent(section.rawContent)) {
        try { await prisma.section.update({ where: { id: section.id }, data: { processed: true } }) } catch { }
        continue
      }

      let sectionIssuesObj: any = {}
      try { sectionIssuesObj = JSON.parse(section.verificationIssues || "{}") } catch {}
      // Eskiden burada needsUserAction === true ise döngü atlanıyordu (Kaldırıldı)

      const applySectionIssuesPatch = async (
        patch: Record<string, unknown>,
        extraData?: Record<string, unknown>,
      ) => {
        sectionIssuesObj = mergeVerificationIssues(sectionIssuesObj, patch)
        try {
          await prisma.section.update({
            where: { id: section.id },
            data: { ...extraData, verificationIssues: JSON.stringify(sectionIssuesObj) },
          })
        } catch { /* ignore */ }
      }

      let success = false
      let sectionRetries = 0
      const maxSectionRetries = MAX_SECTION_OUTER_RETRIES

      while (!success && sectionRetries < maxSectionRetries) {
        if (await shouldStop()) {
          console.log(`[BG] 🛑 İPTAL/DURAKLATMA: Alt döngü kırılıyor...`);
          success = false;
          break;
        }
        if (sectionRetries > 0) {
          console.log(`[BG] 🔄 [${section.title}] Geçici kota aşımı engeli nedeniyle 60 saniye bekleniyor... (Bölüm Denemesi #${sectionRetries + 1}/${maxSectionRetries})`)
          await new Promise(r => setTimeout(r, 60000))
        }

        // Bölüm işleme ana try-catch bloğu
        try {
          console.log(`[BG] [${sIdx + 1 + alreadyDone}/${totalSections}] ${section.title} - İŞLEME BAŞLADI (Deneme #${sectionRetries + 1}/${maxSectionRetries})`)

          const skipOcr = course.pdfPath && !shouldRunMarkdownOcr(section.rawContent)
          const openingPhase = skipOcr
            ? (isProfessional
                ? "Çalışma notları yazılıyor — bu birkaç dakika sürebilir"
                : "Ders notları yazılıyor — bu birkaç dakika sürebilir")
            : `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama 1: Ham İçerik Okunuyor (Deneme #${sectionRetries + 1})`
          try { await applySectionIssuesPatch({ currentMicroPhase: openingPhase }) } catch { }

          let notes = section.notes || ""
          let currentScore = section.verificationScore || 0
          let bestScore = currentScore // En yüksek başarılı doğrulama skoru — kota hatalarında korunur
          let bestNotes = notes // En yüksek skora sahip notlar
          let bestVerification: any = null // En iyi metne ait geri bildirimler
          let lastVerification: any = null

          if (sectionIssuesObj && (sectionIssuesObj.missingTopics || sectionIssuesObj.issues)) {
            const restoredVerification = {
              score: currentScore,
              missingTopics: sectionIssuesObj.missingTopics || [],
              issues: sectionIssuesObj.issues || [],
              suggestions: sectionIssuesObj.suggestions || [],
              inspectorFindings: sectionIssuesObj.inspectorFindings || []
            }
            lastVerification = restoredVerification
            bestVerification = restoredVerification
            console.log(`[BG] 🧠 Hafıza Geri Yüklendi: Kaldığı yerden %${currentScore} skor ile devam ediliyor.`)
          }
          
          let notesAttemptSuccess = false
          let startingAttempt = 1
          let attemptHistory: any[] = []
          
          if (sectionIssuesObj && sectionIssuesObj.currentAttempt) {
            startingAttempt = sectionIssuesObj.currentAttempt + 1 // Kaldığı denemeden bir sonrakine geç
          }
          if (sectionIssuesObj && sectionIssuesObj.attemptHistory) {
            attemptHistory = sectionIssuesObj.attemptHistory
          }
          
          let quotaFailures = 0
          const MAX_QUOTA_FAILURES = MAX_QUOTA_FAILURES_PER_SECTION

          // ==================== MARKDOWN OCR (GÖRSEL OKUMA) ====================
          // Tüm PDF'ler (aranabilir dahil): extractPerfectMarkdownOCR — şema/resim yakalamak için zorunlu.
          // Devam Ettir: [MARKDOWN_OCR_SUCCESS] damgası varsa atlanır (yeniden OCR israfı yok).
          if (course.pdfPath && shouldRunMarkdownOcr(section.rawContent)) {
            console.log(`[BG] 🚀 Markdown OCR Katmanı: ${section.title} (Sayfa ${section.pageStart}-${section.pageEnd}) için PDF parçalanarak işleniyor...`);
            const ocrPhasePrefix = `${sIdx + 1 + alreadyDone}/${totalSections}.`;
            const touchHeartbeat = async (microPhase: string) => {
              try {
                await applySectionIssuesPatch({
                  currentMicroPhase: `${ocrPhasePrefix} ${microPhase}`,
                })
                await prisma.course.update({
                  where: { id: course.id },
                  data: { updatedAt: new Date() },
                });
              } catch { /* ignore */ }
            };

            await touchHeartbeat("PDF Metne Çevriliyor (Markdown OCR)");

            const { extractPerfectMarkdownOCR } = await import("@/lib/ai-service");

            let ocrSuccess = false;
            let ocrAttempts = 0;
            const MAX_OCR_ATTEMPTS = MAX_OCR_ROUTE_ATTEMPTS;

            while (!ocrSuccess && ocrAttempts < MAX_OCR_ATTEMPTS) {
              ocrAttempts++;
              try {
                const pristineMarkdown = await extractPerfectMarkdownOCR(
                  course.pdfPath,
                  section.pageStart,
                  section.pageEnd,
                  `${fullCourseName} > ${section.title} (OCR)`,
                  {
                    logCourseSlug: slug,
                    onProgress: async (msg) => touchHeartbeat(msg),
                  },
                );
                if (pristineMarkdown && pristineMarkdown.includes("[MARKDOWN_OCR_SUCCESS]") && pristineMarkdown.includes("[VISUAL_OCR_COMPLETE]")) {
                  section.rawContent = pristineMarkdown;
                  await prisma.section.update({ where: { id: section.id }, data: { rawContent: section.rawContent } });
                  console.log(`[BG] ✅ Markdown OCR Tamamlandı.`);
                  ocrSuccess = true;
                } else {
                  throw new Error("OCR tamamlandı ancak [MARKDOWN_OCR_SUCCESS] damgası eksik.");
                }
              } catch (ocrErr: any) {
                if (ocrErr instanceof ApiQuotaExhaustedError) {
                  console.error(`[BG] ⛔ OCR duraklatıldı — günlük API kotası: ${ocrErr.message}`);
                  const pauseMessage = "Google günlük limiti doldu. Pasifik saatiyle gece yarısı sıfırlanır; yarın «Devam Ettir» ile yeniden başlatın.";
                  try {
                    await applySectionIssuesPatch({
                      currentMicroPhase: pauseMessage,
                      pauseReason: "quota_daily",
                      pausedAt: new Date().toISOString(),
                    })
                    await prisma.course.update({
                      where: { slug },
                      data: { status: "paused", updatedAt: new Date() },
                    });
                  } catch { /* ignore */ }
                  hasCriticalError = true;
                  break;
                }
                if (ocrErr instanceof OcrChunkRateLimitError) {
                  console.error(`[BG] ⛔ OCR yoğunluk sınırı — ders duraklatılıyor: ${ocrErr.message}`);
                  const pauseMessage = "Google yoğunluk sınırına takıldı. 5–10 dakika bekleyip tek sefer «Devam Ettir» ile yeniden deneyin.";
                  try {
                    await applySectionIssuesPatch({
                      currentMicroPhase: pauseMessage,
                      pauseReason: "ocr_rate_limit",
                      pausedAt: new Date().toISOString(),
                    })
                    await prisma.course.update({
                      where: { slug },
                      data: { status: "paused", updatedAt: new Date() },
                    });
                  } catch { /* ignore */ }
                  hasCriticalError = true;
                  break;
                }
                console.log(`[BG] ⚠️ Markdown OCR Hatası (Deneme ${ocrAttempts}/${MAX_OCR_ATTEMPTS}): ${ocrErr.message}`);
                if (ocrAttempts < MAX_OCR_ATTEMPTS) {
                  await touchHeartbeat(`OCR hatası — ${ocrAttempts}. deneme, 20 sn sonra tekrar`);
                  await new Promise(r => setTimeout(r, 20000));
                }
              }
            }

            if (hasCriticalError) break;

            if (!ocrSuccess) {
              console.error(`[BG] 🛑 Markdown OCR ${MAX_OCR_ATTEMPTS} denemede başarısız.`);
              const failMessage = "PDF metne çevrilemedi (API reddi veya bağlantı hatası). «Devam Ettir» ile tekrar deneyin.";
              try {
                await applySectionIssuesPatch({
                  currentMicroPhase: failMessage,
                  pauseReason: "ocr_failed",
                  pausedAt: new Date().toISOString(),
                })
                await prisma.course.update({
                  where: { slug },
                  data: { status: "paused", updatedAt: new Date() },
                });
              } catch { /* ignore */ }
              hasCriticalError = true;
              break;
            }
          }

          let isMufettisPassed = false;
          try {
            const v = JSON.parse(section.verificationIssues || "{}");
            isMufettisPassed = v?.stages?.mufettis === true || v?.mufettis === true;
          } catch(e) {}
          // Eğer halihazırda yüksek puanlı notlar varsa ve müfettişten de geçmişse kalite döngüsünü atla
          if (notes && notes.length > 500 && currentScore >= 98 && isMufettisPassed) {
            console.log(`[BG] 🌟 [${section.title}] Zaten kusursuz (%${currentScore}) notlara ve Müfettiş onayına sahip. Not üretimi atlanıyor, doğrudan eksik materyaller (soru/flashcard) üretilecek.`)
            notesAttemptSuccess = true
            
            // Zombi dedektörünün haksız yere tetiklenmemesi için veritabanını boş bir veriyle güncelleyip updatedAt süresini sıfırlıyoruz.
            try {
              await applySectionIssuesPatch({
                currentMicroPhase: "Hazırlık: Flashcard üretimine geçiliyor...",
              })
            } catch (e) { }
          }

          // ==================== KALİTE DÖNGÜSÜ (Not Üretimi ve Doğrulama) ====================
          // Her yeni oturumda MAX_RETRIES kadar taze hak verilir, ancak sayaç geçmişten devam eder.
          if (course.generateNotes === false) {
            console.log(`[BG] ⏭️ Kullanıcı tercihi: Not üretimi KESİNLİKLE atlanıyor.`);
            notesAttemptSuccess = true;
            currentScore = 100;
            notes = section.rawContent.length > 50 ? section.rawContent : "Not üretimi atlandı.";
          } else if (!notesAttemptSuccess) {
            const loopTarget = startingAttempt + MAX_RETRIES - 1;
            for (let vAttempt = startingAttempt; vAttempt <= loopTarget; vAttempt++) {
              if (await shouldStop()) break;
              try {
                console.log(`[BG] Not Üretim Denemesi #${vAttempt}...`)
                try {
                  await applySectionIssuesPatch({
                    currentMicroPhase: getNotesGenerationPhaseLabel(
                      isProfessional,
                      `${sIdx + 1 + alreadyDone}/${totalSections}`,
                      vAttempt,
                    ),
                    currentAttempt: vAttempt,
                    attemptHistory: attemptHistory,
                  })
                } catch { }

                // ==================== AST-TABANLI CERRAHİ YAMA (SURGICAL PATCH) KARAR MATRİSİ ====================
                let isSurgicalPatch = false;
                let enrichedContent = section.rawContent;
                // 🚨 SÖZLÜK BYPASS KALDIRILDI: Tüm metinler Müfettiş denetimine girmek zorundadır.
                if (lastVerification) {
                  const feedbackItems: string[] = [];
                  if (lastVerification.missingTopics?.length > 0) {
                    feedbackItems.push("ATLANAN KONULAR (Kesinlikle ekle):\n- " + lastVerification.missingTopics.join("\n- "));
                  }
                  if (lastVerification.issues?.length > 0) {
                    feedbackItems.push("BİLGİ/MANTIK HATALARI (Kesinlikle düzelt):\n- " + lastVerification.issues.join("\n- "));
                  }
                  if (lastVerification.suggestions?.length > 0) {
                    feedbackItems.push("GELİŞTİRME ÖNERİLERİ (İyileştir):\n- " + lastVerification.suggestions.join("\n- "));
                  }

                  if (feedbackItems.length > 0) {
                    const kontrolorStructuralScore = lastVerification.score;
                    const contradictionCount = (lastVerification.issues || []).length;
                    const missingCount = (lastVerification.missingTopics || []).length;

                    // DONDURMA VE YAMA KARAR MATRİSİ
                    const suggestionCount = (lastVerification.suggestions || []).length;
                    console.log(`[BG] 📊 Karar Matrisi Çalıştırılıyor: Yapısal Puan=${kontrolorStructuralScore}, Çelişki=${contradictionCount}, Eksik=${missingCount}, Öneri=${suggestionCount}`);
                    
                    // Frankenstein Kuralı: Hata yoğunluğu %15'i aşarsa veya pedagojik skor 75'in altındaysa sıfırdan yazım
                    const blockCount = Math.max(10, notes.split('\n\n').length);
                    // Öneriler de yamalanabilir defect olarak sayılır — 2 puanlık stil eksikliği için tüm notu baştan yazdırmak israf!
                    const totalDefects = missingCount + contradictionCount + suggestionCount;
                    const defectDensity = totalDefects / blockCount;
                    
                    if (kontrolorStructuralScore >= 75 && defectDensity <= 0.15 && totalDefects > 0) {
                      console.log(`[BG] 🧠 KARAR MATRİSİ ONAYLANDI: ${totalDefects} Toplam Hata/Öneri (${missingCount} eksik + ${contradictionCount} çelişki + ${suggestionCount} öneri), Yoğunluk: %${(defectDensity*100).toFixed(1)}, Pedagojik Puan: %${kontrolorStructuralScore}. Not Donduruluyor ve Cerrahi Yama (AST) Başlıyor...`);
                      isSurgicalPatch = true;
                    } else {
                      console.log(`[BG] ⛔ KARAR MATRİSİ REDDEDİLDİ: Puan (${kontrolorStructuralScore}) çok düşük veya Hata Yoğunluğu (%${(defectDensity*100).toFixed(1)}) çok yüksek. Sıfırdan yazıma dönülüyor.`);
                      isSurgicalPatch = false;
                    }

                    if (isSurgicalPatch) {
                      const { generateAndInjectPatch } = await import("@/lib/patch-engine");
                      
                      // Müfettiş veya GT prefixlerini temizle ve çelişkileri de yama motoruna gönder
                      const cleanMissingFacts = lastVerification.missingTopics.map((t: string) => 
                        t.replace("[MÜFETTİŞ EKSİĞİ]", "").replace("Eksik Detay (Ground Truth Testi Başarısız):", "").trim()
                      );

                      const cleanContradictions = lastVerification.issues.map((c: string) =>
                        `[ÇELİŞKİ DÜZELTMESİ] ${c.replace("[MÜFETTİŞ HATASI]", "").replace("Bilgi Hatası/Çelişki:", "").trim()}`
                      );

                      // Önerileri de yama motoruna gönder — [ÖNERİ / İYİLEŞTİRME] etiketi ile
                      const cleanSuggestions = (lastVerification.suggestions || []).map((s: string) =>
                        `[ÖNERİ / İYİLEŞTİRME] ${s.trim()}`
                      );

                      const allFactsToPatch = [...cleanMissingFacts, ...cleanContradictions, ...cleanSuggestions];

                      try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama: Cerrahi Yama (AST) Uygulanıyor...` }) } catch { }

                      const fullCourseName = `${course.program?.name || ""} > ${course.name}`.replace(/^\s*>\s*/, "");
                      const patchResult = await generateAndInjectPatch(notes, allFactsToPatch, fullCourseName, section.rawContent, section.title);

                      if (patchResult.success) {
                        notes = patchResult.newMarkdown;
                        // 🔒 MADDE 1/6 KİLİDİ: Yamalı not ARTIK doğrudan onaylanmaz/break edilmez.
                        // isSurgicalPatch true kaldığı için aşağıda generateCourseNotes atlanır (yamalı
                        // notes korunur) ve akış normal Kontrolör + Müfettiş derin denetimine düşer.
                        // Böylece yama yolu da tam %100 kapısından (Kontrolör + Ground Truth + Müfettiş)
                        // geçer; eksik denetimle canlıya sızma engellenir. (Ayrıca tekrarlı doğrulama
                        // API çağrısı da kaldırıldı.)
                        console.log(`[BG] 🩹 Cerrahi Yama uygulandı. Yamalı not şimdi tam denetimden (Kontrolör + Müfettiş) geçecek...`);
                      } else {
                        console.log(`[BG] ⚠️ Cerrahi Yama başarısız oldu (Evsiz bilgi çözülemedi vb.). Sıfırdan yazıma dönülüyor...`);
                        isSurgicalPatch = false;
                      }
                    } 
                    
                    if (!isSurgicalPatch) {
                      console.log(`[BG] 📋 Geri bildirimler dikkate alınarak baştan yazım (Rewrite)...`);
                      try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama: Yama İptal, Konu Yeniden Üretiliyor...` }) } catch { }
                      enrichedContent = `⚠️⚠️⚠️ ÖNCEKİ DENEMEDE TESPİT EDİLEN EKSİKLER VE HATALAR:\nLütfen aşağıdaki geri bildirimleri dikkate alarak ders notunu baştan, organik bir akışla tekrar yaz:\n\n${feedbackItems.join("\n\n")}\n\n---\n\n${section.rawContent}`;
                    }
                  }
                }

                let verification: any;
                
                if (notes && notes.length > 500 && currentScore === 100 && vAttempt === 1) {
                  console.log(`[BG] 🛡️ Resume Mekanizması: Mevcut notlar korundu (Skor: 100), doğrudan Başmüfettişe geçiliyor.`);
                  verification = { score: 100, missingTopics: [], issues: [], suggestions: [] };
                } else {
                  if (!isSurgicalPatch) {
                    await ensureFileUrisForNotes()
                    notes = await generateCourseNotes(
                      enrichedContent, section.title, fullCourseName, course.userLevel,
                      aiMode, section.pageStart, section.pageEnd,
                      false, 0, 1, undefined, sourceMode,
                      getDocumentNoteInstructions(documentProfile),
                      documentProfile.documentType,
                    )
                  }

                  console.log(`[BG] ✅ Notes generated/injected: ${notes.length} chars`)
                  await new Promise(r => setTimeout(r, 8000)) // Rate limit koruması

                  console.log(`[BG] Not Doğrulanıyor (Deneme #${vAttempt})...`)
                  try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama 3: Kalite Kontrolörü Tarafından İnceleniyor (Tur #${vAttempt})` }) } catch { }
                  verification = await verifyNotesAgainstSource(
                    section.rawContent, notes, section.title, fullCourseName, sourceMode,
                    documentProfile.documentType,
                  )

                  if (verification.score === -1) {
                    console.warn(`[BG] ⚠️ Doğrulama API hatası. Deneme hakkı yenmedi, 30sn bekleniyor...`)
                    await new Promise(r => setTimeout(r, 30000))
                    vAttempt-- // Bu deneme sayılmasın
                    continue
                  }
                }

                currentScore = verification.score

                // KONTROLÖR ÇELİŞKİ DENETÇİSİ (Consistency Check)
                // Kontrolör "hata/eksik var" deyip puanı 100 döndürürse, çelişkiyi tespit edip puanı
                // dürüst bir şekilde eksik ve hata sayısına oranla düşürüyoruz.
                const hasCriticalFeedback = verification.missingTopics.length > 0 || verification.issues.length > 0;
                if (currentScore === 100 && hasCriticalFeedback) {
                  // Eksik ve hata sayısına göre matematiksel düşüş
                  const penaltyCount = verification.missingTopics.length + verification.issues.length;
                  const rawPenalty = penaltyCount * 5; // Her tespit -5 puan
                  currentScore = Math.max(50, 100 - rawPenalty);
                  verification.score = currentScore;
                  console.log(`[BG] ⚠️ KONTROLÖR ÇELİŞKİSİ: Model 100 verdi ama ${penaltyCount} hata/eksik buldu. Dürüst puan: %${currentScore}`);
                }

                // TERS ÇELİŞKİ DENETÇİSİ (Reverse Consistency)
                if (currentScore <= 70 && !hasCriticalFeedback) {
                  console.log(`[BG] ⚠️ TERS ÇELİŞKİ: Model düşük puan (%${currentScore}) verdi ama hiç eksik/hata bulamadı. Geri bildirim boş olduğu için Smart Inject yapılamaz, sıfırdan yazım tetikleniyor.`);
                  verification.issues.push("[SİSTEM] Puan düşük olmasına rağmen geri bildirim boş dönmüş. Akıllı Yama (Smart Inject) hedefsiz çalışamayacağı için sıfırdan yazım tetikleniyor.");
                  currentScore = 65; // Force rewrite
                  verification.score = currentScore;
                }

                // SUGGESTIONS KAÇAK KAPISI KONTROLÜ
                const suspiciousRegex = /(eksik(?!siz)|anlatılmamış|bahsedilmemiş|değinilmemiş|yer almıyor|yoktur|bulunmamaktadır)/i;
                const suspiciousSuggestions = verification.suggestions.filter((s: string) => {
                  if (/tamamlanmış|giderilmiş|olumlu|düzeltilmiş|başarılı|zenginleştir/i.test(s)) return false;
                  return suspiciousRegex.test(s);
                });
                if (suspiciousSuggestions.length > 0) {
                  console.log(`[BG] 🚨 KAÇAK KAPI TESPİTİ: Suggestions alanında ${suspiciousSuggestions.length} adet eksik içerik beyanı bulundu. Bunlar zorla missingTopics'e taşınıyor.`);
                  verification.missingTopics.push(...suspiciousSuggestions);
                  verification.suggestions = verification.suggestions.filter((s: string) => !suspiciousRegex.test(s));
                  
                  const rawPenalty = Math.min(30, suspiciousSuggestions.length * 10); // Max 30 puan ceza
                  currentScore = Math.max(50, currentScore - rawPenalty);
                  verification.score = currentScore;
                }

                // Kontrolörün yapısal skor değerini kaydet (SmartInject routing kararı için)
                const kontrolorStructuralScore = verification.score;

                // FIX: En yüksek başarılı doğrulama skorunu ve notlarını koru (TÜM CEZALARDAN SONRA)
                let isNewBest = false;
                if (currentScore > bestScore) {
                  bestScore = currentScore
                  bestNotes = notes
                  isNewBest = true;
                  console.log(`[BG] 🏆 Yeni en yüksek skor: %${bestScore}`)
                }

                lastVerification = verification
                if (isNewBest) {
                  bestVerification = JSON.parse(JSON.stringify(verification));
                }

                const historyEntry = {
                  attempt: vAttempt,
                  score: verification.score,
                  missingTopics: verification.missingTopics || [],
                  issues: verification.issues || [],
                  suggestions: verification.suggestions || [],
                  isSmartInject: typeof isSurgicalPatch !== 'undefined' ? isSurgicalPatch : false,
                  kontrolorGroundTruth: verification.score === 100,
                  mufettis: false,
                  fullyApproved: false,
                }
                attemptHistory.push(historyEntry)

                const kontrolorStages = {
                  notesGenerated: true,
                  kontrolorGroundTruth: verification.score === 100,
                  mufettis: false,
                  cerrahiYama: false,
                  flashcards: false,
                  questions: false,
                  published: false,
                }

                // CANLI RAPOR GÜNCELLEMESİ
                try {
                  await applySectionIssuesPatch(
                    {
                      missingTopics: lastVerification.missingTopics || [],
                      issues: lastVerification.issues || [],
                      suggestions: lastVerification.suggestions || [],
                      currentAttempt: vAttempt,
                      isCheckingAgain: currentScore < 95 && vAttempt < 5,
                      attemptHistory: attemptHistory,
                      stages: kontrolorStages,
                      currentMicroPhase: verification.score === 100
                        ? `${sIdx + 1 + alreadyDone}/${totalSections}. Kontrolör onayı tamam — Müfettiş denetimi sırada`
                        : `${sIdx + 1 + alreadyDone}/${totalSections}. Kalite Kontrolörü incelemesi tamamlandı (Tur #${vAttempt})`,
                    },
                    {
                      verificationScore: currentScore,
                      ...(verification.score === 100 ? { notes: notes || null } : {}),
                    },
                  )
                } catch (dbErr) {
                  console.error("[BG_DB_ERROR] Canlı skor DB kaydı başarısız:", dbErr)
                }

                console.log(`[BG] 🔍 DOĞRULAMA (Deneme #${vAttempt}): ${section.title} → Skor: ${verification.score}/100`)
                if (verification.missingTopics.length > 0) {
                  console.log(`[BG] ⚠️ Eksik konular: ${verification.missingTopics.join(", ")}`)
                }
                if (verification.issues.length > 0) {
                  console.log(`[BG] 🔴 Hatalı bilgiler/sorunlar: ${verification.issues.join(", ")}`)
                }

                // Eğer skor tam 100 ise Müfettiş Derin Denetimine geç
                if (verification.score === 100) {
                  // İlk turda Müfettiş atlama kuralı iptal edildi. Skor 100 bile olsa HER ZAMAN Müfettiş devreye girecek.

                  console.log(`[BG] 🎉 KONTROLÖR ONAYI (%100) — 4. Katman: Müfettiş Derin Denetimi (Deep Audit) Başlıyor...`)
                  try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama 4: Başmüfettiş (Deep Audit) Çapraz Denetimi Yapılıyor...` }) } catch { }

                  // 1. Tüm konuları çıkar
                  const analysisForAudit = await analyzeSectionContent(section.rawContent, section.title, aiMode, undefined)
                  const sectionTopics = analysisForAudit.topics || []

                  if (sectionTopics.length > 0) {
                    // 2. 6'lı paketlere böl (kota tasarrufu — eski: 3'lü)
                    const packages: string[][] = []
                    for (let i = 0; i < sectionTopics.length; i += 6) {
                      packages.push(sectionTopics.slice(i, i + 6))
                    }

                    if (packages.length > 0) {
                      let overallPassed = true
                      const allMissingDetails: string[] = []
                      const allContradictions: string[] = []
                      const allFindings: Array<{ description: string; severity: string; type: string }> = []

                      console.log(`[BG] 📦 Toplam Paket Sayısı: ${packages.length} paket denetlenecek.`)

                      let packIdx = 1
                      for (const pack of packages) {
                        console.log(`[BG] 👉 [Paket ${packIdx}/${packages.length}] Müfettiş inceliyor...`)
                        try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama 4: Başmüfettiş Çapraz Denetimi (Paket ${packIdx}/${packages.length})...` }) } catch { }
                        await new Promise(r => setTimeout(r, 4000))

                        try {
                          const fullCourseName = `${course.program?.name || ""} > ${course.name}`.replace(/^\s*>\s*/, "");
                          const auditResult = await auditNotesAgainstSourceSpecific(
                            fullCourseName,
                            section.rawContent,
                            notes,
                            section.title,
                            pack,
                            section.pageStart,
                            section.pageEnd
                          )

                          if (!auditResult.passed) {
                            overallPassed = false
                            console.warn(`[BG] ❌ [Paket ${packIdx} BAŞARISIZ]`)
                            if (auditResult.missingDetails?.length) allMissingDetails.push(...auditResult.missingDetails)
                            if (auditResult.contradictions?.length) allContradictions.push(...auditResult.contradictions)
                          } else {
                            console.log(`[BG] ✅ [Paket ${packIdx} BAŞARILI]`)
                          }

                          // Severity-weighted findings biriktir
                          if (auditResult.findings?.length) {
                            allFindings.push(...auditResult.findings)
                          }
                        } catch (err: any) {
                          overallPassed = false
                          allMissingDetails.push(`[Paket ${packIdx} Hatası] ${err.message}`)
                          allFindings.push({ description: `Paket ${packIdx} API Hatası: ${err.message}`, severity: "CRITICAL", type: "missing" })
                        }
                        packIdx++
                      }

                      if (!overallPassed) {
                        // ==================== DÜRÜST PUANLAMA MOTORU (Severity-Weighted True Scoring) ====================
                        // Her bulgunun ağırlığına göre puanı DÜRÜSTÇE hesapla.
                        const SEVERITY_PENALTIES: Record<string, number> = { CRITICAL: 10, MEDIUM: 5, LOW: 2 }
                        let totalPenalty = 0
                        let criticalCount = 0
                        let mediumCount = 0
                        let lowCount = 0

                        for (const finding of allFindings) {
                          const penalty = SEVERITY_PENALTIES[finding.severity] || 5
                          totalPenalty += penalty
                          if (finding.severity === "CRITICAL") criticalCount++
                          else if (finding.severity === "MEDIUM") mediumCount++
                          else lowCount++
                        }

                        // Kontrolör 100 vermişti. Müfettiş bulgularına göre GERÇEK skoru hesapla.
                        const trueScore = Math.max(30, 100 - totalPenalty) // 30'un altına düşmesin (not var sonuçta)
                        currentScore = trueScore
                        verification.score = trueScore

                        // FIX #5: Müfettiş en üst otoritedir — bestScore'u da düzelt
                        // Kontrolör 100 dedi ama müfettiş düşürdü. bestScore=100 kalırsa
                        // bir sonraki kota hatasında yanlış geri yüklenir.
                        bestScore = trueScore
                        bestNotes = notes
                        console.log(`[BG] 🏆 Müfettiş düzeltmesi sonrası bestScore güncellendi: %${bestScore}`)

                        console.log(`[BG] ⛔ MÜFETTİŞ DENETİMİ SONUCU:`)
                        console.log(`[BG]   → KRİTİK: ${criticalCount} bulgu (x10 puan)`)
                        console.log(`[BG]   → ORTA: ${mediumCount} bulgu (x5 puan)`)
                        console.log(`[BG]   → DÜŞÜK: ${lowCount} bulgu (x2 puan)`)
                        console.log(`[BG]   → Toplam Ceza: -${totalPenalty} puan`)
                        console.log(`[BG]   → DÜRÜST PUAN: %${trueScore} (Kontrolör: %100 → Müfettiş düzeltmesi: %${trueScore})`)

                        // Müfettişin bulgularını lastVerification'a ekle ki sonraki üretimde Yazar bunları düzeltsin
                        lastVerification.missingTopics.push(...allMissingDetails.map(d => `[MÜFETTİŞ EKSİĞİ] ${d}`))
                        lastVerification.issues.push(...allContradictions.map(c => `[MÜFETTİŞ HATASI] ${c}`))

                        // UI Bug Fix: Update the history entry with the true lowered score from Deep Audit
                        if (historyEntry) {
                          historyEntry.score = trueScore;
                          historyEntry.missingTopics = [...lastVerification.missingTopics];
                          historyEntry.issues = [...lastVerification.issues];
                          historyEntry.mufettis = false;
                          historyEntry.fullyApproved = false;
                        }

                        // DB Live Update for Inspector Failure — DÜRÜST SKOR ile
                        try {
                          await applySectionIssuesPatch(
                            {
                              missingTopics: lastVerification.missingTopics,
                              issues: lastVerification.issues,
                              suggestions: lastVerification.suggestions,
                              currentAttempt: vAttempt,
                              isCheckingAgain: true,
                              attemptHistory: attemptHistory,
                              inspectorFailed: true,
                              inspectorFindings: allFindings,
                              stages: {
                                notesGenerated: true,
                                kontrolorGroundTruth: true,
                                mufettis: false,
                                cerrahiYama: false,
                                flashcards: false,
                                questions: false,
                                published: false,
                              },
                              currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Müfettiş denetimi — eksikler tespit edildi`,
                            },
                            { verificationScore: trueScore },
                          )
                        } catch (e) { }

                        // "Kaliteden taviz yok" - Akıllı Çıkış stratejisi tamamen iptal edildi.
                        // Notun %100 kusursuz olması ZORUNLUDUR. 96 veya 99 alınsa dahi,
                        // sistem eksikleri Smart Inject ile kapatmaya çalışacaktır.
                      }
                    }
                  } else {
                      console.log(`[BG] ⚠️ Konu çıkarılamadı (veya 429 yedi), Müfettiş denetimi yapılamadı! Puan 100 olamaz, güvenlik için 70'e düşürülüyor!`)
                      currentScore = 70;
                      verification.score = 70;
                      bestScore = 70;
                      verification.issues.push("[MÜFETTİŞ SİSTEM HATASI] Derin denetim için konu çıkarılamadı. API limitine veya model hatasına takılmış olabilir. Güvenlik amacıyla skor düşürüldü, tekrar denenecek.");
                    }

                  if (verification.score === 100) {
                    console.log(`[BG] 🎉 KALİTE ONAYLANDI (%100) — Hem Kontrolör Hem Müfettiş Kusursuz Onay Verdi!`)
                    notesAttemptSuccess = true
                    
                    // MİMARİ HATA ÇÖZÜMÜ: %100 alan notu anında veritabanına betonla!
                    // Böylece Flashcard veya Soru üretimi sırasında sunucu çökerse API limitleri boşa gitmez.
                    if (historyEntry) {
                      historyEntry.mufettis = true
                      historyEntry.fullyApproved = true
                    }

                    try {
                      await applySectionIssuesPatch(
                        {
                          message: "Kontrolör ve Müfettiş onayı tamamlandı.",
                          currentAttempt: vAttempt,
                          attemptHistory: attemptHistory,
                          missingTopics: [],
                          issues: [],
                          auditResult: { passed: true },
                          stages: {
                            notesGenerated: true,
                            kontrolorGroundTruth: true,
                            mufettis: true,
                            cerrahiYama: false,
                            flashcards: false,
                            questions: false,
                            published: false, // DO NOT PUBLISH YET, wait for flashcards and questions
                          },
                          currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Kontrolör ve Müfettiş onayı tamamlandı`,
                        },
                        { notes: notes, verificationScore: 100 },
                      )
                      
                      // PROGRESİF KAYIT AŞAMA 1: Notlar mükemmelse anında canlıya al (processed: true)
                      await prisma.section.update({
                        where: { id: section.id },
                        data: {
                          notes: notes,
                          verificationScore: 100
                        }
                      });
                      console.log(`[BG] 💾 %100 Kusursuz Not Anında CANLIYA ALINDI (processed: true)!`)
                    } catch (saveErr) {
                      console.error(`[BG] ❌ Not anlık kaydetme hatası:`, saveErr)
                    }
                    
                    break
                  }
                }

                // ==================== AKILLI YÖNLENDİRME (Smart Routing) ====================
                // Döngünün bir sonraki iterasyonunda ne yapılacağına karar veren mantık.
                // Not: SmartInject kararı artık sahte "99" şifresine değil,
                // Kontrolörün yapısal değerlendirmesine (kontrolorStructuralScore) dayanır.
                // Bu değer döngünün başındaki (vAttempt > 1) koşulunda lastVerification.score olarak okunur.

                if (vAttempt < 5) {
                  console.log(`[BG] ⛔ Skor mükemmel değil (%${verification.score}), 10sn beklenip tekrar denenecek...`)
                  
                  // Kalkan Yöntemi: Eğer yeni deneme bir öncekini geçemediyse metni çöpe at ve bestNotes'a dön
                  if (bestScore > 0 && currentScore <= bestScore) {
                    console.log(`[BG] 🛡️ KALKAN DEVREDE: Yeni skor (%${currentScore}), en iyi skoru (%${bestScore}) geçemedi. Bozuk metin atılıp en iyi metne dönülüyor...`);
                    notes = bestNotes;
                    if (bestVerification) {
                      lastVerification = JSON.parse(JSON.stringify(bestVerification));
                    }
                  }
                  
                  await new Promise(r => setTimeout(r, 10000))
                }
              } catch (notesErr: any) {
                if (notesErr instanceof ApiQuotaExhaustedError) {
                  console.error(`[BG] ⛔ Günlük kota — işlem duraklatılıyor: ${notesErr.message}`);
                  const pauseMessage = "Google günlük limiti doldu. Pasifik saatiyle gece yarısı sıfırlanır; yarın «Devam Ettir» ile yeniden başlatın.";
                  try {
                    await applySectionIssuesPatch({
                      currentMicroPhase: pauseMessage,
                      pauseReason: "quota_daily",
                      pausedAt: new Date().toISOString(),
                    })
                    await prisma.course.update({ where: { slug }, data: { status: "paused", updatedAt: new Date() } });
                  } catch { /* ignore */ }
                  hasCriticalError = true;
                  break;
                }

                console.error(`[BG] ❌ Not üretim/doğrulama denemesi #${vAttempt} başarısız:`, notesErr.message)

                // FIX #4: Kota hatası mı yoksa gerçek hata mı?
                const isQuotaErr = notesErr.message?.includes("kota") ||
                  notesErr.message?.includes("quota") ||
                  notesErr.message?.includes("429") ||
                  notesErr.message?.includes("RESOURCE_EXHAUSTED")

                if (isQuotaErr && quotaFailures < MAX_QUOTA_FAILURES) {
                  quotaFailures++
                  vAttempt-- // Kota hatası gerçek deneme hakkını YEMEMELİ
                  console.log(`[BG] ⏳ Kota hatası (${quotaFailures}/${MAX_QUOTA_FAILURES})! Bu deneme sayılmıyor, 60sn bekleniyor...`)
                  await new Promise(r => setTimeout(r, 60000))
                } else if (isQuotaErr) {
                  console.log(`[BG] ⛔ Kota hatası limiti aşıldı (${MAX_QUOTA_FAILURES}). İşlem duraklatılıyor.`)
                  const pauseMessage = "Google limiti aşıldı. Bir süre bekleyip tek sefer «Devam Ettir» ile yeniden deneyin.";
                  try {
                    await applySectionIssuesPatch({
                      currentMicroPhase: pauseMessage,
                      pauseReason: "quota_exhausted",
                      pausedAt: new Date().toISOString(),
                    })
                    await prisma.course.update({ where: { slug }, data: { status: "paused", updatedAt: new Date() } });
                  } catch { /* ignore */ }
                  hasCriticalError = true;
                  break;
                }

                // KRİTİK: Kota hatası gibi geçici hatalarda önceki en yüksek skoru koru!
                if (bestScore > 0) {
                  currentScore = bestScore
                  notes = bestNotes
                  console.log(`[BG] 🛡️ Geçici hata! En iyi skor korunuyor: %${bestScore}`)
                }

                // Hata geçmişine kaydet
                attemptHistory.push({
                  attempt: vAttempt,
                  score: 0,
                  missingTopics: [],
                  issues: [isQuotaErr ? "Kota hatası — deneme sayılmadı" : "Doğrulama yapılamadı"],
                  suggestions: []
                })

                if (vAttempt === 5 && !notes) throw notesErr
              }
            } // End of quality loop

            // SIKI KALİTE KONTROLÜ: 100 alınmazsa fallback
            if (currentScore < 100) {
              console.log(`[BG] ⚠️ Skor %${bestScore} — 100 puan zorunluluğu sağlanamadı. En iyi nota dönülüyor ve manuel onay beklenecek.`);
              notes = bestNotes;
              currentScore = bestScore;
            }
          } // End of if (!notesAttemptSuccess)

          if (hasCriticalError) {
            success = false
            sectionRetries = maxSectionRetries
            break
          }

          // PROGRESİF KAYIT AŞAMA 1: Notlar onaylandığı an (veya en iyi skora düşüldüğünde) veritabanına kaydet
          // Böylece sorular/flashcardlar beklenirken arayüzde notlar anında görünür!
          if (notes && notes.length > 50) {
            try {
              await prisma.section.update({
                where: { id: section.id },
                data: {
                  notes: notes,
                  verificationScore: currentScore,
                  verificationIssues: lastVerification
                    ? JSON.stringify({
                        missingTopics: lastVerification.missingTopics,
                        issues: lastVerification.issues,
                        suggestions: lastVerification.suggestions,
                        attemptHistory: attemptHistory,
                        groundTruthQuestions: lastVerification.groundTruthQuestions,
                      })
                    : null
                }
              })
              console.log(`[BG] 💾 Notlar anında veritabanına CANLI olarak kaydedildi! (Flashcardlar beklenmiyor)`)
            } catch (err) {
              console.error(`[BG] ❌ Notların erken kayıt aşamasında hata:`, err)
            }
          }

          // ==================== DOĞRULANMIŞ NOT ÜZERİNDEN DERS ÖĞELERİNİ ÜRETME ====================

          let flashcards: any[] = []
          let questions: any[] = []
          let isNewFlashcards = false
          let isNewQuestions = false
          let analysis: any = {}
          let detectedModule: string | null = null
          let finalTitle = section.title
          let requiresQuestions = true

          if (!notesAttemptSuccess) {
            console.warn(`[BG] ⚠️ [${section.title}] Bölüm %100 onaylanmadı! Soru ve flashcard üretimi KESİNLİKLE atlanıyor...`);
          } else {
            console.log(`[BG] Onaylanmış not (%100) üzerinden Flashcard ve Sorular üretiliyor...`)
            // SADECE ONAYLANMIŞ NOTLARI KULLAN Kİ DIŞARIDAN BİLGİ GELMESİN
            const finalContent = notes || section.rawContent;
            try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Flashcard Kartları (Bilgi Kartları) Oluşturuluyor...` }) } catch { }

            // GÜVENLİK DUVARI: Zaten flashcard varsa (ve zorla demiyorsa) eskisini koru ve atla
            const existingFlashcardCount = await prisma.flashcard.count({ where: { sectionId: section.id } });
            if (course.generateFlashcards === false) {
              console.log(`[BG] ⏭️ Kullanıcı tercihi: Flashcard üretimi KESİNLİKLE atlanıyor.`);
            } else if (existingFlashcardCount > 0 && !forceRetry) {
              console.log(`[BG] ⏭️ Zaten ${existingFlashcardCount} flashcard mevcut. Yeniden üretilip silinmeyecek!`);
              flashcards = await prisma.flashcard.findMany({ where: { sectionId: section.id } });
              try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm mevcut Flashcard'lar korundu.` }) } catch { }
            } else {
              isNewFlashcards = true;
              // Flashcard'ları üret (tek deneme, tasarruf)
              for (let fAttempt = 1; fAttempt <= 3; fAttempt++) {
                if (await shouldStop()) break;
                try {
                flashcards = await generateFlashcards(
                  finalContent,
                  section.title,
                  fullCourseName,
                  course.userLevel,
                  aiMode,
                  undefined,
                  section.pageStart,
                  section.pageEnd,
                  section.rawContent.replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, ""),
                  course.documentType
                )
                
                // SOLVER AI: Flashcard Sağlaması
                if (flashcards.length > 0) {
                  flashcards = await validateFlashcardsWithSolver(finalContent, flashcards);
                  
                  if (needsBilingualStudyItems(aiMode)) {
                    console.log(`[BG] 🌐 Flashcard İngilizce çevirisi yapılıyor...`)
                    try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Flashcard İngilizce çevirisi...` }) } catch { }
                    const enCards = await translateFlashcardsToEnglish(flashcards, finalTitle, fullCourseName)
                    
                    const pairCheck = await validateBilingualPairs(
                      flashcards.slice(0, 8).map((f, i) => ({
                        tr: f.front,
                        en: enCards[i]?.front_en || "",
                        label: `flashcard-${i + 1}`,
                      })),
                      finalTitle,
                      fullCourseName
                    )
                    if (!pairCheck.passed) {
                      console.warn(`[BG] ⚠️ Flashcard çeviri tutarlılık uyarısı:`, pairCheck.issues.join("; "))
                    }
                    
                    flashcards = flashcards.map((f, i) => ({
                      ...f,
                      front_en: enCards[i]?.front_en || null,
                      back_en: enCards[i]?.back_en || null,
                    }))
                  }
                  
                  // PROGRESİF KAYIT AŞAMA 2: Flaşkartlar hazır olduğu an canlıya al (Soru havuzunu bekleme!)
                  try {
                    await prisma.flashcard.deleteMany({ where: { sectionId: section.id } });
                    const existingFronts = new Set<string>()
                    for (const card of flashcards) {
                      const normalizedFront = card.front.trim().toLowerCase()
                      if (!existingFronts.has(normalizedFront)) {
                        existingFronts.add(normalizedFront)
                        await prisma.flashcard.create({
                          data: {
                            courseId: course.id,
                            sectionId: section.id,
                            front: card.front,
                            back: card.back,
                            difficulty: card.difficulty || "medium"
                          }
                        })
                      }
                    }
                    console.log(`[BG] 💾 ${flashcards.length} Flaşkart Anında CANLIYA ALINDI (Sorular beklenmiyor)!`)
                  } catch (err) {
                    console.error(`[BG] ❌ Flaşkart progresif kayıt hatası:`, err)
                  }
                }
                
                console.log(`[BG] ✅ Flashcards: ${flashcards.length}`)
                break
              } catch (e: any) {
                console.error(`[BG] ⚠️ Flashcard üretimi başarısız:`, e.message)
                if (fAttempt === 3) console.error(`[BG] ❌ Flashcard üretimi atlandı.`)
                else await new Promise(r => setTimeout(r, 10000))
              } // end of catch
              } // end of for loop
              await new Promise(r => setTimeout(r, 15000))
            } // End of else block for flashcards check

            // Bölüm analizi yap
            try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Soru Üretimi İçin Bilişsel Rotalama Yapılıyor...` }) } catch { }
            analysis = await analyzeSectionContent(section.rawContent, section.title, aiMode, undefined)
            await new Promise(r => setTimeout(r, 15000))

            detectedModule = (analysis as any).module || null

            requiresQuestions = resolveRequiresQuestions(section.title, analysis?.requiresQuestions);

            if (!requiresQuestions) {
              console.log(`[BG] 🧠 COGNITIVE ROUTING: Bu bölüm için soru üretimi atlanıyor (requiresQuestions: false).`);
            } else {
              try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Soru Havuzu Oluşturuluyor...` }) } catch { }
              
              // GÜVENLİK DUVARI: Zaten soru varsa (ve zorla demiyorsa) eskisini koru ve atla
              const existingQuestionCount = await prisma.question.count({ where: { sectionId: section.id } });
              if (course.generateQuestions === false) {
                console.log(`[BG] ⏭️ Kullanıcı tercihi: Soru üretimi KESİNLİKLE atlanıyor.`);
              } else if (existingQuestionCount > 0 && !forceRetry) {
                console.log(`[BG] ⏭️ Zaten ${existingQuestionCount} soru mevcut. Yeniden üretilip silinmeyecek! (Kullanıcı manuel çoğaltmış olabilir)`);
                questions = await prisma.question.findMany({ where: { sectionId: section.id } });
              } else {
                for (let qAttempt = 1; qAttempt <= 3; qAttempt++) {
                  if (await shouldStop()) break;
                  try {
                  questions = await generateQuestions(
                    finalContent,
                    section.title,
                    fullCourseName,
                    course.userLevel,
                    aiMode,
                    undefined,
                    section.pageStart,
                    section.pageEnd,
                    section.importance || undefined,
                    section.rawContent.replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, ""),
                    course.documentType
                  )
                  
                  // NORMALİZASYON: Şıkları 'A) ', 'B) ' formatına zorla
                  questions = questions.map((q: any) => {
                    if (q.options && Array.isArray(q.options)) {
                      q.options = q.options.map((opt: string) => {
                        return opt.replace(/^[A-Ea-e][.)]\s*/, "").trim();
                      }).map((opt: string, index: number) => {
                        const letter = String.fromCharCode(65 + index); // 0->A, 1->B...
                        return `${letter}) ${opt}`;
                      });
                    }
                    return q;
                  });

                  // DAĞILIM KONTROLÜ
                  const dist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
                  questions.forEach((q: any) => {
                    const ans = (q.correct || q.correctOption || q.correctAnswer)?.substring(0, 1).toUpperCase();
                    if (ans && dist[ans] !== undefined) dist[ans]++;
                  });
                  console.log(`[BG] ✅ Questions: ${questions.length} | Dağılım:`, dist);
                  
                  // Eğer %80'den fazlası aynı şıksa uyarı ver (pedagojik hata)
                  const totalQ = questions.length;
                  if (totalQ > 3) {
                    const maxAns = Math.max(...Object.values(dist));
                    if (maxAns / totalQ > 0.8) {
                      console.warn(`[BG] ⚠️ Soru dağılımı şüpheli (bir şıkkı çok fazla kullanmış):`, dist);
                    }
                  }

                  // SOLVER AI: Soru Sağlaması (Question Validator)
                  if (questions.length > 0) {
                    questions = await validateQuestionsWithSolver(finalContent, questions);

                    if (needsBilingualStudyItems(aiMode)) {
                      console.log(`[BG] 🌐 Soru İngilizce çevirisi yapılıyor...`)
                      try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Soru İngilizce çevirisi...` }) } catch { }
                      const enQs = await translateQuestionsToEnglish(questions, finalTitle, fullCourseName)
                      questions = questions.map((q, i) => ({
                        ...q,
                        text_en: enQs[i]?.text_en || null,
                        options_en: enQs[i]?.options_en || null,
                        explanation_en: enQs[i]?.explanation_en || null,
                      }))
                    }

                    // PROGRESİF KAYIT AŞAMA 3: Sorular hazır olduğu an canlıya al
                    try {
                      await prisma.question.deleteMany({ where: { sectionId: section.id } });
                      for (const q of questions) {
                        await prisma.question.create({
                          data: {
                            courseId: course.id,
                            sectionId: section.id,
                            text: q.text,
                            options: JSON.stringify(q.options),
                            correct: q.correctOption || q.correctAnswer || q.correct,
                            explanation: q.explanation || "Açıklama bulunmuyor.",
                            difficulty: q.difficulty || "medium",
                            module: detectedModule
                          }
                        })
                      }
                      console.log(`[BG] 💾 ${questions.length} Soru Anında CANLIYA ALINDI!`)
                    } catch (err) {
                      console.error(`[BG] ❌ Soru progresif kayıt hatası:`, err)
                    }
                  }

                  break
                } catch (e: any) {
                  console.error(`[BG] ⚠️ Soru üretimi başarısız:`, e.message)
                  if (qAttempt === 3) console.error(`[BG] ❌ Soru üretimi atlandı.`)
                  else await new Promise(r => setTimeout(r, 10000))
                }
                } // end of for loop
                await new Promise(r => setTimeout(r, 15000))
              } // End of else block for questions check
            }

            // Başlığı iyileştir
            const suggestedTitle = (analysis as any).suggestedTitle
            if (suggestedTitle && suggestedTitle.length > 3 && suggestedTitle.length < 100) {
              const isGeneric = section.title.startsWith("Bölüm İçeriği") ||
                section.title.startsWith("Giriş ve Genel") ||
                /^(Bölüm|Sayfa)\s*\d/i.test(section.title)
              if (isGeneric) {
                finalTitle = suggestedTitle
                console.log(`[BG] 📝 Başlık güncellendi: "${section.title}" → "${finalTitle}"`)
              }
            }
          }

          // detectedModule is declared above

          // FIX #2: Soru/flashcard eksikliğini tespit et ve sessizce geçme
          const missingContent: string[] = []
          if (course.generateFlashcards !== false && flashcards.length === 0 && notes && notes.length > 500) {
            missingContent.push("flashcards")
            console.error(`[BG] 🚨 [${finalTitle}] UYARI: Flashcard üretimi TAMAMEN BAŞARISIZ! Bölüm eksik olarak işaretleniyor.`)
          }
          if (course.generateQuestions !== false && requiresQuestions && questions.length === 0 && notes && notes.length > 500) {
            missingContent.push("questions")
            console.error(`[BG] 🚨 [${finalTitle}] UYARI: Soru üretimi TAMAMEN BAŞARISIZ! Bölüm eksik olarak işaretleniyor.`)
          }

          // Bölüm onay durumu: Notlar kusursuzsa, sırf soru/flashcard API hatası aldı diye sonsuz döngüye girmesini engelle.
          let isSectionApproved = notesAttemptSuccess
          if (missingContent.length > 0) {
            // isSectionApproved = false // KİTLEDİĞİ İÇİN İPTAL EDİLDİ (Sonsuz döngü engeli)
            console.error(`[BG] ⚠️ [${finalTitle}] Eksik içerik var (${missingContent.join(", ")}). Ancak notlar 100 puan aldığı için bölüm ONAYLANDI kabul edilecek.`)
          }

          // FIX #3: Importance null kalmasını engelle
          const resolvedImportance = analysis.importance || section.importance || "Medium"

          // (Çift dil işlemleri artık Progressive Save öncesi yapılıyor)
          // Veritabanı kayıtlarını oluştur
          // 🔒 CANLIYA ÇIKIŞ KİLİDİ (Madde 1): Not yalnızca %100 onaylıysa (Kontrolör+Müfettiş)
          // öğrenciye gösterilmek üzere yayınlanır. Onaylanmamış not DB'de notes=null kalır.
          await prisma.section.update({
            where: { id: section.id },
            data: {
              title: finalTitle,
              summary: analysis.summary || "",
              notes: notesAttemptSuccess ? (notes || null) : null,
              notes_en: null,
              importance: resolvedImportance,
              topics: JSON.stringify(analysis.topics || []),
              module: detectedModule,
              processed: isSectionApproved,
              verificationScore: currentScore,
              verificationIssues: lastVerification
                ? JSON.stringify(
                    mergeVerificationIssues(sectionIssuesObj, {
                      missingTopics: lastVerification.missingTopics,
                      issues: lastVerification.issues,
                      suggestions: lastVerification.suggestions,
                      groundTruthQuestions: lastVerification.groundTruthQuestions,
                      attemptHistory: attemptHistory,
                      ...(notesAttemptSuccess ? { auditResult: { passed: true } } : {}),
                      stages: {
                        notesGenerated: true,
                        kontrolorGroundTruth: notesAttemptSuccess || currentScore === 100,
                        mufettis: notesAttemptSuccess,
                        cerrahiYama: attemptHistory.some((h: { isSmartInject?: boolean }) => h.isSmartInject === true),
                        flashcards: flashcards.length > 0,
                        questions: questions.length > 0,
                        published: isSectionApproved,
                      },
                      message: isSectionApproved
                        ? "Kontrolör ve Müfettiş onayı tamamlandı — bölüm yayında."
                        : notesAttemptSuccess
                          ? "Kontrolör ve Müfettiş onayı tamam; soru/kart üretimi eksik."
                          : undefined,
                      ...(missingContent.length > 0 ? { missingContent } : {}),
                    }),
                  )
                : null
            }
          })

          // KISALTMALAR Sözlük Çıkarımı (Glossary Extraction)
          if (finalTitle.toUpperCase().includes("KISALTMALAR") && notes) {
            console.log(`[BG] 📚 "KISALTMALAR" bölümü algılandı. Sözlük (Glossary) çıkarılıyor...`)
            const dict: Record<string, string> = {}
            const lines = notes.split('\n')
            for (const line of lines) {
              const cleanLine = line.trim()
              // Olası formatlar: 
              // * **ABBR:** Definition
              // **ABBR:** Definition
              // ### ABBR
              const match = cleanLine.match(/^(?:\*\s+)?\*\*([^:]+):\*\*\s*(.+)$/) ||
                            cleanLine.match(/^####\s+([^\(]+)(?:\([^\)]*\))?\s*$/) ||
                            cleanLine.match(/^-\s+\*\*([^*\-—]+)\*\*\s*[—\-:]\s*(.+)$/) ||
                            cleanLine.match(/^###\s+(?:\s*)?([^\(]+?)(?:\s*\([^\)]*\))?\s*$/)
              if (match) {
                dict[match[1].trim()] = match[2].trim()
              }
            }
            if (Object.keys(dict).length > 0) {
              try {
                await prisma.course.update({
                  where: { id: course.id },
                  data: { glossary: JSON.stringify(dict) }
                })
                console.log(`[BG] ✅ ${Object.keys(dict).length} adet kısaltma Course.glossary alanına kaydedildi.`)
              } catch (e) {
                console.error(`[BG] ⛔ Glossary kaydetme hatası:`, e)
              }
            }
          }

          console.log(`[BG] ✅ BÖLÜM TAMAMLANDI: ${finalTitle} → ${flashcards.length} cards, ${questions.length} questions. Skor: ${currentScore}/100`)


          // ==================== ANA TABLO CANLILIK SİNYALİ GÜNCELLEMESİ (15dk timeout engelleme) ====================
          await prisma.course.update({
            where: { id: course.id },
            data: { updatedAt: new Date() }
          })
          console.log(`[BG] 💓 Ders canlılık sinyali (updatedAt) güncellendi.`)

          success = true
          break // 🚨 CRITICAL FIX: Infinite loop prevented
        } catch (aiError: any) {
          sectionRetries++
          console.error(`[BG_ERROR] [Deneme #${sectionRetries}/${maxSectionRetries}] ${section.title} işlenirken hata oluştu:`, aiError.message?.substring(0, 120))
        }
      }

      if (!success) {
        console.error(`[BG] 💀 FAILED: ${section.title} — Bölüm ${maxSectionRetries} deneme sonrasında da işlenemedi, işlem durduruluyor.`)
        hasCriticalError = true
        break
      }
      await new Promise(r => setTimeout(r, 2000))
    }

    if (await shouldStop()) {
      console.log(`[BG] 🛑 "${course.name}" kullanıcı/iptal nedeniyle duraklatıldı.`)
      await finalizeCourseStatusIfStillProcessing(slug, "paused")
      return
    }

    if (hasCriticalError) {
      await finalizeCourseStatusIfStillProcessing(slug, "error")
      console.error(`[BG] ❌ "${course.name}" işlemi durduruldu.`)
      return
    }

    // Çalışma planı kullanıcı bazlı /api/study-plan/generate üzerinden oluşturulur (userId zorunlu).

    // 🔒 CANLIYA ÇIKIŞ KİLİDİ (Madde 1): Ders ancak TÜM bölümler %100 onaylı (processed=true)
    // ise "ready" olur. Bir tek bölüm bile eksik/onaysız ise ders "error" kalır ve kullanıcı
    // "Devam Ettir" ile kaldığı yerden tamamlatabilir. Yarım ders ASLA "hazır" gösterilmez.
    const totalSectionCount = await prisma.section.count({ where: { courseId: course.id } })
    const processedSectionCount = await prisma.section.count({ where: { courseId: course.id, processed: true } })
    const allSectionsPerfect = totalSectionCount > 0 && processedSectionCount === totalSectionCount
    const finalStatus = allSectionsPerfect ? "ready" : "error"

    await finalizeCourseStatusIfStillProcessing(slug, finalStatus)
    const stats = { flashcards: await prisma.flashcard.count({ where: { courseId: course.id } }), questions: await prisma.question.count({ where: { courseId: course.id } }) }
    if (allSectionsPerfect) {
      console.log(`[BG] ✅ "${course.name}" tamamlandı (TÜM ${totalSectionCount} bölüm %100)! ${stats.flashcards} flashcard, ${stats.questions} soru`)
    } else {
      console.warn(`[BG] ⚠️ "${course.name}" KISMEN tamamlandı: ${processedSectionCount}/${totalSectionCount} bölüm %100 onaylı. Ders "ready" YAPILMADI (eksik bölümler için tekrar çalıştırılmalı).`)
    }
  } catch (fatalError: any) {
    console.error(`[BG_FATAL] "${course.name}" işlenirken kritik hata:`, fatalError.message)
    try { await finalizeCourseStatusIfStillProcessing(slug, "uploaded") } catch { }
  } finally {
    // clearHeartbeat(slug) kaldırıldı
    releaseProcessing(slug)
  }
}

