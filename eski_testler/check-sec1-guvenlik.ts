import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })
  if (!course) {
    console.error("Course not found!")
    return
  }
  const sec = await prisma.section.findFirst({
    where: { courseId: course.id, order: 1 }
  })
  if (!sec) {
    console.error("Section not found!")
    return
  }
  console.log("Section Title:", sec.title)
  console.log("Notes Length:", sec.notes?.length || 0)
  console.log("Notes snippet:", sec.notes ? sec.notes.substring(0, 500) : "NULL")
  console.log("Processed:", sec.processed)
  console.log("Verification Score:", sec.verificationScore)
  console.log("Verification Issues:", sec.verificationIssues)

  const cardsCount = await prisma.flashcard.count({ where: { sectionId: sec.id } })
  const questionsCount = await prisma.question.count({ where: { sectionId: sec.id } })
  console.log("Flashcards Count:", cardsCount)
  console.log("Questions Count:", questionsCount)
}

run().catch(console.error).finally(() => prisma.$disconnect())
