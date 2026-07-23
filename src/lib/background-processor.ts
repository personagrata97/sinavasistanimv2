import { prisma } from "@/lib/prisma"
import {
  isPendingOcrContent,
  shouldRunMarkdownOcr,
} from "@/lib/pdf-engine"
import { analyzeSectionContent, generateCourseNotes, generateFlashcards, generateQuestions, setFileUrisMap, auditNotesAgainstSourceSpecific, validateQuestionsWithSolver, validateFlashcardsWithSolver, needsBilingualStudyItems, translateFlashcardsToEnglish, translateQuestionsToEnglish, validateBilingualPairs, ApiQuotaExhaustedError, OcrChunkRateLimitError, setActiveSectionIdForStatus } from "@/lib/ai-service"
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
import { getEffectiveRawContent } from "@/lib/effective-raw-content"
import { CHAR_SLICE_RESOLUTION, QUALITY_CONTRACT_ENABLED, STRICT_READY_GATE } from "@/lib/feature-flags"
import { sliceContent } from "@/lib/char-slice-resolver"
import { resolveCharSlicesV2 } from "@/lib/char-slice-resolver-v2"
import {
  emptyQualityChain,
  parseQualityChain,
  runStageWithContract,
  type QualityChain,
} from "@/lib/quality-contract"
import { postProcessOcrMarkdown, extractVisualBlockOnly } from "@/lib/ocr-post-processor"
import { runKontrolorEnsemble } from "@/lib/kontrolor-ensemble"
import { evaluatePublishGate } from "@/lib/publish-gate"
import { validateQuestionsAdversarial, validateFlashcardsAdversarial } from "@/lib/question-adversarial"
import { extractStructuredGlossary } from "@/lib/glossary-extractor"

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

/** OCR sonrası markdown başlıklarından alt konu dilimleri oluşturur */
async function maybeCreateCharSliceChildren(
  section: {
    id: string
    order: number
    title: string
    pageStart: number
    pageEnd: number
    rawContent: string
    module: string | null
  },
  courseId: string,
): Promise<boolean> {
  if (!CHAR_SLICE_RESOLUTION()) return false

  const existing = await prisma.section.count({ where: { parentSectionId: section.id } })
  if (existing > 0) return true

  const result = await resolveCharSlicesV2(
    section.rawContent,
    {
      title: section.title,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
    },
    section.title,
  )
  if (!result.validation.valid || result.slices.length < 2) return false

  await prisma.section.update({
    where: { id: section.id },
    data: {
      isStudyUnit: false,
      resolutionScore: result.validation.score,
      detectionSource: result.detectionSource,
      resolutionErrors: JSON.stringify(result.validation.errors),
    },
  })

  for (let i = 0; i < result.slices.length; i++) {
    const sl = result.slices[i]
    await prisma.section.create({
      data: {
        courseId,
        parentSectionId: section.id,
        title: sl.title,
        order: section.order * 100 + (i + 1),
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
        rawContent: sliceContent(section.rawContent, sl.charStart, sl.charEnd),
        module: section.module || section.title,
        sliceKind: "char_range",
        charStart: sl.charStart,
        charEnd: sl.charEnd,
        anchorHeading: sl.anchorHeading,
        anchorLevel: sl.anchorLevel,
        detectionSource: result.detectionSource,
        resolutionScore: result.validation.score,
        isStudyUnit: true,
        processed: false,
      },
    })
  }

  console.log(`[BG] ✂️ [${section.title}] ${result.slices.length} alt konu oluşturuldu (char slice).`)
  return true
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
      where: { courseId: course.id, processed: false, isStudyUnit: true },
      orderBy: { order: "asc" }
    })

    const totalSections = await prisma.section.count({ where: { courseId: course.id, isStudyUnit: true } })
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

      let nextSectionTitle: string | undefined = savedSections[sIdx + 1]?.title;
      if (!nextSectionTitle) {
        const nextSec = await prisma.section.findFirst({
          where: { courseId: course.id, isStudyUnit: true, order: { gt: section.order } },
          orderBy: { order: "asc" }
        });
        nextSectionTitle = nextSec?.title || undefined;
      }

      // OCR bekleyen taranmış bölümler kısa placeholder içerir — atlanmamalı
      if (section.rawContent.length < 100 && !isPendingOcrContent(section.rawContent)) {
        try { await prisma.section.update({ where: { id: section.id }, data: { processed: true } }) } catch { }
        continue
      }

      let sectionIssuesObj: any = {}
      try { sectionIssuesObj = JSON.parse(section.verificationIssues || "{}") } catch {}
      let qualityChain: QualityChain = parseQualityChain(sectionIssuesObj.qualityChain)
      if (qualityChain.gates.length === 0) qualityChain = emptyQualityChain()
      // Eskiden burada needsUserAction === true ise döngü atlanıyordu (Kaldırıldı)

      const applySectionIssuesPatch = async (
        patch: Record<string, unknown>,
        extraData?: Record<string, unknown>,
      ) => {
        sectionIssuesObj = mergeVerificationIssues(sectionIssuesObj, {
          ...patch,
          ...(QUALITY_CONTRACT_ENABLED() ? { qualityChain } : {}),
        })
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
          setActiveSectionIdForStatus(section.id)

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
            // HİBRİT BİRLEŞTİRME: Sayfa yarı metin yarı resimse, dijital metni koruyup
            // OCR çıktısından sadece görsel bloğunu alarak mükerrerliği sıfırlıyoruz.
            const preOcrDigitalText = (!isPendingOcrContent(section.rawContent) && section.rawContent.length > 200)
              ? section.rawContent
              : null

            console.log(`[BG] 🚀 Markdown OCR Katmanı: ${section.title} (Sayfa ${section.pageStart}-${section.pageEnd}) için PDF parçalanarak işleniyor...${preOcrDigitalText ? ` (Hibrit mod: ${preOcrDigitalText.length} karakter dijital metin korunacak)` : ""}`);
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
                  const ocrPost = postProcessOcrMarkdown(pristineMarkdown)

                  // ==================== HİBRİT BİRLEŞTİRME KARARI ====================
                  // Eğer sayfa dijital metin katmanına sahipse (preOcrDigitalText), OCR çıktısının
                  // tamamını almak yerine SADECE [GÖRSEL İÇERİKLER] bloğunu ayıklayıp dijital
                  // metnin sonuna ekliyoruz. Böylece metin kısmı asla dublike olmaz,
                  // resim ve şema açıklamaları ise eksiksiz yakalanır.
                  if (preOcrDigitalText) {
                    const visualBlock = extractVisualBlockOnly(pristineMarkdown)
                    if (visualBlock) {
                      section.rawContent = `${preOcrDigitalText.trim()}\n\n${visualBlock}`
                      console.log(`[BG] 🔗 HİBRİT BİRLEŞTİRME: Dijital metin (${preOcrDigitalText.length} kar) + OCR görsel bloğu (${visualBlock.length} kar) birleştirildi. Mükerrerlik sıfır.`)
                    } else {
                      // OCR'da görsel bloğu yoksa dijital metni olduğu gibi koru
                      section.rawContent = preOcrDigitalText
                      console.log(`[BG] ℹ️ HİBRİT MOD: OCR'da görsel bloğu bulunamadı. Dijital metin olduğu gibi korundu.`)
                    }
                  } else {
                    // Taranmış/scanned sayfa: OCR çıktısının tamamını kullan (mevcut davranış)
                    section.rawContent = ocrPost.markdown
                  }

                  const ocrContract = await runStageWithContract(qualityChain, "ocr_complete", async () => ({
                    pass: true,
                    contentForHash: section.rawContent,
                    metrics: ocrPost.metrics,
                  }))
                  qualityChain = ocrContract.chain
                  await prisma.section.update({ where: { id: section.id }, data: { rawContent: section.rawContent } });
                  console.log(`[BG] ✅ Markdown OCR Tamamlandı (görsel envanter: ${ocrPost.visualCount}).`);
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

            const splitIntoChildren = await maybeCreateCharSliceChildren(section, course.id)
            if (splitIntoChildren) {
              console.log(`[BG] ⏭️ [${section.title}] üst bölüm alt birimlere ayrıldı — bu turda atlanıyor.`)
              success = true
              break
            }
          }

          let effectiveRaw = getEffectiveRawContent(section)

          let isMufettisPassed = false;
          try {
            const v = JSON.parse(section.verificationIssues || "{}");
            isMufettisPassed = v?.stages?.mufettis === true || v?.mufettis === true;
          } catch(e) {}
          // Eğer halihazırda yüksek puanlı notlar varsa ve müfettişten de geçmişse kalite döngüsünü atla
          if (notes && notes.length > 500 && currentScore >= 98 && isMufettisPassed) {
            console.log(`[BG] 🌟 [${section.title}] Zaten kusursuz (%${currentScore}) notlara ve Müfettiş onayına sahip. Not üretimi atlanıyor, doğrudan eksik materyaller (soru/flashcard) üretilecek.`)
            notesAttemptSuccess = true

            if (QUALITY_CONTRACT_ENABLED()) {
              const kResume = await runStageWithContract(qualityChain, "kontrolor", async () => ({
                pass: true,
                contentForHash: notes,
                score: currentScore,
              }))
              qualityChain = kResume.chain
              const mResume = await runStageWithContract(qualityChain, "mufettis", async () => ({
                pass: true,
                contentForHash: notes,
                score: 100,
              }))
              qualityChain = mResume.chain
            }
            
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
            notes = effectiveRaw.length > 50 ? effectiveRaw : "Not üretimi atlandı.";
            if (QUALITY_CONTRACT_ENABLED()) {
              const kSkip = await runStageWithContract(qualityChain, "kontrolor", async () => ({
                pass: true,
                contentForHash: notes,
                score: 100,
              }))
              qualityChain = kSkip.chain
              const mSkip = await runStageWithContract(qualityChain, "mufettis", async () => ({
                pass: true,
                contentForHash: notes,
                score: 100,
              }))
              qualityChain = mSkip.chain
            }
          } else if (!notesAttemptSuccess) {
            const loopTarget = startingAttempt + MAX_RETRIES - 1;
            let patchAttempts = 0;
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
                let enrichedContent = effectiveRaw;
                // 🚨 SÖZLÜK BYPASS KALDIRILDI: Tüm metinler Müfettiş denetimine girmek zorundadır.
                if (lastVerification) {
                  // Pozitif Kapsama Kilidi: Notta eksik kavram kontrolü
                  const claimConcepts: string[] = sectionIssuesObj.claimLedgerConcepts || []
                  if (claimConcepts.length > 0 && notes) {
                    const { checkConceptCoverage } = await import("@/lib/coverage-check")
                    const coverage = checkConceptCoverage(claimConcepts, notes, "", "")
                    if (coverage.missingInNotes.length > 0) {
                      console.log(`[BG] 🚨 POZİTİF KAPSAMA KİLİDİ: ${coverage.missingInNotes.length} kavram notta eksik tespit edildi! Geri bildirime ekleniyor:`, coverage.missingInNotes)
                      if (!lastVerification.missingTopics) lastVerification.missingTopics = []
                      for (const concept of coverage.missingInNotes) {
                        const feedbackMsg = `[KAVRAM EKSİK] "${concept}" kavramı ve açıklaması ders notlarında eksiktir, kesinlikle nota eklenmelidir.`
                        if (!lastVerification.missingTopics.includes(feedbackMsg)) {
                          lastVerification.missingTopics.push(feedbackMsg)
                        }
                      }
                      lastVerification.score = Math.min(lastVerification.score, 85)
                    }
                  }

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
                    const rawBlockCount = notes.split(/\n\s*\n/).filter(b => b.trim().length > 0).length;
                    const blockCount = Math.max(5, rawBlockCount);
                    // Öneriler tam defect değil — stil/format önerileri için tüm notu baştan yazdırmak israf
                    // Öneriler 0.3 ağırlıklı, eksik/çelişki tam ağırlıklı
                    const totalDefects = missingCount + contradictionCount + suggestionCount;
                    const weightedDefects = missingCount + contradictionCount + (suggestionCount * 0.3);
                    const defectDensity = weightedDefects / blockCount;
                    
                    // Kısa bölümlerde (örn. kısaltmalar veya tanımlar) yama yoğunluk limiti %45'e esnetilmelidir.
                    const isShortSection = rawBlockCount <= 6;
                    const allowedDensity = isShortSection ? 0.60 : 0.20;
                    
                    if (kontrolorStructuralScore >= 75 && defectDensity <= allowedDensity && totalDefects > 0) {
                      console.log(`[BG] 🧠 KARAR MATRİSİ ONAYLANDI: ${totalDefects} Toplam Hata/Öneri (${missingCount} eksik + ${contradictionCount} çelişki + ${suggestionCount} öneri), Yoğunluk: %${(defectDensity*100).toFixed(1)} (Eşik: %${(allowedDensity*100).toFixed(0)}), Pedagojik Puan: %${kontrolorStructuralScore}. Not Donduruluyor ve Cerrahi Yama (AST) Başlıyor...`);
                      isSurgicalPatch = true;
                    } else {
                      console.log(`[BG] ⛔ KARAR MATRİSİ REDDEDİLDİ: Puan (${kontrolorStructuralScore}) çok düşük veya Hata Yoğunluğu (%${(defectDensity*100).toFixed(1)}) çok yüksek (Eşik: %${(allowedDensity*100).toFixed(0)}). Sıfırdan yazıma dönülüyor.`);
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
                      const patchResult = await generateAndInjectPatch(notes, allFactsToPatch, fullCourseName, effectiveRaw, section.title);

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
                        if (patchAttempts < 1) {
                          patchAttempts++;
                          vAttempt--;
                        }
                      }
                    } 
                    
                    if (!isSurgicalPatch) {
                      console.log(`[BG] 📋 Geri bildirimler dikkate alınarak baştan yazım (Rewrite)...`);
                      try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama: Yama İptal, Konu Yeniden Üretiliyor...` }) } catch { }
                      enrichedContent = `⚠️⚠️⚠️ ÖNCEKİ DENEMEDE TESPİT EDİLEN EKSİKLER VE HATALAR:\nLütfen aşağıdaki geri bildirimleri dikkate alarak ders notunu baştan, organik bir akışla tekrar yaz:\n\n${feedbackItems.join("\n\n")}\n\n---\n\n${effectiveRaw}`;
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
                    const { generateCourseNotesEnsemble } = await import("@/lib/notes-ensemble")
                    const parsedIssues = section.verificationIssues ? JSON.parse(section.verificationIssues) : {}
                    const isLowConfidence = parsedIssues.issues?.some((iss: string) => iss.includes("[SINIR UYARISI]")) || parsedIssues.confidence === "low"
                    
                    let noteStyle = getDocumentNoteInstructions(documentProfile)
                    if (isLowConfidence) {
                      noteStyle = `${noteStyle || ""}\n\n⚠️ GÜVEN SKORU DÜŞÜK SINIR TALİMATI: Bu bölümün sayfa sınırı kesin değildir; sayfanın başında veya sonunda önceki/sonraki konuya ait görünen cümleler varsa bunları nota dahil etme, sadece bu bölümün doğrudan başlığıyla ilgili içeriği işle.`
                    }

                    const ensembleResult = await generateCourseNotesEnsemble(
                      enrichedContent, section.title, fullCourseName, course.userLevel,
                      aiMode, section.pageStart, section.pageEnd,
                      undefined, sourceMode,
                      noteStyle,
                      documentProfile.documentType,
                      nextSectionTitle,
                      isLowConfidence ? "low" : undefined
                    );
                    notes = ensembleResult.notes;
                    await applySectionIssuesPatch({ ensembleMode: ensembleResult.ensembleMode });

                    // ==================== KAVRAMSAL ATOM ÇIKARIMI (Soru 07) ====================
                    // Not üretim promptu, kritik sayısal kavramları [KRİTİK_KAVRAMLAR]...[/KRİTİK_KAVRAMLAR]
                    // etiketi içinde döndürür. Bu etiketi çekip claim-ledger'a kaydediyoruz,
                    // ardından not metninden tamamen siliyoruz (öğrenci görmez).
                    const conceptTagMatch = notes.match(/\[KRİTİK_KAVRAMLAR\]([\s\S]*?)\[\/KRİTİK_KAVRAMLAR\]/)
                    if (conceptTagMatch) {
                      const conceptsRaw = conceptTagMatch[1].trim()
                      const conceptPairs = conceptsRaw.split(",").map(p => p.trim()).filter(p => p.includes(":"))
                      if (conceptPairs.length > 0) {
                        console.log(`[BG] 📋 KAVRAM ÇIKARIMI: ${conceptPairs.length} kritik kavram tespit edildi: ${conceptPairs.slice(0, 5).join(", ")}${conceptPairs.length > 5 ? "..." : ""}`)
                        try {
                          await applySectionIssuesPatch({ claimLedgerConcepts: conceptPairs })
                        } catch { /* ignore */ }
                      }
                      // Etiketi not metninden tamamen sil — öğrenci görmez
                      notes = notes.replace(/\n?\[KRİTİK_KAVRAMLAR\][\s\S]*?\[\/KRİTİK_KAVRAMLAR\]\n?/g, "").trimEnd()
                    }
                  }

                  const { dedupParagraphs } = await import("@/lib/content-dedup")
                  notes = dedupParagraphs(notes)

                  console.log(`[BG] ✅ Notes generated/injected: ${notes.length} chars`)
                  await new Promise(r => setTimeout(r, 8000)) // Rate limit koruması

                  console.log(`[BG] Not Doğrulanıyor (Deneme #${vAttempt})...`)
                  try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama 3: Kalite Kontrolörü Tarafından İnceleniyor (Tur #${vAttempt})` }) } catch { }
                  
                  const parsedIssues = section.verificationIssues ? JSON.parse(section.verificationIssues) : {}
                  const isLowConfidence = parsedIssues.issues?.some((iss: string) => iss.includes("[SINIR UYARISI]")) || parsedIssues.confidence === "low"
                  
                  const ensembleResult = await runKontrolorEnsemble(
                    effectiveRaw, notes, section.title, fullCourseName, sourceMode,
                    documentProfile.documentType, vAttempt,
                    isLowConfidence ? "low" : undefined
                  )
                  verification = ensembleResult.verification
                  if (!ensembleResult.pass && verification.score === 100) {
                    verification.score = ensembleResult.score
                  }

                  const ocrGate = qualityChain.gates.find(g => g.stage === "ocr_complete")
                  const visualItemCount = (ocrGate?.metrics as any)?.visualInventoryCount || 0
                  
                  const mermaidCount = (notes.match(/```mermaid/g) || []).length
                  const tableCount = countMarkdownTables(notes)
                  const ocrVisualDescCount = (notes.match(/\[GÖRSEL:\s*[^\]]+\]/gi) || []).length + (notes.match(/<!--\s*VIS-\d+\s*-->/gi) || []).length
                  const totalVisuals = mermaidCount + tableCount + ocrVisualDescCount
                  
                  const meetsVisualMin = visualItemCount === 0 || totalVisuals >= Math.ceil(visualItemCount * 0.9)
                  
                  if (!meetsVisualMin) {
                    console.warn(`[BG] 🚨 GÖRSEL EKSİK: Notlardaki görsel öğe sayısı (${totalVisuals}) envanter beklentisinin (${visualItemCount}) altında! Cezalandırılıyor...`)
                    verification.score = Math.max(50, Math.min(85, verification.score - 15))
                    verification.issues.push(`[GÖRSEL EKSİK] Orijinal PDF'te ${visualItemCount} adet tablo/grafik (VIS-XXX) tespit edilmiştir. Ancak ders notlarında sadece ${totalVisuals} adet tablo/mermaid diyagramı bulunmaktadır. Lütfen tüm görsel tabloları ve şemaları ders notuna markdown tablosu veya mermaid diyagramı olarak ekle, görsel envanteri eksiksiz tamamla.`)
                  }

                  const notesContract = await runStageWithContract(qualityChain, "notes", async () => ({
                    pass: notes.length > 100 && meetsVisualMin,
                    contentForHash: notes,
                    score: verification.score,
                    metrics: {
                      mermaidCount,
                      tableCount,
                      totalVisuals,
                      visualItemCount,
                    },
                    errors: meetsVisualMin ? undefined : ["Notlardaki görsel öğe sayısı yetersiz"],
                  }))
                  qualityChain = notesContract.chain

                  const kontrolorContract = await runStageWithContract(qualityChain, "kontrolor", async () => ({
                    pass: ensembleResult.pass && meetsVisualMin,
                    contentForHash: `${notes}|${verification.score}`,
                    score: verification.score,
                    metrics: { votes: ensembleResult.votes },
                    errors: (ensembleResult.pass && meetsVisualMin) ? undefined : ["Kontrolör ensemble veya görsel envanter reddi"],
                  }))
                  qualityChain = kontrolorContract.chain

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
                  timestamp: new Date().toISOString(),
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

                  const { runExhaustiveAudit } = await import("@/lib/mufettis-exhaustive")
                  const fullCourseName = `${course.program?.name || ""} > ${course.name}`.replace(/^\s*>\s*/, "");
                  
                  let overallPassed = true
                  let auditExecuted = false
                  const allMissingDetails: string[] = []
                  const allContradictions: string[] = []
                  const allFindings: Array<{ description: string; severity: "CRITICAL" | "MEDIUM" | "LOW"; type: "missing" | "contradiction" }> = []

                  try {
                    const auditResult = await runExhaustiveAudit(
                      effectiveRaw,
                      notes,
                      section.title,
                      fullCourseName
                    )
                    auditExecuted = true

                    if (!auditResult.passed) {
                      overallPassed = false
                      console.warn(`[BG] ❌ [Müfettiş Denetimi BAŞARISIZ]`)
                      if (auditResult.missingDetails?.length) allMissingDetails.push(...auditResult.missingDetails)
                      if (auditResult.contradictions?.length) allContradictions.push(...auditResult.contradictions)
                    } else {
                      console.log(`[BG] ✅ [Müfettiş Denetimi BAŞARILI]`)
                    }
                    if (auditResult.findings?.length) {
                      allFindings.push(...auditResult.findings)
                    }
                  } catch (err: any) {
                    overallPassed = false
                    allMissingDetails.push(`[Müfettiş Hatası] ${err.message}`)
                    allFindings.push({ description: `Müfettiş API Hatası: ${err.message}`, severity: "CRITICAL", type: "missing" })
                  }

                  if (!auditExecuted) {
                    console.log(`[BG] ⚠️ Konu çıkarılamadı (veya 429 yedi), Müfettiş denetimi yapılamadı! Puan 100 olamaz, güvenlik için 70'e düşürülüyor!`)
                    currentScore = 70;
                    verification.score = 70;
                    bestScore = 70;
                    verification.issues.push("[MÜFETTİŞ SİSTEM HATASI] Derin denetim için konu çıkarılamadı. API limitine veya model hatasına takılmış olabilir. Güvenlik amacıyla skor düşürüldü, tekrar denenecek.");
                  } else if (!overallPassed) {
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

                    // FIX #5: Müfettiş en üst otoritetir — bestScore'u da düzelt
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

                  if (verification.score === 100) {
                    console.log(`[BG] 🎉 KALİTE ONAYLANDI (%100) — Hem Kontrolör Hem Müfettiş Kusursuz Onay Verdi!`)
                    notesAttemptSuccess = true

                    const mufettisContract = await runStageWithContract(qualityChain, "mufettis", async () => ({
                      pass: true,
                      contentForHash: notes,
                      score: 100,
                    }))
                    qualityChain = mufettisContract.chain
                    
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
                        published: false,
                      },
                          currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Kontrolör ve Müfettiş onayı tamamlandı`,
                        },
                        { notes: notes, verificationScore: 100 },
                      )
                      
                      // PROGRESİF KAYIT: %100 + Müfettiş onaylı notlar geçici kayıt (processed=false kalır)
                      await prisma.section.update({
                        where: { id: section.id },
                        data: {
                          notes: notes,
                          verificationScore: 100
                        }
                      });
                      console.log(`[BG] 💾 %100 Müfettiş onaylı not geçici kaydedildi (yayın bekliyor).`)
                    } catch (saveErr) {
                      console.error(`[BG] ❌ Not anlık kaydetme hatası:`, saveErr)
                    }
                    
                    break
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
                  suggestions: [],
                  timestamp: new Date().toISOString(),
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

          // PROGRESİF KAYIT: Notlar yalnızca %100+Müfettiş onaylıysa erken kayıt (STRICT_READY_GATE)
          if (notes && notes.length > 50 && (!STRICT_READY_GATE() || notesAttemptSuccess)) {
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
            const finalContent = notes || effectiveRaw;
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
                  effectiveRaw,
                  course.documentType
                )
                
                // SOLVER AI: Flashcard Sağlaması
                if (flashcards.length > 0) {
                  const adversarial = await validateFlashcardsAdversarial(finalContent, flashcards);
                  flashcards = adversarial.flashcards;

                  const fcContract = await runStageWithContract(qualityChain, "flashcards", async () => ({
                    pass: flashcards.length > 0,
                    contentForHash: JSON.stringify(flashcards.map((f) => f.front)),
                    metrics: { count: flashcards.length, adversarial: adversarial.metrics },
                  }));
                  qualityChain = fcContract.chain
                  
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
                if (fAttempt === 3) {
                  console.error(`[BG] ❌ Flashcard üretimi atlandı.`)
                  try {
                    await applySectionIssuesPatch({
                      flashcardsGenerationFailed: true,
                      currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Flaşkart üretimi başarısız oldu.`
                    })
                  } catch (dbErr) {
                    console.error("[BG] ❌ Flaşkart hata durumunu kaydetme hatası:", dbErr)
                  }
                } else {
                  await new Promise(r => setTimeout(r, 10000))
                }
              } // end of catch
              } // end of for loop
              await new Promise(r => setTimeout(r, 15000))
            } // End of else block for flashcards check

            // Bölüm analizi yap
            try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Soru Üretimi İçin Bilişsel Rotalama Yapılıyor...` }) } catch { }
            analysis = await analyzeSectionContent(effectiveRaw, section.title, aiMode, undefined)
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
                    effectiveRaw,
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
                      try {
                        await applySectionIssuesPatch({
                          suggestions: [`[SORU DAĞILIMI] Soruların %80'den fazlasının doğru cevabı aynı şık olarak üretilmiştir: ${JSON.stringify(dist)}. Soru şık dağılımının dengelenmesi önerilir.`]
                        });
                      } catch (dbErr) {
                        console.error("[BG] ❌ Soru dağılım uyarısını kaydetme hatası:", dbErr)
                      }
                    }
                  }

                  // SOLVER AI: Soru Sağlaması (Question Validator)
                  if (questions.length > 0) {
                    const originalCount = questions.length;
                    const adversarial = await validateQuestionsAdversarial(finalContent, questions);
                    questions = adversarial.questions;

                    // Dinamik Telafi Döngüsü (Max 2 Attempts)
                    let telafiAttempt = 0;
                    const maxRecoveryAttempts = 2;

                    const claimConcepts: string[] = sectionIssuesObj.claimLedgerConcepts || []
                    const { checkConceptCoverage } = await import("@/lib/coverage-check")

                    let currentCoverage = checkConceptCoverage(
                      claimConcepts,
                      finalContent,
                      questions.map(q => (q.text || q.question || "") + " " + (q.options || []).join(" ")).join(" "),
                      flashcards.map(c => (c.front || "") + " " + (c.back || "")).join(" ")
                    )

                    while ((questions.length < originalCount || currentCoverage.missingInQA.length > 0) && telafiAttempt < maxRecoveryAttempts) {
                      const missingCount = Math.max(1, originalCount - questions.length);
                      console.log(`[BG] [TELAFİ] 🔄 Telafi döngüsü başlatılıyor (Deneme #${telafiAttempt + 1}). Eksik Soru: ${originalCount - questions.length}, Eksik Kavram: ${currentCoverage.missingInQA.length}`);
                      
                      const existingQuestionTexts = questions.map(q => q.text);
                      try {
                        let telafiContent = finalContent + `\n\n⚠️ KESİN KURAL: Aşağıdaki soruların aynısını veya çok benzerlerini KESİNLİKLE üretme (Mevcut Sorular):\n- ${existingQuestionTexts.join("\n- ")}`
                        
                        if (currentCoverage.missingInQA.length > 0) {
                          const targetedPrompt = `\n\n⚠️ HEDEFLİ ÜRETİM TALİMATI: Şu kavramlar hiçbir soruda/flashcard'da test edilmemiş: ${currentCoverage.missingInQA.join(", ")}. SADECE bu kavramları doğrudan test eden sorular üret.`
                          telafiContent += targetedPrompt
                          console.log(`[BG] [TELAFİ] 🎯 Hedefli telafi devrede. Eksik kavramlar hedefleniyor:`, currentCoverage.missingInQA)
                        }

                        const telafiQuestions = await generateQuestions(
                          telafiContent,
                          section.title,
                          fullCourseName,
                          course.userLevel,
                          aiMode,
                          undefined,
                          section.pageStart,
                          section.pageEnd,
                          section.importance || undefined,
                          effectiveRaw,
                          course.documentType
                        );
                        
                        if (telafiQuestions && telafiQuestions.length > 0) {
                          console.log(`[BG] [TELAFİ] 🔍 ${telafiQuestions.length} adet yeni telafi sorusu üretildi. Solver doğrulamasından geçiriliyor...`);
                          const telafiAdversarial = await validateQuestionsAdversarial(finalContent, telafiQuestions);
                          if (telafiAdversarial.questions.length > 0) {
                            // Hedefli üretilen soruları öncelikli korumak için başa ekle
                            questions = [...telafiAdversarial.questions, ...questions].slice(0, originalCount);
                            console.log(`[BG] [TELAFİ] ✅ Telafi başarılı. Toplam geçerli soru sayısı: ${questions.length}/${originalCount}`);
                          }
                        }
                      } catch (telafiErr: any) {
                        console.error(`[BG] [TELAFİ] Telafi soru üretimi başarısız oldu (Kota veya API Hatası):`, telafiErr.message);
                        break; // Kota hatası riskini önlemek için döngüden çık
                      }

                      // Recalculate coverage for next iteration
                      currentCoverage = checkConceptCoverage(
                        claimConcepts,
                        finalContent,
                        questions.map(q => (q.text || q.question || "") + " " + (q.options || []).join(" ")).join(" "),
                        flashcards.map(c => (c.front || "") + " " + (c.back || "")).join(" ")
                      )
                      telafiAttempt++;
                    }

                    // ==================== YEREL BYZANTİNE DOĞRULAMASI (Soru 09) ====================
                    // API çağrısı YAPMADAN, soruların doğru cevaplarındaki sayısal değerleri
                    // kaynak metinle (rawContent) yerel regex karşılaştırmasıyla doğrular.
                    // Çelişen sorular elenir — sıfır kota maliyeti.
                    if (questions.length > 0) {
                      const beforeLocalCount = questions.length
                      // Kaynak metinden tüm sayısal değerleri çıkar (süreler, oranlar, kanun maddeleri)
                      const sourceNumbers = new Set<string>()
                      const numberPatterns = [
                        /\b(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:TL|lira|₺)/gi,  // Para birimleri
                        /[%‰]\s*(\d+(?:[.,]\d+)?)/g,                              // Oranlar (%5, %10)
                        /(\d+(?:[.,]\d+)?)\s*[%‰]/g,                              // Oranlar (5%, 10‰)
                        /(\d+)\s*(?:gün|ay|yıl|saat|hafta|iş\s*günü)/gi,          // Süreler
                        /[Mm]adde\s*(\d+)/g,                                       // Kanun maddeleri
                        /(\d{4,})\b/g,                                             // 4+ haneli sayılar (kanun no vb.)
                      ]
                      for (const pattern of numberPatterns) {
                        for (const match of effectiveRaw.matchAll(pattern)) {
                          if (match[1]) sourceNumbers.add(match[1].replace(/\./g, ""))
                          // Tam eşleşmeyi de ekle
                          sourceNumbers.add(match[0].replace(/\./g, "").replace(/\s+/g, " ").trim())
                        }
                      }

                      // Claim Ledger kavramlarını da kaynak olarak ekle
                      try {
                        const claimIssues = JSON.parse(section.verificationIssues || "{}")
                        const claimConcepts: string[] = claimIssues.claimLedgerConcepts || []
                        for (const concept of claimConcepts) {
                          const [, value] = concept.split(":")
                          if (value) sourceNumbers.add(value.trim().replace(/\./g, ""))
                        }
                      } catch { /* ignore */ }

                      if (sourceNumbers.size > 0) {
                        questions = questions.filter((q: any) => {
                          // Doğru cevap şıkkını bul
                          const correctLetter = (q.correct || q.correctOption || q.correctAnswer || "")
                            .substring(0, 1).toUpperCase()
                          const correctOption = q.options?.find((opt: string) =>
                            opt.trim().startsWith(`${correctLetter})`)
                          )
                          if (!correctOption) return true // Şık bulunamazsa eleme

                          // Doğru şıkta geçen sayıları çıkar
                          const optionNumbers: string[] = []
                          for (const pattern of numberPatterns) {
                            for (const match of correctOption.matchAll(pattern)) {
                              if (match[1]) optionNumbers.push(match[1].replace(/\./g, ""))
                            }
                          }

                          // Sadece SAYISAL değer içeren doğru cevapları kontrol et
                          // Sayısal değer yoksa soruyu eleme (sözel sorular geçer)
                          if (optionNumbers.length === 0) return true

                          // Doğru şıktaki sayılar kaynak metinde var mı kontrol et
                          for (const num of optionNumbers) {
                            // Kaynakta bu sayı veya yakın eşdeğeri var mı?
                            const numNorm = num.replace(/,/g, "").replace(/\s/g, "")
                            const existsInSource = Array.from(sourceNumbers).some(sn => {
                              const snNorm = sn.replace(/,/g, "").replace(/\s/g, "")
                              return snNorm.includes(numNorm) || numNorm.includes(snNorm)
                            })
                            if (!existsInSource && numNorm.length >= 2) {
                              console.warn(`[BG] [YEREL BYZ] ⚠️ Soru elendi — doğru şıktaki "${num}" değeri kaynakta bulunamadı: "${q.text?.substring(0, 80)}..."`)
                              return false
                            }
                          }
                          return true
                        })

                        const eliminated = beforeLocalCount - questions.length
                        if (eliminated > 0) {
                          console.log(`[BG] [YEREL BYZ] 🛡️ Yerel Byzantine doğrulaması: ${eliminated} soru elendi (kaynak metinle çelişen sayısal değerler). Kalan: ${questions.length}`)
                        } else {
                          console.log(`[BG] [YEREL BYZ] ✅ Tüm sorular yerel doğrulamadan geçti.`)
                        }
                      }
                    }

                    // DAĞILIM KONTROLÜ VE TELAFİSİ (Soru 09 - Adım 3)
                    const totalQForDiff = questions.length;
                    if (totalQForDiff >= 3) {
                      const easyCount = questions.filter(q => (q.difficulty || "medium").toLowerCase() === "easy").length;
                      const mediumCount = questions.filter(q => {
                        const d = (q.difficulty || "medium").toLowerCase();
                        return d === "medium" || d === "normal";
                      }).length;
                      const hardCount = questions.filter(q => {
                        const d = (q.difficulty || "medium").toLowerCase();
                        return d === "hard" || d === "difficult";
                      }).length;

                      const easyPct = easyCount / totalQForDiff;
                      const mediumPct = mediumCount / totalQForDiff;
                      const hardPct = hardCount / totalQForDiff;

                      const easyDiff = Math.abs(easyPct - 0.3);
                      const mediumDiff = Math.abs(mediumPct - 0.4);
                      const hardDiff = Math.abs(hardPct - 0.3);

                      if (easyDiff > 0.15 || mediumDiff > 0.15 || hardDiff > 0.15) {
                        console.log(`[BG] [DAĞILIM KONTROLÜ] ⚠️ Zorluk dağılımı hedef dışı (Sapma > %15): Kolay %${(easyPct*100).toFixed(0)}, Orta %${(mediumPct*100).toFixed(0)}, Zor %${(hardPct*100).toFixed(0)}`);
                        let missingDifficulty: "easy" | "medium" | "hard" = "medium";
                        let maxGap = 0;
                        if (0.3 - easyPct > maxGap) {
                          maxGap = 0.3 - easyPct;
                          missingDifficulty = "easy";
                        }
                        if (0.4 - mediumPct > maxGap) {
                          maxGap = 0.4 - mediumPct;
                          missingDifficulty = "medium";
                        }
                        if (0.3 - hardPct > maxGap) {
                          maxGap = 0.3 - hardPct;
                          missingDifficulty = "hard";
                        }

                        if (maxGap > 0.05) {
                          console.log(`[BG] [DAĞILIM TELAFİ] Eksik zorluk seviyesi tespit edildi: "${missingDifficulty}". Ek üretim tetikleniyor...`);
                          try {
                            const extraQuestions = await generateQuestions(
                              finalContent + `\n\n⚠️ KESİN DAĞILIM DENGELENMESİ TALİMATI: Üreteceğin tüm soruların zorluk seviyesi (difficulty) KESİNLİKLE "${missingDifficulty}" olmalıdır. Diğer zorluk derecelerinde kesinlikle soru üretme!`,
                              section.title,
                              fullCourseName,
                              course.userLevel,
                              aiMode,
                              undefined,
                              section.pageStart,
                              section.pageEnd,
                              section.importance || undefined,
                              effectiveRaw,
                              course.documentType
                            );

                            if (extraQuestions && extraQuestions.length > 0) {
                              // NORMALİZASYON: Şıkları 'A) ', 'B) ' formatına zorla
                              const normalizedExtra = extraQuestions.map((q: any) => {
                                if (q.options && Array.isArray(q.options)) {
                                  q.options = q.options.map((opt: string) => {
                                    return opt.replace(/^[A-Ea-e][.)]\s*/, "").trim();
                                  }).map((opt: string, index: number) => {
                                    const letter = String.fromCharCode(65 + index);
                                    return `${letter}) ${opt}`;
                                  });
                                }
                                return q;
                              });

                              const extraAdversarial = await validateQuestionsAdversarial(finalContent, normalizedExtra);
                              if (extraAdversarial.questions.length > 0) {
                                const combined = [...questions, ...extraAdversarial.questions];
                                const sortedByGoal = combined.sort((a, b) => {
                                  const aDiff = (a.difficulty || "medium").toLowerCase();
                                  const bDiff = (b.difficulty || "medium").toLowerCase();
                                  if (aDiff === missingDifficulty && bDiff !== missingDifficulty) return -1;
                                  if (bDiff === missingDifficulty && aDiff !== missingDifficulty) return 1;
                                  return 0;
                                });
                                questions = sortedByGoal.slice(0, originalCount);
                                console.log(`[BG] [DAĞILIM TELAFİ] ✅ Dengeleme tamamlandı. Yeni zorluk sayıları: Kolay: ${questions.filter(q => (q.difficulty || "medium").toLowerCase() === "easy").length}, Orta: ${questions.filter(q => (q.difficulty || "medium").toLowerCase() === "medium" || (q.difficulty || "medium").toLowerCase() === "normal").length}, Zor: ${questions.filter(q => (q.difficulty || "medium").toLowerCase() === "hard" || (q.difficulty || "medium").toLowerCase() === "difficult").length}`);
                              }
                            }
                          } catch (dağılımErr: any) {
                            console.error(`[BG] [DAĞILIM TELAFİ] Dengeleme üretimi başarısız:`, dağılımErr.message);
                          }
                        }
                      }
                    }

                    const qContract = await runStageWithContract(qualityChain, "questions", async () => ({
                      pass: questions.length > 0,
                      contentForHash: JSON.stringify(questions.map((q) => q.text?.slice(0, 60))),
                      metrics: { count: questions.length, adversarial: { pass1: originalCount, pass2: originalCount, final: questions.length } },
                    }));
                    qualityChain = qContract.chain

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
                  if (qAttempt === 3) {
                    console.error(`[BG] ❌ Soru üretimi atlandı.`)
                    try {
                      await applySectionIssuesPatch({
                        questionsGenerationFailed: true,
                        currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Soru üretimi başarısız oldu.`
                      })
                    } catch (dbErr) {
                      console.error("[BG] ❌ Soru hata durumunu kaydetme hatası:", dbErr)
                    }
                  } else {
                    await new Promise(r => setTimeout(r, 10000))
                  }
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
            if (STRICT_READY_GATE()) {
              isSectionApproved = false
              console.error(
                `[BG] 🛑 [${finalTitle}] Eksik içerik (${missingContent.join(", ")}) — STRICT_READY_GATE: bölüm onaylanmadı.`,
              )
            } else {
              console.error(
                `[BG] ⚠️ [${finalTitle}] Eksik içerik var (${missingContent.join(", ")}). Ancak notlar 100 puan aldığı için bölüm ONAYLANDI kabul edilecek.`,
              )
            }
          }

          const publishContract = await runStageWithContract(qualityChain, "publish", async () => {
            const gate = evaluatePublishGate({
              qualityChain,
              notesAttemptSuccess,
              missingContent,
              verificationScore: currentScore,
              skipOcr: !shouldRunMarkdownOcr(section.rawContent),
            })
            return {
              pass: gate.allowPublish && isSectionApproved,
              contentForHash: `${section.id}|${currentScore}|${isSectionApproved}`,
              errors: gate.reason ? [gate.reason] : undefined,
            }
          })
          qualityChain = publishContract.chain
          if (QUALITY_CONTRACT_ENABLED() && !publishContract.gate.pass) {
            isSectionApproved = false
            console.error(`[BG] 🛑 Publish gate: ${publishContract.gate.errors?.join("; ")}`)
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
                        published: isSectionApproved && missingContent.length === 0,
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
            const glossaryResult = extractStructuredGlossary(notes, effectiveRaw, finalTitle)
            const dict = glossaryResult.dict
            if (glossaryResult.crossCheck.mismatch.length > 0) {
              console.warn(`[BG] ⚠️ Sözlük çapraz kontrol uyumsuzluk: ${glossaryResult.crossCheck.mismatch.length} terim`)
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
    const totalSectionCount = await prisma.section.count({ where: { courseId: course.id, isStudyUnit: true } })
    const processedSectionCount = await prisma.section.count({
      where: { courseId: course.id, processed: true, isStudyUnit: true },
    })
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

export function countMarkdownTables(text: string): number {
  const lines = text.split("\n")
  let tableCount = 0
  let inTable = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        tableCount++
        inTable = true
      }
    } else {
      inTable = false
    }
  }
  return tableCount
}

