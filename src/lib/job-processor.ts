import { prisma } from "./prisma"
import { processInBackground } from "@/app/api/courses/process/route"
import { getCourseBySlug } from "./course-data"

let isWorkerRunning = false

export async function enqueueCourseProcessJob(slug: string, forceRetry: boolean = false) {
  if (forceRetry) {
    // If force retry, break the lock by failing existing active jobs
    await prisma.job.updateMany({
      where: {
        courseSlug: slug,
        type: "process_course",
        status: { in: ["pending", "processing"] }
      },
      data: {
        status: "failed",
        error: "Kullanıcı tarafından zorla yeniden başlatıldı."
      }
    })
    console.log(`[QUEUE] 🔓 ${slug} için mevcut kilit kırılarak zorla yeni görev başlatılıyor.`)
  } else {
    // If a job already exists and is pending/processing, don't enqueue a duplicate
    const existingJob = await prisma.job.findFirst({
      where: {
        courseSlug: slug,
        type: "process_course",
        status: { in: ["pending", "processing"] }
      }
    })

    if (existingJob) {
      console.log(`[QUEUE] ⏭️ ${slug} için zaten aktif bir görev var, kuyruğa eklenmedi.`)
      return existingJob
    }
  }

  const job = await prisma.job.create({
    data: {
      type: "process_course",
      courseSlug: slug,
      payload: JSON.stringify({ forceRetry })
    }
  })
  
  console.log(`[QUEUE] 📥 ${slug} kuyruğa eklendi (Job ID: ${job.id})`)
  
  // Asynchronously start the worker if it's not running
  startWorkerLoop().catch(console.error)
  
  return job
}

export async function startWorkerLoop() {
  if (isWorkerRunning) return
  isWorkerRunning = true
  
  console.log(`[WORKER] 🚀 İşçi motoru (Worker Loop) başlatıldı...`)

  try {
    while (true) {
      // Find a pending job
      const pendingJob = await prisma.job.findFirst({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" }
      })

      if (!pendingJob) {
        // No pending jobs, worker goes to sleep
        break
      }

      // Claim the job
      const job = await prisma.job.update({
        where: { id: pendingJob.id },
        data: { status: "processing", lockedAt: new Date() }
      })

      console.log(`[WORKER] ⚙️ İşlemeye başlandı: ${job.courseSlug}`)

      try {
        const payload = job.payload ? JSON.parse(job.payload) : {}
        const course = await prisma.course.findUnique({ where: { slug: job.courseSlug } })
        
        if (course) {
          // Execute the actual AI logic
          await processInBackground(job.courseSlug, course, payload.forceRetry)
        } else {
          throw new Error("Course not found in DB")
        }

        // After processInBackground finishes successfully (or ends naturally)
        // Check if the course status is actually "ready" or "paused"
        const checkCourse = await prisma.course.findUnique({ where: { slug: job.courseSlug } })
        if (checkCourse?.status === "ready") {
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "completed" }
          })
          console.log(`[WORKER] ✅ İşlem TAMAMLANDI: ${job.courseSlug}`)
        } else if (checkCourse?.status === "error") {
          throw new Error("Course hit an error status during processing")
        } else if (checkCourse?.status === "paused") {
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "failed", error: "İşlem duraklatıldı veya kullanıcı sayfadan ayrıldı." }
          })
          console.log(`[WORKER] ⏸️ İşlem DURAKLATILDI, görev sonlandırıldı: ${job.courseSlug}`)
        } else {
           // still processing? Or finished but not ready?
           await prisma.job.update({
            where: { id: job.id },
            data: { status: "completed" } // Default to complete to avoid infinite loop
          })
        }

      } catch (err: any) {
        console.error(`[WORKER] ❌ Görev hata aldı (${job.courseSlug}):`, err)
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "failed", error: err.message || "Unknown error" }
        })
      }
    }
  } finally {
    isWorkerRunning = false
    console.log(`[WORKER] 💤 Kuyruk boş, işçi motoru uyku moduna geçti.`)
  }
}
