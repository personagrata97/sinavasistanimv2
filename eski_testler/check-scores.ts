import { prisma } from "./src/lib/prisma"

async function run() {
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" }
    },
    orderBy: { order: "asc" }
  })

  console.log("=== MASAK COURSE SECTIONS ===")
  for (const s of sections) {
    console.log(`Section #${s.order}: ${s.title} | Score: ${s.verificationScore}% | Processed: ${s.processed}`)
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
