import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: {
      sections: {
        orderBy: { order: "asc" }
      }
    }
  })

  if (!course) {
    console.error("Course not found!")
    return
  }

  console.log(`=== COURSE: ${course.name} | Status: ${course.status} ===`)
  for (const s of course.sections) {
    const qCount = await prisma.question.count({ where: { sectionId: s.id } })
    const fCount = await prisma.flashcard.count({ where: { sectionId: s.id } })
    const notesLen = s.notes ? s.notes.length : 0
    console.log(`Section #${s.order}: ${s.title}`)
    console.log(`  - Processed: ${s.processed} | Score: ${s.verificationScore}%`)
    console.log(`  - Notes: ${notesLen} chars | Questions: ${qCount} | Flashcards: ${fCount}`)
    if (s.verificationIssues) {
      try {
        const issues = JSON.parse(s.verificationIssues)
        if (issues.missingTopics && issues.missingTopics.length > 0) {
          console.log(`  - Missing Topics:`, issues.missingTopics.slice(0, 3))
        }
        if (issues.issues && issues.issues.length > 0) {
          console.log(`  - Issues:`, issues.issues.slice(0, 3))
        }
      } catch {}
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
