import { prisma } from "./src/lib/prisma"

async function run() {
  const sec4 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 4
    }
  })

  if (!sec4 || !sec4.notes) {
    console.error("Section 4 not found!")
    return
  }

  // Look for bold markers around "iş hanı yönetimi" or "kayıtların saklanması"
  console.log("=== Checking Section 4 Notes for Bold Refined Terms ===")
  const text = sec4.notes
  
  const checkTerms = ["iş hanı yönetimi", "kayıtların saklanması", "üçüncü taraftan derhal temin", "uluslararası standartlara uygun"]
  
  checkTerms.forEach(term => {
    // Search occurrences of term and print context
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
