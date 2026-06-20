/**
 * zeliha-kvkk-prosedur: sıfırdan işleme — PDF korunur, bölüm/not/soru/kart silinir, görsel OCR yeniden başlar.
 * Kullanım: npx tsx scratch/reset-prosedur-from-scratch.ts
 */
import { readFile } from "fs/promises"
import { prisma } from "../src/lib/prisma"
import { processInBackground } from "../src/app/api/courses/process/route"
import {
  cancelCourseProcessing,
  clearCancelSignal,
  releaseProcessing,
  tryClaimProcessing,
} from "../src/lib/process-registry"
import {
  extractAllText,
  assessPdfSearchability,
  prepareSearchablePdfSectionContent,
  NATIVE_TEXT_LOG_MESSAGE,
} from "../src/lib/pdf-engine"
import { buildSingleSectionFromPages } from "../src/lib/section-detector"
import {
  formatProcessingProfileLog,
  getDocumentProcessingProfile,
} from "../src/lib/document-processing-profile"
import { getCourseBySlug } from "../src/lib/course-data"

const SLUG = "zeliha-kvkk-prosedur"

async function resetCourse(courseId: string, pdfPath: string | null) {
  await prisma.flashcard.deleteMany({ where: { courseId } })
  await prisma.question.deleteMany({ where: { courseId } })
  await prisma.section.deleteMany({ where: { courseId } })

  await prisma.course.update({
    where: { id: courseId },
    data: {
      status: pdfPath ? "uploaded" : "not_started",
      processedPages: 0,
      updatedAt: new Date(),
    },
  })
}

async function runPhase1(course: {
  id: string
  slug: string
  name: string
  pdfPath: string | null
  totalPages: number
  program: { slug: string; aiMode: string } | null
}) {
  if (!course.pdfPath) throw new Error("PDF yolu yok")

  const pdfBuffer = await readFile(course.pdfPath)
  const pageTexts = await extractAllText(pdfBuffer)
  const pdfSearchability = assessPdfSearchability(pageTexts)

  if (pdfSearchability.isSearchable) {
    console.log(
      `[PHASE1] ${NATIVE_TEXT_LOG_MESSAGE} (${pdfSearchability.totalChars} karakter, ${pageTexts.length} sayfa)`,
    )
  }

  await prisma.course.update({
    where: { slug: course.slug },
    data: { processedPages: pageTexts.length },
  })

  const staticMeta = getCourseBySlug(course.slug)
  const processingProfile = getDocumentProcessingProfile({
    slug: course.slug,
    name: course.name,
    sourceKind: staticMeta?.sourceKind,
    sourceKindLabel: staticMeta?.sourceKindLabel,
    gridGroup: staticMeta?.gridGroup,
    programSlug: course.program?.slug || "",
    aiMode: course.program?.aiMode || "general",
    totalPages: pageTexts.length,
  })
  console.log(`[PHASE1] ${formatProcessingProfileLog(processingProfile, course.slug)}`)

  let sections = buildSingleSectionFromPages(pageTexts, course.name)
  if (pdfSearchability.isSearchable) {
    sections = sections.map((sec) => ({
      ...sec,
      content: prepareSearchablePdfSectionContent(sec.content),
    }))
  }

  for (let i = 0; i < sections.length; i++) {
    await prisma.section.create({
      data: {
        courseId: course.id,
        title: sections[i].title,
        order: i + 1,
        pageStart: sections[i].pageStart,
        pageEnd: sections[i].pageEnd,
        rawContent: sections[i].content,
        module: sections[i].module || "Genel",
        processed: false,
        notes: null,
      },
    })
  }
  console.log(`[PHASE1] ${sections.length} bölüm oluşturuldu (MARKDOWN_OCR_SUCCESS yok — görsel OCR çalışacak)`)
}

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: SLUG },
    include: { program: true },
  })
  if (!course) {
    console.error("[RESET] Ders bulunamadı:", SLUG)
    process.exit(1)
  }
  if (!course.pdfPath) {
    console.error("[RESET] PDF yolu yok — sıfırdan işleme yapılamaz")
    process.exit(1)
  }

  console.log(`[RESET] Önce: status=${course.status}, processedPages=${course.processedPages}`)

  // 1) Aktif işlemi durdur
  cancelCourseProcessing(SLUG, course.name)
  await prisma.course.update({
    where: { slug: SLUG },
    data: { status: "paused", updatedAt: new Date() },
  })
  console.log("[RESET] İptal sinyali gönderildi, kurs duraklatıldı")

  // 2) Veritabanını sıfırla (PDF korunur)
  const beforeSections = await prisma.section.count({ where: { courseId: course.id } })
  const beforeCards = await prisma.flashcard.count({ where: { courseId: course.id } })
  const beforeQs = await prisma.question.count({ where: { courseId: course.id } })
  await resetCourse(course.id, course.pdfPath)
  console.log(
    `[RESET] Silindi: ${beforeSections} bölüm, ${beforeCards} flashcard, ${beforeQs} soru → status=uploaded, processedPages=0`,
  )

  releaseProcessing(SLUG)
  clearCancelSignal(SLUG, course.name)

  // 3) Phase 1 + arka plan işleme
  const freshCourse = await prisma.course.findUnique({
    where: { slug: SLUG },
    include: { program: true },
  })
  if (!freshCourse) throw new Error("Kurs bulunamadı")

  await runPhase1(freshCourse)

  const claim = tryClaimProcessing(SLUG)
  if (!claim.ok) {
    releaseProcessing(claim.blockedBy)
    tryClaimProcessing(SLUG)
  }

  await prisma.course.update({
    where: { slug: SLUG },
    data: { status: "processing", updatedAt: new Date() },
  })

  console.log("[RESET] Arka plan işleme başlatılıyor (görsel OCR bekleniyor)...")
  // Fire-and-forget — script çıkışında iş devam etsin diye await etmiyoruz
  processInBackground(SLUG, freshCourse)
    .then(() => console.log("[RESET] Arka plan işi tamamlandı."))
    .catch((e) => console.error("[RESET] Arka plan hatası:", e))
    .finally(() => releaseProcessing(SLUG))

  await new Promise((r) => setTimeout(r, 8000))

  const after = await prisma.course.findUnique({
    where: { slug: SLUG },
    include: { sections: { select: { rawContent: true, verificationIssues: true } } },
  })
  const microPhase = after?.sections[0]?.verificationIssues
    ? JSON.parse(after.sections[0].verificationIssues).currentMicroPhase
    : null
  const hasOcrFlag =
    after?.sections.some((s) => s.rawContent.includes("[MARKDOWN_OCR_SUCCESS]")) ?? false

  console.log(`[RESET] Sonra: status=${after?.status}, OCR damgası=${hasOcrFlag ? "var" : "yok"}`)
  console.log(`[RESET] Aşama: ${microPhase ?? "(henüz güncellenmedi)"}`)
  console.log("[RESET] İşleme başlatıldı — sunucu loglarında «Markdown OCR Katmanı» izleyin.")
}

main()
  .catch((e) => {
    console.error("[RESET] Hata:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
