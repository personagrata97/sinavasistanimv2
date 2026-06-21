import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { getStudyNotFoundMessage } from "@/lib/program-catalog"
import { clearProcessTriggerDebounce } from "@/lib/course-processing-status"
import { stringifyMergedVerificationIssues } from "@/lib/section-quality-gates"
import { cancelCourseProcessing, clearHeartbeat } from "@/lib/process-registry"

/** Çalışan arka plan işçisini durdurur — bölüm/not verisi silinmez. */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const body = await req.json()
    if (!session?.user?.email && body.secretToken !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const { slug, reason } = body
    if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 })

    const course = await prisma.course.findUnique({ where: { slug } })
    if (!course) {
      return NextResponse.json(
        { error: getStudyNotFoundMessage(slug.startsWith("zeliha-") ? "zeliha-mevzuat" : "") },
        { status: 404 },
      )
    }

    cancelCourseProcessing(slug, course.name)
    clearHeartbeat(slug)
    await clearProcessTriggerDebounce(slug)

    const pauseMessage =
      reason ||
      "İşlem kullanıcı isteğiyle durduruldu. «Devam Ettir» ile yeniden başlatabilirsiniz."

    if (course.status === "processing" || course.status === "uploading") {
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
              pauseReason: "user_cancelled",
              pausedAt: new Date().toISOString(),
            }),
          },
        })
      }
      await prisma.course.update({
        where: { slug },
        data: { status: "paused", updatedAt: new Date() },
      })
    }

    console.log(`[CANCEL] 🛑 İşlem durduruldu: ${course.name} (${slug})`)
    return NextResponse.json({ success: true, message: pauseMessage })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
