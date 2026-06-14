import { prisma } from "./src/lib/prisma"

async function run() {
  console.log("=== Checking Section 1 Notes for Bold Refined Terms ===")
  const sec1 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 1
    }
  })

  if (!sec1 || !sec1.notes) {
    console.error("Section 1 not found!")
    return
  }

  const text = sec1.notes
  const checkTerms = ["30474", "11/10/2006", "evrakın tetkikine yetkili"]
  
  checkTerms.forEach(term => {
    let index = text.toLowerCase().indexOf(term.toLowerCase())
    while (index !== -1) {
      const start = Math.max(0, index - 40)
      const end = Math.min(text.length, index + term.length + 40)
      console.log(`\nMatch for "${term}":`)
      console.log(text.substring(start, end))
      index = text.toLowerCase().indexOf(term.toLowerCase(), index + 1)
    }
  })
}

run().catch(console.error).finally(() => prisma.$disconnect())
