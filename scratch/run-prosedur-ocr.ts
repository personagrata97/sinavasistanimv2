/**
 * zeliha-kvkk-prosedur: sıfırdan işleme arka plan işçisi (süreç canlı kalmalı — await ile).
 * Kullanım: npx tsx scratch/run-prosedur-ocr.ts
 */
import { prisma } from "../src/lib/prisma"
import { processInBackground } from "../src/app/api/courses/process/route"
import {
  clearCancelSignal,
  releaseProcessing,
  tryClaimProcessing,
} from "../src/lib/process-registry"

const SLUG = "zeliha-kvkk-prosedur"

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: SLUG },
    include: { program: true },
  })
  if (!course) throw new Error("Ders bulunamadı")
  if (!course.pdfPath) throw new Error("PDF yok")

  const section = await prisma.section.findFirst({
    where: { courseId: course.id },
    select: { rawContent: true, title: true },
  })
  const hasOcr = section?.rawContent.includes("[MARKDOWN_OCR_SUCCESS]") ?? false
  console.log(`[OCR-RUN] status=${course.status}, bölüm="${section?.title}", OCR damgası=${hasOcr}`)

  clearCancelSignal(SLUG, course.name)
  releaseProcessing(SLUG)
  tryClaimProcessing(SLUG)

  await prisma.course.update({
    where: { slug: SLUG },
    data: { status: "processing", updatedAt: new Date() },
  })

  console.log("[OCR-RUN] Görsel OCR + not üretimi başlıyor (süreç canlı tutuluyor)...")
  await processInBackground(SLUG, course)
  console.log("[OCR-RUN] Tamamlandı.")
}

main()
  .catch((e) => {
    console.error("[OCR-RUN] Hata:", e)
    process.exit(1)
  })
  .finally(async () => {
    releaseProcessing(SLUG)
    await prisma.$disconnect()
  })
