import { prisma } from "./src/lib/prisma"

async function run() {
  const sec1 = await prisma.section.findFirst({
    where: { order: 1, course: { slug: "bd-bilgi-sistemleri-guvenligi" } }
  })

  if (!sec1) {
    console.log("Section 1 not found!")
    return
  }

  const questions = await prisma.question.findMany({
    where: { sectionId: sec1.id }
  })
  const flashcards = await prisma.flashcard.findMany({
    where: { sectionId: sec1.id }
  })

  console.log(`Section 1: ${sec1.title}`)
  console.log(`Questions found: ${questions.length}`)
  console.log(`Flashcards found: ${flashcards.length}`)

  if (questions.length > 0) {
    console.log("Questions list:")
    questions.forEach(q => console.log(`- ${q.text.substring(0, 80)}`))
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
