import { prisma } from "./src/lib/prisma"

async function run() {
  console.log("🧹 [COMPLETE RESET] Wiping all generated notes, flashcards, and questions for Bilgi Sistemleri Güvenliği...")

  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (!course) {
    console.error("Course not found!")
    return
  }

  // 1. Delete all Questions of this course
  const deletedQ = await prisma.question.deleteMany({
    where: { courseId: course.id }
  })
  console.log(`Deleted ${deletedQ.count} questions from database.`)

  // 2. Delete all Flashcards of this course
  const deletedFC = await prisma.flashcard.deleteMany({
    where: { courseId: course.id }
  })
  console.log(`Deleted ${deletedFC.count} flashcards from database.`)

  // 3. Reset all Sections of this course
  const resetSections = await prisma.section.updateMany({
    where: { courseId: course.id },
    data: {
      notes: null,
      verificationScore: 0,
      processed: false,
      verificationIssues: null
    }
  })
  console.log(`Reset ${resetSections.count} sections to pristine state (notes=null, score=0).`)

  // 4. Reset Course status to processing
  await prisma.course.update({
    where: { id: course.id },
    data: { status: "processing" }
  })
  console.log("Course status set to 'processing'.")

  console.log("✨ [COMPLETE RESET COMPLETED] Everything is now 100% clean and ready for a fresh start!")
}

run().catch(console.error).finally(() => prisma.$disconnect())
