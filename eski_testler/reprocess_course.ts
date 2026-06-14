import { prisma } from './src/lib/prisma'

async function main() {
  // Find courses that say "ready" but have unprocessed sections (stuck)
  const courses = await prisma.course.findMany({
    where: { status: "ready" },
    include: { sections: { select: { processed: true } } }
  })

  for (const c of courses) {
    const total = c.sections.length
    const done = c.sections.filter(s => s.processed).length
    if (total > 0 && done < total) {
      await prisma.course.update({
        where: { id: c.id },
        data: { status: "uploaded" }
      })
      console.log(`🔄 Reset: "${c.name}" (${done}/${total} done) → status: uploaded`)
    }
  }
  
  console.log("\nDone. Go to the UI and click 'İçeriği İşle' for each reset course.")
}

main().catch(console.error).finally(() => prisma.$disconnect())
