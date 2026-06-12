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

    if (zombieCourses.length === 0) {
      console.log("[CRON] ✨ Temizlenecek zombi süreç bulunamadı.")
      return NextResponse.json({ success: true, message: "No zombies found", count: 0 })
    }

    console.warn(`[CRON] ⚠️ ${zombieCourses.length} adet zombi ders tespit edildi! İptal ediliyor...`, zombieCourses.map(c => c.slug))

    // Zombi derslerin statülerini 'error' yap ve hata mesajı ekle
    await prisma.course.updateMany({
      where: {
        id: { in: zombieCourses.map(c => c.id) }
      },
      data: {
        status: "error",
      }
    })

    return NextResponse.json({ 
      success: true, 
      message: `Cleaned up ${zombieCourses.length} zombie courses.`, 
      zombies: zombieCourses.map(c => c.slug) 
    })
  } catch (error: any) {
    console.error("[CRON] Zombi temizlik hatası:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
