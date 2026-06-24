import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: Request) {
  try {
    // Sadece cron ve yetkili çağrıları kabul et. Vercel Cron "Bearer" veya "x-vercel-cron" yollar.
    // Ancak güvenlik için basit bir secret token de kullanılabilir.
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers.get("x-vercel-cron") !== "1") {
      // Local development için esneklik
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

    console.log("[CRON] 🧹 Zombi ders/süreç temizliği başlatılıyor...")

    // 1 saat (3600000 ms)
    const ONE_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000)

    // 1 saatten uzun süredir "processing" durumunda olan dersleri bul
    const zombieCourses = await prisma.course.findMany({
      where: {
        status: "processing",
        updatedAt: {
          lt: ONE_HOUR_AGO
        }
      },
      select: { id: true, slug: true, name: true }
    })

    if (zombieCourses.length > 0) {
      console.warn(`[CRON] ⚠️ ${zombieCourses.length} adet zombi ders tespit edildi! İptal ediliyor...`, zombieCourses.map(c => c.slug))
      
      // Zombi derslerin statülerini 'error' yap ve hata mesajı ekle
      await prisma.course.updateMany({
        where: { id: { in: zombieCourses.map(c => c.id) } },
        data: { status: "error" }
      })
    } else {
      console.log("[CRON] ✨ Temizlenecek zombi süreç bulunamadı.")
    }

    // ==========================================
    // 1. VERİTABANI LOG TEMİZLİĞİ (Retention Policy)
    // ==========================================
    const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    
    console.log("[CRON] 🗑️ 7 günden eski loglar temizleniyor...")
    const [delApiLogs, delSysErrs, delGenLogs, delTrigLogs] = await Promise.all([
      prisma.apiUsageLog.deleteMany({ where: { createdAt: { lt: SEVEN_DAYS_AGO } } }),
      prisma.systemError.deleteMany({ where: { createdAt: { lt: SEVEN_DAYS_AGO }, resolved: true } }),
      prisma.generationLog.deleteMany({ where: { createdAt: { lt: SEVEN_DAYS_AGO } } }),
      prisma.processTriggerLog.deleteMany({ where: { createdAt: { lt: SEVEN_DAYS_AGO } } })
    ])
    console.log(`[CRON] 🧹 Silinen loglar: API(${delApiLogs.count}) SysErr(${delSysErrs.count}) GenLog(${delGenLogs.count}) TrigLog(${delTrigLogs.count})`)

    // ==========================================
    // 2. OTONOM HATA KURTARMA (Dead-Letter Queue)
    // ==========================================
    // 2 saatten eski ve 'error' statüsündeki dersleri bul (maksimum 3 tane)
    const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000)
    
    const errorCourses = await prisma.course.findMany({
      where: {
        status: "error",
        updatedAt: { lt: TWO_HOURS_AGO }
      },
      select: { id: true, slug: true, name: true },
      take: 3
    })

    let dlqCount = 0
    if (errorCourses.length > 0) {
      console.warn(`[CRON] 🚑 Otonom kurtarma (DLQ) tetikleniyor. Hatalı ${errorCourses.length} ders yeniden kuyruğa alınıyor...`)
      
      // Job-processor'dan import etmek yerine doğrudan fetch() ile kendi API'mize istek atabiliriz
      // Çünkü cron'dan enqueueCourseProcessJob çağırmak import döngüsü (circular dependency) yaratabilir.
      // En güvenlisi fetch ile tetiklemek:
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
      
      for (const course of errorCourses) {
        try {
          // Devam Ettir (forceRetry: true) mantığıyla tetikliyoruz
          await fetch(`${baseUrl}/api/courses/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: course.slug,
              forceRetry: true,
              secretToken: process.env.CRON_SECRET || "local_dev_bypass"
            })
          })
          console.log(`[CRON] 🔁 DLQ: ${course.slug} başarıyla yeniden kuyruğa alındı.`)
          dlqCount++
        } catch (err) {
          console.error(`[CRON] ❌ DLQ Hatası (${course.slug}):`, err)
        }
      }
    } else {
      console.log("[CRON] ✨ Kurtarılacak hatalı ders bulunamadı.")
    }

    return NextResponse.json({ 
      success: true, 
      message: `Cleaned up ${zombieCourses.length} zombies. Deleted old logs. Recovered ${dlqCount} errored courses.`, 
      zombies: zombieCourses.map(c => c.slug),
      recovered: errorCourses.map(c => c.slug)
    })
  } catch (error: any) {
    console.error("[CRON] Zombi temizlik hatası:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
