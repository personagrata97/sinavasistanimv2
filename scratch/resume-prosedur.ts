/**
 * zeliha-kvkk-prosedur: rawContent hazırken not üretimini yeniden başlatır.
 * Kullanım: npx tsx scratch/resume-prosedur.ts
 */
import { prisma } from "../src/lib/prisma"
import { processInBackground } from "../src/app/api/courses/process/route"
import { clearCancelSignal, releaseProcessing, tryClaimProcessing } from "../src/lib/process-registry"

const SLUG = "zeliha-kvkk-prosedur"

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: SLUG },
    include: { program: true },
  })
  if (!course) {
    console.error("Ders bulunamadı:", SLUG)
    process.exit(1)
  }

  const section = await prisma.section.findFirst({
    where: { courseId: course.id },
    select: { rawContent: true, notes: true, title: true },
  })
  console.log(
    `[RESUME] ${course.name} — status=${course.status}, raw=${section?.rawContent?.length ?? 0} chars, notes=${section?.notes?.length ?? 0}`,
  )

  clearCancelSignal(SLUG, course.name)
  releaseProcessing(SLUG)
  tryClaimProcessing(SLUG)

  await prisma.course.update({
    where: { slug: SLUG },
    data: { status: "processing", updatedAt: new Date() },
  })

  console.log("[RESUME] Not üretimi arka planda başlatılıyor (OCR atlanacak — metin hazır)...")
  await processInBackground(SLUG, course)
  console.log("[RESUME] Arka plan işi bitti.")
}

main()
  .catch((e) => {
    console.error("[RESUME] Hata:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
