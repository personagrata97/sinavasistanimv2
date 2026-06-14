import { prisma } from "./src/lib/prisma"

async function run() {
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: { in: [3, 6, 7, 9, 15, 17, 18] }
    },
    orderBy: { order: "asc" }
  })

  console.log("=== MASAK SECTIONS ISSUES ===")
  for (const s of sections) {
    console.log(`\nSection #${s.order}: ${s.title}`)
    console.log(`  Score: ${s.verificationScore}% | Processed: ${s.processed}`)
    console.log(`  Issues: ${s.verificationIssues}`)
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
