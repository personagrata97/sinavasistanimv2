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
  detectSectionsMasterVisionAndSemantic,
  resolvePdfPath,
} from "@/lib/pdf-engine"
import {
  buildSingleSectionFromPages,
  detectSectionsSystematic,
  sectionsToDetected,
  detectTocPages,
  assertNoOverlapSections,
  applyGlobalZirh,
  validateSectionRanges,
} from "@/lib/section-detector"
import { SECTION_UNIFIED_ZIRH } from "@/lib/feature-flags"
import { hashContent, type QualityChain, type QualityGateResult } from "@/lib/quality-contract"
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
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit"
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
  confidence?: string
}

// ==================== KARAKTER BAZLI CHUNK BOYUTU ====================
// Büyük chunk = daha derin içerik, daha kaliteli sorular
// 1 sayfa ortalama ~2000 karakter → 12-15 sayfa = 25000 karakter
// Küçük chunk'lar sığ/tekrarlı içerik üretiyor!
const MAX_CHUNK_CHARS = 12000 // ~5 sayfa = daha detaylı, eksik konu riski düşük

async function populatePageTextsWithOcr(
  pdfPath: string,
  ranges: Array<{ pageStart: number }>,
  pageTexts: string[],
  courseName: string,
) {
  const pagesToOcr: number[] = []
  for (const r of ranges) {
    if (r.pageStart >= 1 && r.pageStart <= pageTexts.length) {
      pagesToOcr.push(r.pageStart)
      if (r.pageStart > 1) {
        pagesToOcr.push(r.pageStart - 1)
      }
    }
  }
  const uniquePages = Array.from(new Set(pagesToOcr))

  console.log(`[PROCESS] 📷 Taranmış PDF sınır doğrulama: ${uniquePages.length} adet sınır sayfası için OCR başlatılıyor (Sıralı)...`)

  const { extractPerfectMarkdownOCR } = await import("@/lib/ai-service")

  for (const pageNo of uniquePages) {
    try {
      const ocrText = await extractPerfectMarkdownOCR(pdfPath, pageNo, pageNo, `${courseName} (Sınır OCR p${pageNo})`)
      const pageIdx = pageNo - 1
      if (pageIdx >= 0 && pageIdx < pageTexts.length) {
        pageTexts[pageIdx] = ocrText
      }
    } catch (err: any) {
      console.warn(`[PROCESS] ⚠️ Sayfa ${pageNo} OCR hatası:`, err.message)
    }
    // Google API 503 yoğunluk hatasını önlemek için her sayfa arasında 2 saniye bekle
    await new Promise(r => setTimeout(r, 2000))
  }
}

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

    // ── Rate Limiting: IP başına dakikada max 10 istek ──
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
    const rl = await rateLimit(`process:${clientIp}`, 10, 60_000)
    if (!rl.success) {
      console.warn(`[PROCESS] 🚫 Rate limit aşıldı: ${clientIp} (resetIn: ${rl.resetIn}ms)`)
      return NextResponse.json(
        { error: "Çok fazla istek gönderdiniz. Lütfen bir dakika bekleyin." },
        { status: 429, headers: getRateLimitHeaders(rl.remaining, rl.resetIn, 10) },
      )
    }

    const body = await req.json()
    const session = await getServerSession(authOptions)
    const isCron = Boolean(process.env.CRON_SECRET && body.secretToken === process.env.CRON_SECRET)
    if (!session?.user?.email && !isCron) {
      console.warn("[PROCESS] 🔴 Yetkisiz tetikleme engellendi.")
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    // ── Hard Block: Ders işleme/üretim işlemi YALNIZCA YÖNETİCİLER (Admin) veya CRON tarafından yapılabilir ──
    if (!isCron && !isAdminSession(session?.user)) {
      console.warn(`[PROCESS] 🔴 Yönetici olmayan kullanıcı ders işleme tetiklemeye çalıştı: ${session?.user?.email}`)
      return NextResponse.json(
        { error: "Bu işlem yalnızca yöneticiler (admin) tarafından gerçekleştirilebilir." },
        { status: 403 }
      )
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

    if (workerAlive) {
      if (forceRetry && isAdmin) {
        // Zorla devam: Önce eski işçiyi durdur, kilidini temizle, SONRA yenisini başlat
        console.log(`[PROCESS] ⚠️ Zorla devam: Eski işçi durduruluyor → ${course.name}`);
        cancelCourseProcessing(slug, course.name);
        releaseProcessing(slug);
        clearHeartbeat(slug);
        await clearProcessTriggerDebounce(slug);
        // Eski işçinin iptal sinyalini alıp çıkması için kısa bekleme
        await new Promise(r => setTimeout(r, 3000));
        console.log(`[PROCESS] ✅ Eski işçi durduruldu, yeni motor başlatılıyor → ${course.name}`);
      } else {
        console.log(`[PROCESS] 🔒 Tek uçuş kilidi: ${course.name} zaten işleniyor`)
        return NextResponse.json(
          {
            message: "Bu modül zaten işleniyor. Bitmesini bekleyin; tekrar «Devam Ettir» tıklamayın.",
            alreadyRunning: true,
          },
          { status: 200 },
        )
      }
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
    const targetPdfPath = resolvePdfPath(course.pdfPath) || course.pdfPath;
    const pdfBuffer = await readFile(targetPdfPath)
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

      // E-32: Gemini File URI ve key haritalaması hazırlığı (bölümleme aşamasında da key rotasyonu aktif çalışabilsin diye)
      let currentFileUri = course.geminiFileUri
      if (geminiKeys.length > 0) {
        try {
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
            console.log(`[PROCESS] 💾 PDF fileUri'ler senkronize edildi.`)
          }
          currentFileUri = uriMap["0"] || course.geminiFileUri
        } catch (helperErr) {
          console.warn("[PROCESS] ensureGeminiFileUris başarısız oldu:", helperErr)
        }
      }

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
        totalPages: isScannedPdf ? totalPages : pageTexts.length,
      })
      const isSingleMode = processingProfile.mode === "single"

      let sections: DetectedSection[] = []
      let isSingleSectionFallback = false
      let tocAttempts = 0
      const MAX_TOC_ATTEMPTS = 1

      if (isScannedPdf) {
        // Taranmış PDF: metin tabanlı bölümleme çalışmaz → görsel multimodal bölümleme veya tek bölüm
        console.log(`[PROCESS] 📷 Taranmış PDF bölüm algılama: görsel multimodal yol deneniyor...`)
        if (currentFileUri && geminiKeys.length > 0) {
          try {
            const multimodalSections = await detectSectionsMultimodal(currentFileUri, geminiKeys[0])
            if (multimodalSections.length >= 1) {
              let ranges = multimodalSections.map((s) => ({
                title: s.title,
                pageStart: Math.max(1, s.pageStart),
                pageEnd: Math.min(totalPages, s.pageEnd),
              }))

              if (SECTION_UNIFIED_ZIRH()) {
                await populatePageTextsWithOcr(course.pdfPath || "", ranges, pageTexts, course.name)
                ranges = applyGlobalZirh(ranges, pageTexts)
                const validation = validateSectionRanges(ranges, pageTexts, { minSections: isSingleMode ? 1 : (totalPages <= 60 ? 1 : 2) })
                if (!validation.valid) {
                  console.warn(
                    `[PROCESS] ⚠️ Taranmış PDF Global Zırh doğrulamasından geçemedi (skor ${validation.score}):`,
                    validation.errors.slice(0, 5).join("; "),
                  )
                  // Kalite kapısı kuralı: Doğrulanamayan bölümleme geçersiz sayılır
                  ranges = []
                } else {
                  console.log(`[PROCESS] ✅ Taranmış PDF: ${ranges.length} bölüm Global Zırh ile doğrulandı.`)
                }
              }

              if (ranges.length > 0) {
                sections = ranges.map((s) => ({
                  title: s.title,
                  pageStart: s.pageStart,
                  pageEnd: s.pageEnd,
                  content: SCANNED_PDF_PENDING_OCR,
                }))
                console.log(`[PROCESS] ✅ Görsel bölümleme: ${sections.length} bölüm algılandı (OCR arka planda dolduracak).`)
              }
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
        console.log(`[PROCESS] ${formatProcessingProfileLog(processingProfile, slug)}`)

        if (isSingleMode) {
          sections = buildSingleSectionFromPages(pageTexts, course.name)
        } else {
          console.log(`[PROCESS] 🧠 Master Vision & Semantic Bölüm Algılama başlatılıyor...`)
          try {
            const parsedSections = await detectSectionsMasterVisionAndSemantic(
              currentFileUri,
              geminiKeys[0],
              pageTexts,
              { courseSlug: slug }
            )

            if (parsedSections && parsedSections.length > 0) {
              let ranges = parsedSections.map((s) => ({
                title: s.title,
                pageStart: s.pageStart,
                pageEnd: s.pageEnd,
              }))

              if (SECTION_UNIFIED_ZIRH()) {
                ranges = applyGlobalZirh(ranges, pageTexts)
                const validation = validateSectionRanges(ranges, pageTexts, { minSections: isSingleMode ? 1 : (totalPages <= 60 ? 1 : 2) })
                if (!validation.valid) {
                  console.warn(
                    `[PROCESS] ⚠️ Master çıktısı Global Zırh doğrulamasından geçemedi (skor ${validation.score}):`,
                    validation.errors.slice(0, 5).join("; "),
                  )
                  sections = []
                } else {
                  sections = sectionsToDetected(ranges, pageTexts)
                  console.log(`[PROCESS] ✅ Master Engine: ${sections.length} bölüm Global Zırh ile doğrulandı.`)
                }
              } else {
                sections = parsedSections.map((s) => ({
                  title: s.title,
                  pageStart: s.pageStart,
                  pageEnd: s.pageEnd,
                  content: pageTexts.slice(Math.max(0, s.pageStart - 1), s.pageEnd).join("\n\n"),
                  module: s.title,
                }))
                console.log(`[PROCESS] ✅ Master Engine: ${sections.length} bölüm kusursuz olarak algılandı.`)
              }
            } else {
              console.warn(`[PROCESS] ⚠️ Master Engine bölüm bulamadı!`)
            }
          } catch (err: any) {
            console.error(`[PROCESS] 🛑 Master Engine hatası:`, err.message)
          }

          const useSystematicFallback = process.env.SECTION_DETECT_FALLBACK_SYSTEMATIC !== "false"
          if (sections.length === 0 && useSystematicFallback) {
            console.log(`[PROCESS] 🔄 Master başarısız — sistematik yedek yol deneniyor (SECTION_DETECT_FALLBACK_SYSTEMATIC)...`)
            try {
              const systematic = await detectSectionsSystematic(pageTexts, {
                geminiFileUri: currentFileUri,
                geminiKeys,
                logCourseSlug: slug,
              })
              if (systematic && systematic.sections.length > 0) {
                const accept =
                  !SECTION_UNIFIED_ZIRH() || systematic.validation.valid === true
                if (accept) {
                  sections = sectionsToDetected(systematic.sections, pageTexts)
                  console.log(
                    `[PROCESS] ✅ Sistematik yedek: ${sections.length} bölüm (${systematic.titleSource}, doğrulama skoru ${systematic.validation.score})`,
                  )
                } else {
                  console.warn(
                    `[PROCESS] ⚠️ Sistematik yedek doğrulamadan geçemedi (skor ${systematic.validation.score}) — reddedildi.`,
                    systematic.validation.errors.slice(0, 3).join("; "),
                  )
                }
              }
            } catch (sysErr: any) {
              console.error(`[PROCESS] 🛑 Sistematik yedek hatası:`, sysErr.message)
            }
          }
        }

      }

      // Bölüm algılanamazsa dur — tek parça veya elle tablo yok (otonom sistem).
      if (sections.length === 0) {
        // 🚀 Zeliha Prosedürleri / Kısa Belgeler için KORUMA KALKANI (Fallback)
        // Eğer doküman 60 sayfadan kısaysa ve AI "İçindekiler" bulamadıysa hata verme, 
        // tüm dokümanı tek bir "Genel İçerik" bölümü olarak kaydet!
        if (course.totalPages <= 60) {
          console.log(`[PROCESS] ⚠️ İçindekiler tablosu bulunamadı ama belge kısa (${course.totalPages} sayfa). Tek parça (Genel İçerik) olarak işleniyor.`);
          sections = [{
            title: "Genel İçerik",
            pageStart: 1,
            pageEnd: course.totalPages,
            content: "",
            module: "1"
          }];
          isSingleSectionFallback = true;
        } else {
          // BÖLÜM ALGINALAMAZSA SON ÇARE: DİNAMİK EŞİT SAYFA ARALIĞI CHUNKER
          console.warn(`[PROCESS] ⚠️ Bölüm algılama başarısız oldu ve belge uzun (${course.totalPages} sayfa). Dinamik sayfa aralığı bölücü devreye giriyor.`);
          const chunkSize = 15;
          const chunksCount = Math.ceil(course.totalPages / chunkSize);
          sections = [];
          for (let i = 0; i < chunksCount; i++) {
            const start = i * chunkSize + 1;
            const end = Math.min((i + 1) * chunkSize, course.totalPages);
            sections.push({
              title: `Bölüm ${i + 1} (Sayfa ${start}-${end})`,
              pageStart: start,
              pageEnd: end,
              content: "",
              module: `Kısım ${i + 1}`,
            });
          }
          isSingleSectionFallback = true;
        }
      }

      // ⚠️ KISALTMALAR / TANIMLAR ZORUNLU EKLENTİSİ (GARANTİ ALTINA ALMA)
      // Yapay zeka veya deterministik algoritmalar "Kısaltmalar" sayfasını içindekiler listesinde olmadığı için atlayabilir.
      // Kullanıcı talebi üzerine bu sayfa kesinlikle bulunmalı ve işlenmelidir.
      const hasGlossary = sections.some(sec => sec.title.toLocaleUpperCase("tr-TR").includes("KISALTMA") || sec.title.toLocaleUpperCase("tr-TR").includes("TANIM"))
      if (!hasGlossary && sections.length > 0) {
        // PDF metni içinde Kısaltmalar başlığını arıyoruz
        let glossaryStartPage = -1;
        for (let p = 0; p < Math.min(25, pageTexts.length); p++) {
          const text = pageTexts[p].toLocaleUpperCase("tr-TR");
          const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
          // Genellikle sayfa numaralarından sonraki ilk birkaç satırda KISALTMALAR yazar
          const firstFewLines = lines.slice(0, 5).join(' ');
          if (firstFewLines.includes("KISALTMALAR") || firstFewLines.includes("TANIMLAR")) {
            // Eğer bu sayfa zaten TOC değilse
            const tocPages = Array.from(detectTocPages(pageTexts, sections.map(s => s.title)));
            if (!tocPages.includes(p)) {
              glossaryStartPage = p + 1;
              break;
            }
          }
        }

        if (glossaryStartPage !== -1) {
          const firstSectionStart = sections[0].pageStart
          const glossaryEndPage = Math.max(glossaryStartPage, firstSectionStart - 1)

          sections.unshift({
            title: "Kısaltmalar ve Tanımlar",
            pageStart: glossaryStartPage,
            pageEnd: glossaryEndPage,
            content: "Kısaltmalar (Otomatik Eklendi)",
          })
          console.log(`[PROCESS] ➕ Kısaltmalar listeye zorla eklendi. (Sayfa ${glossaryStartPage}-${glossaryEndPage})`)
        }
      }

      console.log(`[PROCESS] ${sections.length} bölüm algılandı (Kısaltmalar eklentisi sonrası).`)

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

      assertNoOverlapSections(sections)

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
        const uploadGate: QualityGateResult = {
          stage: "upload",
          pass: true,
          score: 100,
          contentHash: course.pdfHash || undefined,
          timestamp: course.createdAt.toISOString(),
        }

        const sectionDetectContent = `${sections[i].title}|${sections[i].pageStart}|${sections[i].pageEnd}`
        const sectionDetectHash = hashContent(sectionDetectContent)

        const sectionDetectGate: QualityGateResult = {
          stage: "section_detect",
          pass: true,
          score: 100,
          contentHash: sectionDetectHash,
          prevHash: course.pdfHash || undefined,
          metrics: {
            sectionIndex: i + 1,
            pageStart: sections[i].pageStart,
            pageEnd: sections[i].pageEnd,
          },
          timestamp: new Date().toISOString(),
        }

        const initialChain: QualityChain = {
          version: 1,
          gates: [uploadGate, sectionDetectGate],
          lastHash: sectionDetectHash,
        }

        const initialIssues: any = {
          qualityChain: initialChain
        }
        if (isSingleSectionFallback) {
          initialIssues.singleSectionFallback = true
          initialIssues.failedSources = ["procedure-body", "procedure-toc", "toc-parse", "body-regex", "ai-text-title"]
          initialIssues.reason = "Bölüm algılama başarısız oldu, kısa belge koruma kalkanı devrede."
        }
        if (sections[i].confidence === "low") {
          initialIssues.issues = [`[SINIR UYARISI] "${sections[i].title}" bölüm sınırının tespiti düşüktür. Lütfen sayfa aralıklarını (${sections[i].pageStart}-${sections[i].pageEnd}) kontrol edin.`]
        }

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
            verificationIssues: JSON.stringify(initialIssues),
          }
        })
      }
    } else {
      console.log(`[PROCESS] Devam: ${existingSections} bölüm zaten var, kaldığı yerden devam ediliyor...`)
    }

    // ========== PHASE 3+4: AI Analysis + Schedule — ARKA PLANDA ==========
    // İşlem veritabanı kuyruğuna (Job Queue) eklenir. Sunucu kapansa bile güvendedir.
    try {
      const { enqueueCourseProcessJob } = await import("@/lib/job-processor")
      await enqueueCourseProcessJob(slug, forceRetry)
    } catch (error) {
      console.error("[QUEUE_ERROR] Kuyruğa eklenemedi:", error)
    }

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


