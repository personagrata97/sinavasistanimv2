import { prisma } from "./prisma"
import {
  activeProcesses,
  releaseProcessing,
  setCancelSignal,
} from "./process-registry"

let bootSanitized = false

/**
 * Sunucu yeniden açıldığında bellekte işçi yoktur; DB'de «processing» kalan
 * dersler otomatik devam ETMEZ — duraklatılır (kullanıcı «Devam Ettir» basmalı).
 */
export async function pauseOrphanedProcessingOnBoot(): Promise<void> {
  if (bootSanitized) return
  bootSanitized = true

  // Önceki sunucu oturumundan kalan bellek kilidi — yeni işçi yok
  activeProcesses.clear()

  const stuck = await prisma.course.findMany({
    where: { status: { in: ["processing", "uploading"] } },
    select: { slug: true, name: true },
  })

  for (const course of stuck) {
    setCancelSignal(course.slug, course.name)
    releaseProcessing(course.slug)
    await prisma.course.update({
      where: { slug: course.slug },
      data: { status: "paused", updatedAt: new Date() },
    })
    console.log(
      `[STARTUP] ⏸️ Sunucu açılışı — otomatik devam kapalı: ${course.name} (${course.slug})`,
    )
  }
}

/** Acil durum: belirtilen slug hariç tüm arka plan işlerini durdur. */
export async function stopAllProcessingExcept(allowedSlug?: string): Promise<string[]> {
  const paused: string[] = []
  const active = await prisma.course.findMany({
    where: { status: { in: ["processing", "uploading"] } },
    select: { slug: true, name: true },
  })

  for (const course of active) {
    if (allowedSlug && course.slug === allowedSlug) continue
    setCancelSignal(course.slug, course.name)
    releaseProcessing(course.slug)
    await prisma.course.update({
      where: { slug: course.slug },
      data: { status: "paused", updatedAt: new Date() },
    })
    paused.push(course.slug)
    console.log(`[STOP] 🛑 Durduruldu: ${course.name} (${course.slug})`)
  }

  for (const slug of [...activeProcesses]) {
    if (allowedSlug && slug === allowedSlug) continue
    releaseProcessing(slug)
  }

  return paused
}
