import { prisma } from "./src/lib/prisma"

async function run() {
  const sec7 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 7
    }
  })

  if (!sec7 || !sec7.notes) {
    console.error("Section 7 or notes not found!")
    return
  }

  // Find all tables in markdown format (| ... |)
  const lines = sec7.notes.split("\n")
  let inTable = false
  let tableLines: string[] = []

  lines.forEach((line, index) => {
    if (line.trim().startsWith("|")) {
      if (!inTable) {
        console.log(`\n--- Table found starting at line ${index + 1} ---`)
        inTable = true
      }
      tableLines.push(`${index + 1}: ${line}`)
    } else {
      if (inTable) {
        console.log(tableLines.join("\n"))
        tableLines = []
        inTable = false
      }
    }
  })
}

run().catch(console.error).finally(() => prisma.$disconnect())
