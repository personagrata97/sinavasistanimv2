import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"

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
      return NextResponse.json({ error: "Ders bulunamadı" }, { status: 404 })
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

    // Mevcut aşamayı belirle
    let phase = "idle"
    let phaseLabel = "Beklemede"
    if (course.status === "uploading") {
      phase = "uploading"
      phaseLabel = "Sistem İşlemi: Yükleniyor..."
    } else if (course.status === "processing") {
      if (totalSections === 0) {
        phase = "extracting"
        phaseLabel = `Analiz Ediliyor: Sayfa ${course.processedPages}/${course.totalPages}`
      } else if (processedSections < totalSections) {
        phase = "analyzing"
        phaseLabel = `Modüller Hazırlanıyor: Kısım ${processedSections + 1}/${totalSections}`
        
        // Mevcut işlenen bölümü bul ve mikro-aşamasını al
        const unprocessedSections = await prisma.section.findMany({
          where: { courseId: course.id, processed: false },
          orderBy: { order: "asc" },
          select: { id: true, verificationIssues: true }
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
          
            // Timeout: 5 dakika hareketsizlik → zombi (OCR beklerken heartbeat API logu üretmeyebilir)
            if (now - lastUpdate > 5 * 60 * 1000) {
              console.log(`[STATUS] 🧟‍♂️ Zombi süreç tespit edildi! (${course.name}) 15 dakikadır hareket yok. Otomatik duraklatılıyor.`);
              const pauseMessage = "İşlem yanıt vermiyor (5 dk hareketsiz). «Zorla» veya «Devam Ettir» ile yeniden başlatın.";
              await prisma.section.update({
                where: { id: currentSection.id },
                data: {
                  verificationIssues: JSON.stringify({
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

          if (currentSection.verificationIssues) {
          try {
            const issues = typeof currentSection.verificationIssues === "string" 
              ? JSON.parse(currentSection.verificationIssues) 
              : currentSection.verificationIssues;
            if (issues?.currentMicroPhase) {
              phaseLabel = issues.currentMicroPhase;
            }
          } catch (e) { }
        }
      }
      } else {
        phase = "finalizing"
        phaseLabel = "Sistem İşlemi: Tamamlanıyor..."
      }
    } else if (course.status === "ready") {
      phase = "ready"
      phaseLabel = "İşlem Tamamlandı"
    } else if (course.status === "paused") {
      phase = "paused"
      phaseLabel = "Duraklatıldı — Devam Ettir ile yeniden başlatın"
      const pausedSection = await prisma.section.findFirst({
        where: { courseId: course.id, processed: false },
        orderBy: { order: "asc" },
        select: { verificationIssues: true },
      })
      if (pausedSection?.verificationIssues) {
        try {
          const issues = JSON.parse(pausedSection.verificationIssues)
          if (issues?.currentMicroPhase) phaseLabel = issues.currentMicroPhase
        } catch { /* ignore */ }
      }
    } else if (course.status === "error") {
      phase = "error"
      phaseLabel = "Hata Oluştu (Limit Doldu)"
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

    return NextResponse.json({
      status: course.status,
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
      progress: course.totalPages > 0
        ? Math.round(
            // Metin çıkarma %40, AI analiz %50, program %10
            (course.status === "processing" && totalSections === 0
              ? (course.processedPages / course.totalPages) * 40
              : totalSections > 0
                ? 40 + (processedSections / totalSections) * 50
                : 0
            ) + (course.status === "ready" ? 100 : 0)
          )
        : 0,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
