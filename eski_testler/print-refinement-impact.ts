import { prisma } from "./src/lib/prisma"

async function run() {
  const targetOrders = [7, 9, 14, 15, 17, 18];
  
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: { in: targetOrders }
    },
    include: {
      _count: {
        select: {
          questions: true,
          flashcards: true
        }
      }
    },
    orderBy: { order: "asc" }
  })

  console.log("=== REFINEMENT DETAILED IMPACT ANALYSIS ===\n")

  for (const s of sections) {
    const notesLength = s.notes ? s.notes.length : 0
    let issuesObj: any = {}
    try {
      issuesObj = JSON.parse(s.verificationIssues || "{}")
    } catch {}

    const history = issuesObj.attemptHistory || []
    
    console.log(`Bölüm #${s.order}: "${s.title}"`)
    console.log(`- Son Doğrulama Skoru: %${s.verificationScore}`)
    console.log(`- Güncel Not Karakter Sayısı: ${notesLength} karakter`)
    console.log(`- Güncel Soru Sayısı: ${s._count.questions} soru`)
    console.log(`- Güncel Flashcard Sayısı: ${s._count.flashcards} kart`)
    
    if (history.length > 0) {
      console.log("- Gelişim Zaman Tüneli Adımları:")
      history.forEach((h: any, idx: number) => {
        console.log(`  * Tur #${h.attempt || idx + 1}: Skor %${h.score || "Bilinmiyor"}`)
        if (h.missingTopics && h.missingTopics.length > 0) {
          console.log("    Eksik Tespitleri:")
          h.missingTopics.forEach((t: string) => console.log(`    - ❌ ${t}`))
        }
      })
    }

    // Inspect headings inside notes to show where topics were integrated
    if (s.notes) {
      console.log("- Ders Notlarındaki Entegre Edilen Başlıklar ve Yapı:")
      const lines = s.notes.split('\n')
      const headings = lines.filter(l => l.startsWith('##') || l.startsWith('###')).slice(0, 8)
      headings.forEach(h => console.log(`  * ${h}`))
    }
    console.log("\n--------------------------------------------------\n")
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
