import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { adaptProcessingPhaseLabel, getStudyNotFoundMessage, isProfessionalProgram } from "@/lib/program-catalog"
import {
  computeProcessingProgress,
  hasRecentExplicitProcessStart,
  pauseGhostProcessingInDb,
  resolveLiveProcessingState,
  resolveTriggerDebounceState,
  sanitizePhaseLabel,
  sectionRawContentReady,
} from "@/lib/course-processing-status"
import { stringifyMergedVerificationIssues } from "@/lib/section-quality-gates"
import { cancelCourseProcessing, clearHeartbeat } from "@/lib/process-registry"

// Polling endpoint - frontend her 3 saniyede bu endpoint'i çağırarak
// PDF işleme durumunu takip eder
export async function GET(req: NextRequest) {
  try {
    // Auth kontrolü
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const slug = req.nextUrl.searchParams.get("slug")
    if (!slug || typeof slug !== "string" || slug.length > 100) {
      return NextResponse.json({ error: "Geçersiz slug parametresi" }, { status: 400 })
    }

    const course = await prisma.course.findUnique({
      where: { slug },
      include: {
        program: { select: { slug: true } },
        _count: {
          select: {
            sections: true,
            flashcards: true,
            questions: true,
          }
        }
      }
    })

    if (!course) {
      return NextResponse.json(
        { error: getStudyNotFoundMessage(slug.startsWith("zeliha-") ? "zeliha-mevzuat" : "") },
        { status: 404 },
      )
    }

    const inProcessStartGrace = await hasRecentExplicitProcessStart(slug)

    // 🛡️ Hayalet işlem: DB processing ama işçi/heartbeat yok → duraklat (yeni başlangıçta bekle)
    if (
      !inProcessStartGrace &&
      (course.status === "processing" || course.status === "uploading")
    ) {
      const live = resolveLiveProcessingState(course.status, slug)
      if (live.needsPause && live.pauseMessage && live.pauseReason) {
        cancelCourseProcessing(slug, course.name)
        clearHeartbeat(slug)
        await pauseGhostProcessingInDb(course.id, slug, live.pauseMessage, live.pauseReason)
        course.status = "paused"
        console.log(`[STATUS] 💔 Hayalet işlem duraklatıldı: ${slug} (${live.pauseReason})`)
      }
    }

    // 🛡️ İşleme kurtarma: 300 dakikadan fazla processing'te kalan dersleri kurtarma
    if (course.status === "processing") {
      const timeoutThreshold = new Date(Date.now() - 300 * 60 * 1000)
      if (course.updatedAt < timeoutThreshold) {
        await prisma.course.update({
          where: { slug },
          data: { status: "error" }
        })
        course.status = "error"
        console.log(`[STATUS] ⚠️ ${slug} 300dk'dan fazla processing'te kaldı — error'a çekildi`)
      }
    }

    const processedSections = await prisma.section.count({
      where: { courseId: course.id, processed: true }
    })
    const totalSections = await prisma.section.count({
      where: { courseId: course.id }
    })

    // İşleme tahmini hesapla
    const estimatedMinPerSection = 1.5 // Her bölüm ~1.5 dk (AI çağrıları + bekleme)
    const remainingSections = totalSections - processedSections
    const estimatedMinRemaining = Math.ceil(remainingSections * estimatedMinPerSection)

    const isProfessional = isProfessionalProgram(course.program?.slug ?? "")
    let currentMicroPhase: string | null = null
    let currentSectionRawContent: string | null = null

    const liveState = resolveLiveProcessingState(course.status, slug)
    const effectiveStatus = liveState.status
    const workerLive = liveState.workerLive

    // Mevcut aşamayı belirle
    let phase = "idle"
    let phaseLabel = "Beklemede"
    if (effectiveStatus === "uploading") {
      phase = "uploading"
      phaseLabel = "Sistem İşlemi: Yükleniyor..."
    } else if (effectiveStatus === "processing") {
      if (totalSections === 0) {
        const pagesDone =
          course.totalPages > 0 && course.processedPages >= course.totalPages
        if (pagesDone) {
          phase = "structuring"
          phaseLabel = "Metin hazır — belge yapısı belirleniyor..."
          const structuringStaleMs = 25 * 60 * 1000
          if (course.updatedAt.getTime() < Date.now() - structuringStaleMs) {
            await prisma.course.update({ where: { slug }, data: { status: "error" } })
            course.status = "error"
            phase = "error"
            phaseLabel =
              "Belge bölümleri otomatik ayrılamadı. «Zorla» veya «İşleme Başlat» ile tekrar deneyin."
            console.log(`[STATUS] ⚠️ ${slug} bölüm aşamasında ${structuringStaleMs / 60000} dk takıldı — error`)
          }
        } else {
          phase = "extracting"
          phaseLabel = `Analiz Ediliyor: Sayfa ${course.processedPages}/${course.totalPages}`
        }
      } else if (processedSections < totalSections) {
        phase = "analyzing"
        phaseLabel = `Modüller Hazırlanıyor: Kısım ${processedSections + 1}/${totalSections}`
        
        // Mevcut işlenen bölümü bul ve mikro-aşamasını al
        const unprocessedSections = await prisma.section.findMany({
          where: { courseId: course.id, processed: false },
          orderBy: { order: "asc" },
          select: { id: true, verificationIssues: true, rawContent: true }
        });
        
        let currentSection = null;
        for (const sec of unprocessedSections) {
          let issues: any = {};
          try { issues = JSON.parse(sec.verificationIssues || "{}"); } catch(e) {}
          if (issues.needsUserAction !== true) {
            currentSection = sec;
            break;
          }
        }
        
        if (currentSection) {
          // ZOMBİ SÜREÇ (TIMEOUT) DEDEKTÖRÜ: Tamamen güvenli Date parsing
          const rawSection: any[] = await prisma.$queryRaw`SELECT updatedAt FROM Section WHERE id = ${currentSection.id}`;
          if (rawSection.length > 0 && rawSection[0].updatedAt) {
            const now = Date.now();
            let dateStr = rawSection[0].updatedAt;
            if (typeof dateStr === "string" && !dateStr.endsWith("Z")) {
              dateStr += "Z";
            }
            const lastUpdate = new Date(dateStr).getTime();
          
            // Timeout: 5 dakika hareketsizlik → zombi (yeni başlangıç / zorla devamda bekle)
            if (!inProcessStartGrace && now - lastUpdate > 5 * 60 * 1000) {
              console.log(`[STATUS] 🧟‍♂️ Zombi süreç tespit edildi! (${course.name}) 15 dakikadır hareket yok. Otomatik duraklatılıyor.`);
              const pauseMessage = "İşlem yanıt vermiyor (5 dk hareketsiz). «Zorla» veya «Devam Ettir» ile yeniden başlatın.";
              await prisma.section.update({
                where: { id: currentSection.id },
                data: {
                  verificationIssues: stringifyMergedVerificationIssues(currentSection.verificationIssues, {
                    currentMicroPhase: pauseMessage,
                    pauseReason: "zombie_timeout",
                    pausedAt: new Date().toISOString(),
                  }),
                },
              });
              await prisma.course.update({ where: { id: course.id }, data: { status: "paused" } });
              course.status = "paused";
            }
          }

          currentSectionRawContent = currentSection.rawContent ?? null

          if (currentSection.verificationIssues) {
          try {
            const issues = typeof currentSection.verificationIssues === "string" 
              ? JSON.parse(currentSection.verificationIssues) 
              : currentSection.verificationIssues;
            if (issues?.currentMicroPhase) {
              currentMicroPhase = issues.currentMicroPhase
              phaseLabel = sanitizePhaseLabel(issues.currentMicroPhase, {
                isProfessional,
                rawContentReady: sectionRawContentReady(currentSectionRawContent),
              })
            }
          } catch (e) { }
        }
      }
      } else {
        phase = "finalizing"
        phaseLabel = "Sistem İşlemi: Tamamlanıyor..."
      }
    } else if (effectiveStatus === "ready") {
      phase = "ready"
      phaseLabel = "İşlem Tamamlandı"
    } else if (effectiveStatus === "paused") {
      phase = "paused"
      phaseLabel = "Duraklatıldı — Devam Ettir ile yeniden başlatın"
      const pausedSection = await prisma.section.findFirst({
        where: { courseId: course.id, processed: false },
        orderBy: { order: "asc" },
        select: { verificationIssues: true, rawContent: true },
      })
      if (pausedSection?.verificationIssues) {
        try {
          const issues = JSON.parse(pausedSection.verificationIssues)
          if (issues?.currentMicroPhase) {
            phaseLabel = sanitizePhaseLabel(issues.currentMicroPhase, {
              isProfessional,
              rawContentReady: sectionRawContentReady(pausedSection.rawContent),
            })
          }
        } catch { /* ignore */ }
      }
    } else if (effectiveStatus === "error") {
      phase = "error"
      phaseLabel = "İşlem tamamlanamadı — tekrar deneyin"
    }

    // Fetch all sections to send their real-time quality scores directly via HTTP API (caching immune)
    const sectionsData = await prisma.section.findMany({
      where: { courseId: course.id },
      select: {
        id: true,
        processed: true,
        verificationScore: true,
        verificationIssues: true
      }
    })

    const programSlug = course.program?.slug ?? ""
    phaseLabel = adaptProcessingPhaseLabel(phaseLabel, programSlug)

    const triggerDebounce = await resolveTriggerDebounceState(slug, effectiveStatus)

    return NextResponse.json({
      status: effectiveStatus,
      workerLive,
      phase,
      phaseLabel,
      totalPages: course.totalPages,
      processedPages: course.processedPages,
      totalSections,
      processedSections,
      estimatedMinRemaining,
      flashcardCount: course._count.flashcards,
      questionCount: course._count.questions,
      sectionCount: course._count.sections,
      sections: sectionsData,
      progress: computeProcessingProgress({
        courseStatus: effectiveStatus,
        totalPages: course.totalPages,
        processedPages: course.processedPages,
        totalSections,
        processedSections,
        currentMicroPhase,
      }),
      triggerDebounceRemainingMs: triggerDebounce.remainingMs,
      triggerDebounceRetryAfterSeconds: triggerDebounce.retryAfterSeconds,
      triggerDebounceUntil: triggerDebounce.debounceUntil,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
