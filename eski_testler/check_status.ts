import { prisma } from './src/lib/prisma'

async function main() {
  // Check ALL courses and their processing status
  const courses = await prisma.course.findMany({
    include: { 
      sections: { select: { id: true, title: true, processed: true, rawContent: true } },
      _count: { select: { flashcards: true, questions: true } }
    },
    orderBy: { name: "asc" }
  })

  for (const c of courses) {
    const total = c.sections.length
    const done = c.sections.filter(s => s.processed).length
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    console.log(`\n📚 ${c.name}`)
    console.log(`   Status: ${c.status} | Sections: ${done}/${total} (${pct}%) | Flashcards: ${c._count.flashcards} | Questions: ${c._count.questions}`)
    if (c.status === "processing") {
      const next = c.sections.find(s => !s.processed)
      if (next) console.log(`   ⏳ Next: "${next.title}" (${next.rawContent.length} chars)`)
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
