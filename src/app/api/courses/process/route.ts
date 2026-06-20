import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  extractAllText,
  checkPdfQuality,
  assessPdfSearchability,
  detectSectionsMultimodal,
  joinPageTextsForRange,
  NATIVE_TEXT_LOG_MESSAGE,
  SCANNED_PDF_PENDING_OCR,
  isPendingOcrContent,
  shouldRunMarkdownOcr,
  prepareSearchablePdfSectionContent,
} from "@/lib/pdf-engine"
import {
  buildSingleSectionFromPages,
  detectSectionsSystematic,
  sectionsToDetected,
} from "@/lib/section-detector"
import { analyzeSectionContent, generateCourseNotes, generateFlashcards, generateQuestions, setFileUrisMap, auditNotesAgainstSourceSpecific, validateQuestionsWithSolver, validateFlashcardsWithSolver, verifyNotesAgainstSource, needsBilingualStudyItems, translateFlashcardsToEnglish, translateQuestionsToEnglish, validateBilingualPairs, ApiQuotaExhaustedError, OcrChunkRateLimitError } from "@/lib/ai-service"
import { resolveRequiresQuestions } from "@/lib/glossary-utils"
import { getExamConfig, getCourseBySlug } from "@/lib/course-data"
import {
  formatProcessingProfileLog,
  getDocumentNoteInstructions,
  getDocumentProcessingProfile,
} from "@/lib/document-processing-profile"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import {
  getStudyNotFoundMessage,
  getNotesGenerationPhaseLabel,
  isProfessionalProgram,
} from "@/lib/program-catalog"
import { readFile } from "fs/promises"
import {
  activeProcesses,
  cancelCourseProcessing,
  clearCancelSignal,
  clearHeartbeat,
  hasFreshHeartbeat,
  isCancelled,
  isHeartbeatStale,
  isWorkerLive,
  recordHeartbeat,
  releaseProcessing,
  STALE_PROCESS_MAX_AGE_MS,
  tryClaimProcessing,
} from "@/lib/process-registry"
import { pauseOrphanedProcessingOnBoot } from "@/lib/process-startup"
import {
  HEARTBEAT_STALE_MESSAGE,
  clearProcessTriggerDebounce,
  pauseGhostProcessingInDb,
} from "@/lib/course-processing-status"
import {
  isAdminSession,
  MAX_NOTES_GENERATION_RETRIES,
  MAX_OCR_ROUTE_ATTEMPTS,
  MAX_QUOTA_FAILURES_PER_SECTION,
  MAX_SECTION_OUTER_RETRIES,
  PROCESS_TRIGGER_DEBOUNCE_MS,
  RECENT_API_ACTIVITY_MS,
  computeDebounceRemainingMs,
  debounceUntilIso,
  sectionsLookValid,
  shouldApplyProcessTriggerDebounce,
} from "@/lib/quota-guard"
import {
  mergeVerificationIssues,
  stringifyMergedVerificationIssues,
} from "@/lib/section-quality-gates"

// Chapter/section detection patterns for Turkish academic PDFs
const SECTION_PATTERNS = [
  /^(BÖLÜM|Bölüm|bölüm)\s*(\d+)\s*[:.–-]\s*(.+)/,
  /^(KONU|Konu)\s*(\d+)\s*[:.–-]\s*(.+)/,
  /^(\d+)\.\s+(BÖLÜM|KONU|KISIM)\s*[:.–-]?\s*(.+)/i,
  /^(\d+)\.\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü\s]{10,})/,
  /^(ÜNİTE|Ünite)\s*(\d+)\s*[:.–-]\s*(.+)/,
  /^\d+\.\d*\s+[A-ZÇĞİÖŞÜ]{2,}/,
]

interface DetectedSection {
  title: string
  pageStart: number
  pageEnd: number
  content: string
  module?: string
}

// ==================== KARAKTER BAZLI CHUNK BOYUTU ====================
// Büyük chunk = daha derin içerik, daha kaliteli sorular
// 1 sayfa ortalama ~2000 karakter → 12-15 sayfa = 25000 karakter
// Küçük chunk'lar sığ/tekrarlı içerik üretiyor!
const MAX_CHUNK_CHARS = 12000 // ~5 sayfa = daha detaylı, eksik konu riski düşük

/** Son birkaç dakikada bu derse ait API hareketi var mı? Yoksa arka plan işi kopmuş olabilir. */
async function hasRecentCourseApiActivity(slug: string): Promise<boolean> {
  const since = new Date(Date.now() - RECENT_API_ACTIVITY_MS)
  const hit = await prisma.apiUsageLog.findFirst({
    where: {
      createdAt: { gte: since },
      courseSlug: slug,
    },
    select: { id: true },
  })
  return !!hit
}

export async function POST(req: NextRequest) {
  try {
    await pauseOrphanedProcessingOnBoot()

    const body = await req.json()
    const session = await getServerSession(authOptions)
    const isCron = Boolean(process.env.CRON_SECRET && body.secretToken === process.env.CRON_SECRET)
    if (!session?.user?.email && !isCron) {
      console.warn("[PROCESS] 🔴 Yetkisiz tetikleme engellendi.")
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const { slug, forceRetry = false, userInitiated = false, source: bodySource } = body
    if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 })

    const explicitResume = userInitiated || forceRetry

    // 🚨 SIFIR OTOMATİK TETİKLEME — yalnızca kullanıcı butonu / zorla / cron
    if (!explicitResume && !isCron) {
      console.warn(`[PROCESS] 🔴 Kullanıcı onayı olmadan tetikleme reddedildi: ${slug}`)
      return NextResponse.json(
        {
          error: "İşleme yalnızca «İşleme Başlat» veya «Devam Ettir» ile başlatılabilir.",
          needsUserAction: true,
        },
        { status: 403 },
      )
    }

    const course = await prisma.course.findUnique({
      where: { slug },
      include: { program: true }
    })
    if (!course) {
      return NextResponse.json(
        { error: `${getStudyNotFoundMessage(slug.startsWith("zeliha-") ? "zeliha-mevzuat" : "")}.` },
        { status: 404 },
      )
    }

    const isAdmin = isAdminSession(session?.user)

    if (forceRetry && !isAdmin && !isCron) {
      console.warn(`[PROCESS] 🔴 Zorla devam yalnızca yönetici: ${slug}`)
      return NextResponse.json(
        { error: "Zorla devam yalnızca yönetici hesabıyla kullanılabilir." },
        { status: 403 },
      )
    }

    const workerAlive =
      course.status === "processing" && isWorkerLive(slug)
    const heartbeatFresh = hasFreshHeartbeat(slug)

    const recentDuplicate = await prisma.processTriggerLog.findFirst({
      where: {
        courseSlug: slug,
        createdAt: { gte: new Date(Date.now() - PROCESS_TRIGGER_DEBOUNCE_MS) },
      },
      orderBy: { createdAt: "desc" },
    })

    const debounceApplies =
      recentDuplicate &&
      shouldApplyProcessTriggerDebounce({
        workerLive: workerAlive,
        courseStatus: course.status,
        hasFreshHeartbeat: heartbeatFresh,
      })

    if (debounceApplies && !(forceRetry && isAdmin)) {
      const retryAfterMs = computeDebounceRemainingMs(recentDuplicate!.createdAt)
      console.warn(
        `[PROCESS] 🔴 60 sn içinde tekrar tetikleme reddedildi (işçi canlı): ${slug}`,
      )
      return NextResponse.json(
        {
          message: `Bu modüle az önce işlem başlatıldı. Lütfen ${Math.ceil(retryAfterMs / 1000)} saniye bekleyin.`,
          duplicateTrigger: true,
          alreadyRunning: workerAlive,
          workerLive: workerAlive,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
          debounceUntil: debounceUntilIso(recentDuplicate!.createdAt),
        },
        { status: 429 },
      )
    }

    if (recentDuplicate && !debounceApplies) {
      console.log(
        `[PROCESS] 🧹 Eski tetikleme kaydı — işçi yok, debounce atlanıyor: ${slug}`,
      )
      await clearProcessTriggerDebounce(slug)
    }

    if (workerAlive && !(forceRetry && isAdmin)) {
      console.log(`[PROCESS] 🔒 Tek uçuş kilidi: ${course.name} zaten işleniyor`)
      return NextResponse.json(
        {
          message: "Bu modül zaten işleniyor. Bitmesini bekleyin; tekrar «Devam Ettir» tıklamayın.",
          alreadyRunning: true,
        },
        { status: 200 },
      )
    }

    try {
      const triggerSource = isCron
        ? "cron"
        : (bodySource as string) ||
          (forceRetry ? "force_retry" : userInitiated ? "user_button" : "unknown")
      await prisma.processTriggerLog.create({
        data: {
          courseSlug: slug,
          userId: session?.user?.id ?? null,
          userEmail: session?.user?.email ?? null,
          forceRetry: Boolean(forceRetry),
          source: triggerSource,
        },
      })
      console.log(
        `[PROCESS] 📋 Tetikleme kaydı: ${slug} ← ${triggerSource} (${session?.user?.email ?? "cron"})`,
      )
    } catch (auditErr) {
      console.warn("[PROCESS] Tetikleme kaydı yazılamadı:", auditErr)
    }

    // İptal edilmiş iş — kullanıcı açıkça devam ettirmedikçe yeniden başlatma
    if (isCancelled(slug, course.name) && !explicitResume) {
      console.log(`[PROCESS] 🛑 İptal edilmiş iş — otomatik devam engellendi: ${course.name}`)
      return NextResponse.json(
        {
          message: "Bu modül durdurulmuş. Devam ettirmek için «Devam Ettir» butonuna tıklayın.",
          needsUserAction: true,
        },
        { status: 200 },
      )
    }

    if (explicitResume) {
      clearCancelSignal(slug, course.name)
    }

    recordHeartbeat(slug, true)

    // Duraklatılmış / hatalı modül — sayfa açılışı veya arka plan tetiklemesiyle otomatik başlatma
    if ((course.status === "paused" || course.status === "error") && !explicitResume) {
      console.log(`[PROCESS] ⏸️ Duraklatılmış modül — kullanıcı onayı olmadan başlatılmıyor: ${course.name}`)
      return NextResponse.json(
        {
          message: "Modül duraklatılmış. Devam ettirmek için «Devam Ettir» butonuna tıklayın.",
          needsUserAction: true,
        },
        { status: 200 },
      )
    }

    const staleProcess =
      course.status === "processing" &&
      !explicitResume &&
      !(await hasRecentCourseApiActivity(slug)) &&
      !activeProcesses.has(slug)

    const processAgeMs = Date.now() - course.updatedAt.getTime()
    const isOldProcessing =
      course.status === "processing" && processAgeMs > STALE_PROCESS_MAX_AGE_MS && !explicitResume

    // Kopuk veya çok eski işlem — OTOMATİK DEVAM ETME, duraklat
    if ((staleProcess || isOldProcessing) && !explicitResume) {
      const pauseMessage =
        "Eski arka plan işi duraklatıldı (otomatik devam kapalı). «Devam Ettir» ile yeniden başlatın."
      console.log(`[PROCESS] 🧟 Kopuk/eski işlem duraklatıldı (otomatik devam yok): ${course.name}`)
      releaseProcessing(slug)
      const pendingSection = await prisma.section.findFirst({
        where: { courseId: course.id, processed: false },
        orderBy: { order: "asc" },
        select: { id: true, verificationIssues: true },
      })
      if (pendingSection) {
        await prisma.section.update({
          where: { id: pendingSection.id },
          data: {
            verificationIssues: stringifyMergedVerificationIssues(pendingSection.verificationIssues, {
              currentMicroPhase: pauseMessage,
              pauseReason: staleProcess ? "stale_worker" : "stale_age",
              pausedAt: new Date().toISOString(),
            }),
          },
        })
      }
      await prisma.course.update({
        where: { slug },
        data: { status: "paused", updatedAt: new Date() },
      })
      return NextResponse.json(
        { message: pauseMessage, stalePaused: true, needsUserAction: true },
        { status: 200 },
      )
    }

    // 🔒 TEK GLOBAL İŞ — başka bir ders işlenirken yeni iş başlatma
    const globalBlock = tryClaimProcessing(slug)
    if (!globalBlock.ok && !forceRetry) {
      console.log(`[PROCESS] 🔒 Global kilit: ${course.name} bekliyor (${globalBlock.blockedBy} aktif)`)
      return NextResponse.json(
        {
          message: `Başka bir modül işleniyor. Lütfen önce onun bitmesini bekleyin veya durdurun.`,
          alreadyRunning: true,
          blockedBy: globalBlock.blockedBy,
        },
        { status: 200 },
      )
    }

    // 🔒 ÇİFT TIKLAMA KORUMASI — gerçekten çalışan işlemi koru
    if (course.status === "processing" && !explicitResume) {
      const timeSinceLastUpdate = Date.now() - course.updatedAt.getTime()

      if (timeSinceLastUpdate < 15 * 60 * 1000) {
        console.log(`[PROCESS] ⚠️ Zaten işlemde (${Math.round(timeSinceLastUpdate / 1000)}sn önce güncellendi): ${course.name}`)
        return NextResponse.json(
          { message: "İşlem arka planda aktif olarak devam ediyor. Lütfen bekleyin.", alreadyRunning: true },
          { status: 200 },
        )
      }
      if (!forceRetry) {
        console.log(`[PROCESS] ⏸️ 15 dk hareketsiz — otomatik devam yok, duraklatılıyor: ${course.name}`)
        releaseProcessing(slug)
        await prisma.course.update({
          where: { slug },
          data: { status: "paused", updatedAt: new Date() },
        })
        return NextResponse.json(
          {
            message: "İşlem yanıt vermiyor. «Devam Ettir» veya «Zorla» ile yeniden başlatın.",
            needsUserAction: true,
          },
          { status: 200 },
        )
      }
      console.log(`[PROCESS] 🔄 Zorla devam: ${course.name}`)
    }

    if (forceRetry) {
      releaseProcessing(slug)
      tryClaimProcessing(slug)
    }

    if (activeProcesses.has(slug) && course.status === "processing" && isWorkerLive(slug) && !explicitResume) {
      console.log(`[PROCESS] ⚠️ Bellekte aktif işlem: ${course.name}`)
      return NextResponse.json(
        { message: "İşlem zaten arka planda devam ediyor. Lütfen birkaç dakika bekleyin.", alreadyRunning: true },
        { status: 200 },
      )
    }

    if (!activeProcesses.has(slug)) {
      tryClaimProcessing(slug)
    }

    // Update status
    await prisma.course.update({
      where: { slug },
      data: { status: "processing" }
    })

    // Zombi dedektörünün anında öldürmesini engellemek için kalan bölümlerin updatedAt'ini tazele
    await prisma.section.updateMany({
      where: { courseId: course.id, processed: false },
      data: { updatedAt: new Date() },
    })

    // Read PDF buffer
    if (!course.pdfPath) throw new Error("PDF Path not found");
    const pdfBuffer = await readFile(course.pdfPath)
    const totalPages = course.totalPages

    // ========== PHASE 1 & 2: Extract text & detect sections (hızlı, senkron) ==========
    const existingSections = await prisma.section.count({ where: { courseId: course.id } })
    const existingSectionRows =
      existingSections > 0
        ? await prisma.section.findMany({
            where: { courseId: course.id },
            select: { pageStart: true, pageEnd: true, title: true },
            orderBy: { order: "asc" },
          })
        : []

    if (existingSections > 0 && sectionsLookValid(existingSectionRows)) {
      console.log(
        `[PROCESS] Devam: ${existingSections} bölüm zaten var (sayfa aralıkları geçerli) — bölüm algılama atlanıyor`,
      )
    } else if (existingSections === 0) {
      console.log(`[PROCESS] İlk işleme: ${course.name} (${totalPages} sayfa)...`)

      const pageTexts = await extractAllText(pdfBuffer)

      // ⚠️ PDF KALİTE KONTROLÜ — aranabilir PDF yerel metinle bölümlenir; görsel okuma arka planda yine çalışır
      const pdfSearchability = assessPdfSearchability(pageTexts)
      const pdfQuality = checkPdfQuality(pageTexts, totalPages)
      const isScannedPdf = pdfSearchability.isNonSearchable

      if (pdfSearchability.isSearchable) {
        console.log(
          `[PROCESS] ✅ ${NATIVE_TEXT_LOG_MESSAGE} (${pdfSearchability.totalChars} karakter, ${pageTexts.length} sayfa, ortalama ${Math.round(pdfSearchability.avgCharsPerPage)}/sayfa)`,
        )
      } else if (isScannedPdf) {
        console.warn(`[PROCESS] 📷 Taranmış PDF algılandı (metin katmanı yok). Görsel OCR yoluna yönlendiriliyor — RED EDİLMEDİ.`)
      } else if (pdfQuality.isPartiallySearchable) {
        console.warn(`[PROCESS] ⚠️ KISMEN SEARCHABLE: ${pdfQuality.message}`)
      }

      await prisma.course.update({
        where: { slug },
        data: { processedPages: isScannedPdf ? totalPages : pageTexts.length }
      })
      console.log(`[PROCESS] ${isScannedPdf ? "Taranmış PDF — OCR bekliyor" : `${pageTexts.length} sayfadan metin çıkarıldı`}.`)

      const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").split(",").filter(k => k.trim())

      let sections: DetectedSection[] = []
      let tocAttempts = 0
      const MAX_TOC_ATTEMPTS = 3

      if (isScannedPdf) {
        // Taranmış PDF: metin tabanlı bölümleme çalışmaz → görsel multimodal bölümleme veya tek bölüm
        console.log(`[PROCESS] 📷 Taranmış PDF bölüm algılama: görsel multimodal yol deneniyor...`)
        if (course.geminiFileUri && geminiKeys.length > 0) {
          try {
            const multimodalSections = await detectSectionsMultimodal(course.geminiFileUri, geminiKeys[0])
            if (multimodalSections.length >= 1) {
              sections = multimodalSections.map((s) => ({
                title: s.title,
                pageStart: Math.max(1, s.pageStart),
                pageEnd: Math.min(totalPages, s.pageEnd),
                content: SCANNED_PDF_PENDING_OCR,
              }))
              console.log(`[PROCESS] ✅ Görsel bölümleme: ${sections.length} bölüm algılandı (OCR arka planda dolduracak).`)
            }
          } catch (mmErr: any) {
            console.warn(`[PROCESS] ⚠️ Görsel bölümleme başarısız: ${mmErr.message?.substring(0, 120)}`)
          }
        }
        if (sections.length === 0) {
          sections = [{
            title: "Bölüm İçeriği (Ana Metin)",
            pageStart: 1,
            pageEnd: totalPages,
            content: SCANNED_PDF_PENDING_OCR,
          }]
          console.log(`[PROCESS] 📷 Tek bölüm modu: tüm kitap (${totalPages} sayfa) OCR ile işlenecek.`)
        }
      } else {
        const programSlug = course.program?.slug || ""
        const aiMode = course.program?.aiMode || "general"
        const staticMeta = getCourseBySlug(slug)
        const processingProfile = getDocumentProcessingProfile({
          slug,
          name: course.name,
          sourceKind: staticMeta?.sourceKind,
          sourceKindLabel: staticMeta?.sourceKindLabel,
          gridGroup: staticMeta?.gridGroup,
          programSlug,
          aiMode,
          totalPages: pageTexts.length,
        })

        console.log(`[PROCESS] ${formatProcessingProfileLog(processingProfile, slug)}`)

        if (processingProfile.mode === "single") {
          sections = buildSingleSectionFromPages(pageTexts, course.name)
        } else {
          while (sections.length === 0 && tocAttempts < MAX_TOC_ATTEMPTS) {
            tocAttempts++
            console.log(`[PROCESS] 🔄 Sistematik bölüm algılama (Deneme ${tocAttempts}/${MAX_TOC_ATTEMPTS})...`)

            const result = await detectSectionsSystematic(pageTexts, {
              geminiFileUri: course.geminiFileUri,
              geminiKeys,
              logCourseSlug: slug,
            })

            if (result && result.sections.length >= 2 && result.validation.valid) {
              sections = sectionsToDetected(result.sections, pageTexts)
              console.log(
                `[PROCESS] ✅ Sistematik: ${result.sections.length} bölüm (${result.titleSource}, doğrulama skoru ${result.validation.score})`
              )
              break
            }

            if (result) {
              console.warn(
                `[PROCESS] ⚠️ Sistematik algılama yetersiz (skor ${result.validation.score}): ${result.validation.errors.join("; ")}`
              )
            }

            if (tocAttempts < MAX_TOC_ATTEMPTS) {
              const waitMinutes = Math.min(Math.pow(2, tocAttempts - 1), 5)
              const waitMs = waitMinutes * 60000
              console.log(`[PROCESS] ⏱️ ${waitMinutes} dakika beklenip tekrar denenecek...`)
              await new Promise((resolve) => setTimeout(resolve, waitMs))
            }
          }
        }

      }

    // Bölüm algılanamazsa dur — tek parça veya elle tablo yok (otonom sistem).
    if (sections.length === 0) {
      releaseProcessing(slug)
      await prisma.course.update({ where: { slug }, data: { status: "error" } })
      console.error(`[PROCESS] 🛑 Bölüm algılama başarısız — işlem durduruldu (${course.name}).`)
      return NextResponse.json(
        {
          error:
            "PDF bölümleri otomatik algılanamadı (içindekiler okunamadı veya doğrulama geçmedi). Kitabın fiziksel sayfa sırasına göre içindekiler sayfasını kontrol edip PDF'i yeniden yükleyin.",
        },
        { status: 422 }
      )
    }

    // ⚠️ İÇİNDEKİLER / ÖNSÖZ / KAPAK FİLTRESİ
    // Bu sayfalar not üretimi için anlamsızdır — filtrelenir
    const TOC_KEYWORDS = ["İÇİNDEKİLER", "ÖNSÖZ", "FOREWORD", "TABLE OF CONTENTS", "PREFACE", "SUNUŞ"]
    sections = sections.filter(sec => {
      const titleUpper = sec.title.toLocaleUpperCase("tr-TR")
      const contentFirst500 = sec.content.substring(0, 500).toLocaleUpperCase("tr-TR")
      const isTocOrForeword = TOC_KEYWORDS.some(kw => titleUpper.includes(kw) || contentFirst500.includes(kw))
      if (isTocOrForeword && sec.content.length < 3000) {
        console.log(`[PROCESS] 🗑️ İçindekiler/önsöz filtresi: "${sec.title}" (Sayfa ${sec.pageStart}-${sec.pageEnd}) atlandı.`)
        return false
      }
      return true
    })

    console.log(`[PROCESS] ${sections.length} bölüm algılandı (İçindekiler filtresi sonrası).`)

    // ⚠️ KAYNAKÇA BÖLÜMÜ FİLTRESİ (TAMAMEN SİLME)
    // Kaynakça sınavda sorulmaz — UI'da veya veritabanında yer kaplamaması için tamamen atılır
    const BIBLIO_KEYWORDS = ["KAYNAKÇA", "KAYNAKLAR", "REFERENCES", "BİBLİYOGRAFYA", "SINAV ALT KONU"]
    sections = sections.filter(sec => {
      const titleUpper = sec.title.toLocaleUpperCase("tr-TR")
      const isBibliography = BIBLIO_KEYWORDS.some(kw => titleUpper.includes(kw))
      if (isBibliography) {
        console.log(`[PROCESS] 🗑️ Kaynakça filtresi: "${sec.title}" (Sayfa ${sec.pageStart}-${sec.pageEnd}) veritabanına eklenmeyecek.`)
        return false
      }
      return true
    })

    console.log(`[PROCESS] ${sections.length} bölüm algılandı (Tüm filtreler sonrası).`)

    // Aranabilir PDF: yerel metin bölüm ham içeriğine yazılır — görsel okuma arka planda yapılır (şema/resim kaçmasın)
    if (pdfSearchability.isSearchable) {
      for (let i = 0; i < sections.length; i++) {
        const nativeRange = joinPageTextsForRange(
          pageTexts,
          sections[i].pageStart,
          sections[i].pageEnd,
        )
        const prepared = prepareSearchablePdfSectionContent(
          nativeRange.length >= sections[i].content.length
            ? nativeRange
            : sections[i].content,
        )
        if (prepared !== sections[i].content) {
          console.log(
            `[PROCESS] 📄 ${NATIVE_TEXT_LOG_MESSAGE} — "${sections[i].title}" (${prepared.length} karakter)`,
          )
          sections[i].content = prepared
        }
      }
    }

    for (let i = 0; i < sections.length; i++) {
      await prisma.section.create({
        data: {
          courseId: course.id,
          title: sections[i].title,
          order: i + 1,
          pageStart: sections[i].pageStart,
          pageEnd: sections[i].pageEnd,
          rawContent: sections[i].content,
          module: sections[i].module || "Genel",
          processed: false,
          notes: null,
        }
      })
    }
  } else {
    console.log(`[PROCESS] Devam: ${existingSections} bölüm zaten var, kaldığı yerden devam ediliyor...`)
  }

  // ========== PHASE 3+4: AI Analysis + Schedule — ARKA PLANDA ==========
  // HTTP response'u hemen dön. AI analizi Node.js event loop'unda arka planda devam eder.
  // Bu sayede Next.js API route timeout (~60sn) sorunu çözülür.
  (async () => {
    try {
      await processInBackground(slug, course)
    } catch (err: any) {
      console.error("[BG] FATAL ERROR in background process:", err)
      await finalizeCourseStatusIfStillProcessing(slug, "error").catch(() => { })
    }
  })().catch(error => {
    console.error("[PROCESS_FATAL]", error);
  })

  return NextResponse.json({
    success: true,
    message: "İşleme başlatıldı",
    status: "processing",
    workerLive: true,
  })
} catch (error: any) {
  console.error("[PROCESS_FATAL]", error);
  return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 })
}
}

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

export async function processInBackground(slug: string, course: any) {
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
      if (isHeartbeatStale(slug)) {
        console.log(`[BG] 💔 Heartbeat kopuk — ${course.name} duraklatılıyor`)
        cancelCourseProcessing(slug, course.name)
        clearHeartbeat(slug)
        try {
          await pauseGhostProcessingInDb(
            course.id,
            slug,
            HEARTBEAT_STALE_MESSAGE,
            "heartbeat_stale",
          )
        } catch (pauseErr) {
          console.warn("[BG] Heartbeat duraklatma DB yazılamadı:", pauseErr)
        }
        return true
      }
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
      const fullCourseName = `${course.program?.name || "SPL Düzey 3"} > ${course.name}`;

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

          // Eğer halihazırda yüksek puanlı notlar varsa kalite döngüsünü atla
          if (notes && notes.length > 500 && currentScore >= 98) {
            console.log(`[BG] 🌟 [${section.title}] Zaten kusursuz (%${currentScore}) notlara sahip. Not üretimi atlanıyor, doğrudan eksik materyaller (soru/flashcard) üretilecek.`)
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
          if (!notesAttemptSuccess) {
            const loopTarget = startingAttempt + MAX_RETRIES - 1;
            for (let vAttempt = startingAttempt; vAttempt <= loopTarget; vAttempt++) {
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
                    console.log(`[BG] 📊 Karar Matrisi Çalıştırılıyor: Yapısal Puan=${kontrolorStructuralScore}, Çelişki=${contradictionCount}, Eksik=${missingCount}`);
                    
                    // Frankenstein Kuralı: Hata yoğunluğu %15'i aşarsa veya pedagojik skor 75'in altındaysa sıfırdan yazım
                    const blockCount = Math.max(10, notes.split('\n\n').length);
                    const totalDefects = missingCount + contradictionCount;
                    const defectDensity = totalDefects / blockCount;
                    
                    if (kontrolorStructuralScore >= 75 && defectDensity <= 0.15 && totalDefects > 0) {
                      console.log(`[BG] 🧠 KARAR MATRİSİ ONAYLANDI: ${totalDefects} Toplam Hata, Yoğunluk: %${(defectDensity*100).toFixed(1)}, Pedagojik Puan: %${kontrolorStructuralScore}. Not Donduruluyor ve Cerrahi Yama (AST) Başlıyor...`);
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

                      const allFactsToPatch = [...cleanMissingFacts, ...cleanContradictions];

                      try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama: Cerrahi Yama (AST) Uygulanıyor...` }) } catch { }

                      const fullCourseName = `${course.program?.name || "SPL Düzey 3"} > ${course.name}`;
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

                // Doğrulama yap - KÖKLÜ VE TUTARLI ÇÖZÜM: Sayfa çakışmalarını ve mükerrerlikleri tamamen engellemek için,
                // not doğrulama aşamasında PDF dosyasını (fileUri) pas geçerek SADECE veritabanındaki izole rawContent kullanılır!
                console.log(`[BG] Not Doğrulanıyor (Deneme #${vAttempt})...`)
                try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Aşama 3: Kalite Kontrolörü Tarafından İnceleniyor (Tur #${vAttempt})` }) } catch { }
                const verification = await verifyNotesAgainstSource(
                  section.rawContent, notes, section.title, fullCourseName, sourceMode,
                  documentProfile.documentType,
                )

                // score: -1 -> teknik hata, deneme hakkı yeme
                if (verification.score === -1) {
                  console.warn(`[BG] ⚠️ Doğrulama API hatası. Deneme hakkı yenmedi, 30sn bekleniyor...`)
                  await new Promise(r => setTimeout(r, 30000))
                  vAttempt-- // Bu deneme sayılmasın
                  continue
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
                  // KOTA TASARRUFU: İlk turda Müfettiş denetimini atla — Kontrolör %100 yeterli.
                  // 2. turdan itibaren Müfettiş devreye girer (kalite güvencesi korunur).
                  if (vAttempt <= 1) {
                    console.log(`[BG] ⏩ İlk tur: Müfettiş atlanıyor, Kontrolör %100 yeterli.`)
                    notesAttemptSuccess = true

                    if (historyEntry) {
                      historyEntry.mufettis = false
                      historyEntry.fullyApproved = true
                    }

                    try {
                      await applySectionIssuesPatch(
                        {
                          message: "Kontrolör onayı tamamlandı (ilk tur — Müfettiş atlandı).",
                          currentAttempt: vAttempt,
                          attemptHistory: attemptHistory,
                          missingTopics: [],
                          issues: [],
                          stages: {
                            notesGenerated: true,
                            kontrolorGroundTruth: true,
                            mufettis: false,
                            cerrahiYama: false,
                            flashcards: false,
                            questions: false,
                            published: false,
                          },
                          currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Kontrolör onayı tamamlandı`,
                        },
                        { notes: notes, verificationScore: 100 },
                      )
                      console.log(`[BG] 💾 İlk tur %100 not veritabanına kaydedildi.`)
                    } catch (saveErr) {
                      console.error(`[BG] ❌ Not kaydetme hatası:`, saveErr)
                    }

                    break
                  }

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
                          const fullCourseName = `${course.program?.name || "SPL Düzey 3"} > ${course.name}`;
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
                            published: false,
                          },
                          currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Kontrolör ve Müfettiş onayı tamamlandı`,
                        },
                        { notes: notes, verificationScore: 100 },
                      )
                      console.log(`[BG] 💾 %100 Kusursuz Not Anında Veritabanına Kazındı!`)
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

          // ==================== DOĞRULANMIŞ NOT ÜZERİNDEN DERS ÖĞELERİNİ ÜRETME ====================

          let flashcards: any[] = []
          let questions: any[] = []
          let analysis: any = {}
          let finalTitle = section.title
          let requiresQuestions = true

          if (!notesAttemptSuccess) {
            console.warn(`[BG] ⚠️ [${section.title}] Bölüm %100 onaylanmadı! Soru ve flashcard üretimi KESİNLİKLE atlanıyor...`);
          } else {
            console.log(`[BG] Onaylanmış not (%100) üzerinden Flashcard ve Sorular üretiliyor...`)
            // SADECE ONAYLANMIŞ NOTLARI KULLAN Kİ DIŞARIDAN BİLGİ GELMESİN
            const finalContent = notes || section.rawContent;
            try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Flashcard Kartları (Bilgi Kartları) Oluşturuluyor...` }) } catch { }

            // Flashcard'ları üret (tek deneme, tasarruf)
            for (let fAttempt = 1; fAttempt <= 3; fAttempt++) {
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
                  section.rawContent.replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, "")
                )
                
                // SOLVER AI: Flashcard Sağlaması
                if (flashcards.length > 0) {
                  flashcards = await validateFlashcardsWithSolver(finalContent, flashcards);
                }
                
                console.log(`[BG] ✅ Flashcards: ${flashcards.length}`)
                break
              } catch (e: any) {
                console.error(`[BG] ⚠️ Flashcard üretimi başarısız:`, e.message)
                if (fAttempt === 3) console.error(`[BG] ❌ Flashcard üretimi atlandı.`)
                else await new Promise(r => setTimeout(r, 10000))
              }
            }
            await new Promise(r => setTimeout(r, 15000))

            // Bölüm analizi yap
            try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Soru Üretimi İçin Bilişsel Rotalama Yapılıyor...` }) } catch { }
            analysis = await analyzeSectionContent(section.rawContent, section.title, aiMode, undefined)
            await new Promise(r => setTimeout(r, 15000))

            requiresQuestions = resolveRequiresQuestions(section.title, analysis?.requiresQuestions);

            if (!requiresQuestions) {
              console.log(`[BG] 🧠 COGNITIVE ROUTING: Bu bölüm için soru üretimi atlanıyor (requiresQuestions: false).`);
            } else {
              try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Bölüm Soru Havuzu Oluşturuluyor...` }) } catch { }
              for (let qAttempt = 1; qAttempt <= 3; qAttempt++) {
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
                  }

                  break
                } catch (e: any) {
                  console.error(`[BG] ⚠️ Soru üretimi başarısız:`, e.message)
                  if (qAttempt === 3) console.error(`[BG] ❌ Soru üretimi atlandı.`)
                  else await new Promise(r => setTimeout(r, 10000))
                }
              }
              await new Promise(r => setTimeout(r, 15000))
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

          const detectedModule = (analysis as any).module || null

          // FIX #2: Soru/flashcard eksikliğini tespit et ve sessizce geçme
          const missingContent: string[] = []
          if (flashcards.length === 0 && notes && notes.length > 500) {
            missingContent.push("flashcards")
            console.error(`[BG] 🚨 [${finalTitle}] UYARI: Flashcard üretimi TAMAMEN BAŞARISIZ! Bölüm eksik olarak işaretleniyor.`)
          }
          if (requiresQuestions && questions.length === 0 && notes && notes.length > 500) {
            missingContent.push("questions")
            console.error(`[BG] 🚨 [${finalTitle}] UYARI: Soru üretimi TAMAMEN BAŞARISIZ! Bölüm eksik olarak işaretleniyor.`)
          }

          // Bölüm onay durumu: Notlar kusursuz olsa bile soru/flashcard yoksa tam onay verilmez
          let isSectionApproved = notesAttemptSuccess
          if (missingContent.length > 0) {
            isSectionApproved = false // Eksik içerik varsa onaylama!
            console.error(`[BG] ⛔ [${finalTitle}] Eksik içerik nedeniyle bölüm ONAYLANMADI: ${missingContent.join(", ")}`)
          }

          // FIX #3: Importance null kalmasını engelle
          const resolvedImportance = analysis.importance || section.importance || "Medium"

          // ==================== ÇİFT DİL (TR + EN) — Soru & Flashcard (CISA/CIA) ====================
          // Notlar yalnızca Türkçe kalır; notes_en üretilmez.
          if (needsBilingualStudyItems(aiMode) && notesAttemptSuccess) {
            console.log(`[BG] 🌐 Uluslararası sınav modu: Soru ve flashcard için TR+EN çeviri...`)
            try { await applySectionIssuesPatch({ currentMicroPhase: `${sIdx + 1 + alreadyDone}/${totalSections}. Soru/kart İngilizce çevirisi...` }) } catch { }

            if (flashcards.length > 0) {
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
            if (questions.length > 0) {
              const enQs = await translateQuestionsToEnglish(questions, finalTitle, fullCourseName)
              questions = questions.map((q, i) => ({
                ...q,
                text_en: enQs[i]?.text_en || null,
                options_en: enQs[i]?.options_en || null,
                explanation_en: enQs[i]?.explanation_en || null,
              }))
            }
          }

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

          // FIX #6: Zombi süreçlerden kalan eski (başarısız) soru ve flashcardları temizle
          try {
            await prisma.flashcard.deleteMany({ where: { sectionId: section.id } });
            await prisma.question.deleteMany({ where: { sectionId: section.id } });
            console.log(`[BG] 🧹 Eski (yarım kalmış) soru ve flashcardlar temizlendi.`);
          } catch (delErr) {
            console.error(`[BG] 🧹 Temizlik hatası:`, delErr);
          }

          // Kendi içinde (current run) mükerrer flashcard koruması
          const existingFronts = new Set<string>()
          let dedupSkipped = 0
          for (const card of flashcards) {
            const normalizedFront = card.front.trim().toLowerCase()
            if (existingFronts.has(normalizedFront)) {
              dedupSkipped++
              continue // Mükerrer — atla
            }
            existingFronts.add(normalizedFront)
            
            // [KAYNAK BAŞLIĞI: ...] metnini temizle
            if (card.back) {
              card.back = card.back.replace(/\[KAYNAK BAŞLIĞI:.*?\]\s*$/, '').trim();
            }
            
            try { await prisma.flashcard.create({ data: { courseId: course.id, sectionId: section.id, front: card.front, back: card.back, front_en: card.front_en || null, back_en: card.back_en || null, difficulty: card.difficulty || "medium" } }) } catch { }
          }
          if (dedupSkipped > 0) {
            console.log(`[BG] 🔄 ${dedupSkipped} mükerrer flashcard atlandı (kendi içinde dedup).`)
          }

          // Kendi içinde (current run) mükerrer soru koruması
          const existingTexts = new Set<string>()
          for (const q of questions) {
            const normalizedText = q.text.trim().toLowerCase()
            if (existingTexts.has(normalizedText)) continue
            existingTexts.add(normalizedText)
            
            // [KAYNAK BAŞLIĞI: ...] metnini açıklamadan temizle
            if (q.explanation) {
              q.explanation = q.explanation.replace(/\[KAYNAK BAŞLIĞI:.*?\]\s*$/, '').trim();
            }
            
            try { await prisma.question.create({ data: { courseId: course.id, sectionId: section.id, text: q.text, text_en: q.text_en || null, options: JSON.stringify(q.options), options_en: q.options_en ? JSON.stringify(q.options_en) : null, correct: q.correct, explanation: q.explanation, explanation_en: q.explanation_en || null, difficulty: q.difficulty || "medium", module: detectedModule } }) } catch { }
          }

          console.log(`[BG] ✅ SAVED: ${finalTitle} → ${flashcards.length} cards, ${questions.length} questions. Skor: ${currentScore}/100`)

          // ==================== ANA TABLO CANLILIK SİNYALİ GÜNCELLEMESİ (15dk timeout engelleme) ====================
          await prisma.course.update({
            where: { id: course.id },
            data: { updatedAt: new Date() }
          })
          console.log(`[BG] 💓 Ders canlılık sinyali (updatedAt) güncellendi.`)

          success = true

          // "100 ALANA KADAR SAVAŞACAK" KURALI GEREĞİ: 
          // İnsan onayı için bekletme (isPausedForApproval) tamamen SİLİNDİ.
          // Yapay zeka 15 deneme hakkını sonuna kadar kullanacak.
          
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
    clearHeartbeat(slug)
    releaseProcessing(slug)
  }
}
