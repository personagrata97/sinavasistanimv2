import { prisma } from "./src/lib/prisma"

async function run() {
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" }
    },
    orderBy: { order: "asc" },
    include: {
      _count: {
        select: {
          questions: true,
          flashcards: true
        }
      }
    }
  })

  console.log("=== COURSE ITEM COUNTS ===")
  for (const s of sections) {
    console.log(`Section #${s.order}: ${s.title} | Questions: ${s._count.questions} | Flashcards: ${s._count.flashcards}`)
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
