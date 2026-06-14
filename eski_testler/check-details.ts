import { prisma } from "./src/lib/prisma"

async function run() {
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: { in: [6, 17] }
    }
  })

  for (const s of sections) {
    console.log(`\n=================== SECTION #${s.order}: ${s.title} ===================`)
    console.log(`Score: ${s.verificationScore}%`)
    console.log(`Processed: ${s.processed}`)
    console.log(`Issues:`, JSON.stringify(JSON.parse(s.verificationIssues || "{}"), null, 2))
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
