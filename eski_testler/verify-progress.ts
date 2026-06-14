import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findUnique({
    where: { slug: "masak-uyum-gorevlisi" },
    include: {
      sections: {
        orderBy: { order: "asc" }
      },
      _count: {
        select: { questions: true, flashcards: true }
      }
    }
  })

  if (!course) {
    console.log("Course not found!")
    return
  }

  const processedCount = course.sections.filter(s => s.processed).length
  const totalCount = course.sections.length
  const progressPercent = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0

  console.log(`\n=== COURSE PROGRESS ===`)
  console.log(`Slug: ${course.slug}`)
  console.log(`Status: ${course.status}`)
  console.log(`Processed Sections: ${processedCount}/${totalCount} (${progressPercent}%)`)
  console.log(`Questions Count: ${course._count.questions}`)
  console.log(`Flashcards Count: ${course._count.flashcards}`)
  console.log(`\n=== SECTIONS STATUS ===`)
  course.sections.forEach((s, i) => {
    console.log(`Section #${s.order}: ${s.title} | Processed: ${s.processed} | Notes: ${s.notes ? s.notes.substring(0, 30) + '...' : 'NONE'}`)
  })
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
