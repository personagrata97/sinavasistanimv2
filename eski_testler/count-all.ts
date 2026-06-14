import { prisma } from "./src/lib/prisma"

async function run() {
  const allQuestions = await prisma.question.count()
  const allFlashcards = await prisma.flashcard.count()
  console.log(`Global -> Questions: ${allQuestions} | Flashcards: ${allFlashcards}`)

  const sec1 = await prisma.section.findFirst({
    where: { order: 1, course: { slug: "bd-bilgi-sistemleri-guvenligi" } }
  })

  if (sec1) {
    const q1 = await prisma.question.count({ where: { sectionId: sec1.id } })
    const fc1 = await prisma.flashcard.count({ where: { sectionId: sec1.id } })
    console.log(`Section 1 ("${sec1.title}") -> Questions: ${q1} | Flashcards: ${fc1}`)
    console.log(`Notes Length: ${sec1.notes ? sec1.notes.length : 0}`)
    console.log(`verificationScore: ${sec1.verificationScore}`)
    console.log(`processed: ${sec1.processed}`)
    console.log(`verificationIssues: ${sec1.verificationIssues}`)
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
