import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { startWorkerLoop } from "@/lib/job-processor"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get("slug")

  if (!slug) {
    return new Response("Slug required", { status: 400 })
  }

  // Ensure worker is running
  startWorkerLoop().catch(console.error)

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false

      request.signal.addEventListener("abort", () => {
        isClosed = true
        controller.close()
      })

      const sendEvent = (data: any) => {
        if (isClosed) return
        try {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
        } catch (err) {
          isClosed = true
        }
      }

      while (!isClosed) {
        try {
          const course = await prisma.course.findUnique({
            where: { slug },
            select: { status: true, updatedAt: true }
          })
          
          if (!course) {
            sendEvent({ error: "Course not found" })
            break
          }

          const sections = await prisma.section.findMany({
            where: { courseId: (await prisma.course.findUnique({where: {slug}}))?.id },
            orderBy: { order: "asc" },
            select: {
              id: true,
              processed: true,
              title: true,
              order: true,
              verificationIssues: true,
            }
          })

          const total = sections.length
          const completed = sections.filter(s => s.processed).length
          const progress = total > 0 ? Math.floor((completed / total) * 100) : 0

          let processingSection = null
          const activeSection = sections.find(s => !s.processed)
          if (activeSection && activeSection.verificationIssues) {
            try {
              const vi = JSON.parse(activeSection.verificationIssues)
              if (vi.currentMicroPhase) {
                processingSection = {
                  title: activeSection.title,
                  microPhase: vi.currentMicroPhase,
                  order: activeSection.order,
                }
              }
            } catch (e) {}
          }

          sendEvent({
            status: course.status,
            progress,
            totalSections: total,
            completedSections: completed,
            processingSection,
            phaseLabel: processingSection?.microPhase || null,
            workerLive: true,
            sections
          })

          if (course.status === "ready" || course.status === "error" || course.status === "paused") {
            // Terminal duruma ulaşıldı — son bir event gönderip döngüyü kapat.
            // Bu döngü kapanmazsa sunucu her 2 saniyede DB sorgusu yaparak CPU'yu yakar.
            console.log(`[SSE] Terminal durum tespit edildi (${course.status}). Stream kapatılıyor.`)
            break
          }

          // Poll every 2 seconds
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (error) {
          console.error("[SSE] Error in stream loop:", error)
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      }
    }
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  })
}
