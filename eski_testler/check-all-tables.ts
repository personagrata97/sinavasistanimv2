import { prisma } from "./src/lib/prisma"

async function run() {
  const sections = await prisma.section.findMany({
    where: { course: { slug: "masak-uyum-gorevlisi" } },
    orderBy: { order: "asc" }
  })

  for (const sec of sections) {
    if (!sec.notes) continue
    const lines = sec.notes.split("\n")
    let inTable = false
    let tableLines: string[] = []

    lines.forEach((line, index) => {
      if (line.trim().startsWith("|")) {
        if (!inTable) {
          tableLines.push(`\n--- Section ${sec.order}: ${sec.title} | Table starts at line ${index + 1} ---`)
          inTable = true
        }
        tableLines.push(`${line}`)
      } else {
        if (inTable) {
          console.log(tableLines.join("\n"))
          tableLines = []
          inTable = false
        }
      }
    })
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
