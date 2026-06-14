import { prisma } from "./src/lib/prisma"

async function run() {
  const sec7 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 7
    }
  })

  if (!sec7 || !sec7.notes) {
    console.error("Section 7 not found!")
    return
  }

  // Print line numbers and outline of section 7 notes
  const lines = sec7.notes.split("\n")
  console.log("=== Outline of Section 7 Notes ===")
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("#") || trimmed.startsWith("🎬") || trimmed.startsWith("graph ") || trimmed.startsWith("|") || trimmed.startsWith(">")) {
      // Print context (5 lines before/after headers to see transitions)
      if (trimmed.startsWith("#")) {
        console.log(`\nLine ${index + 1}: ${line}`)
      } else if (trimmed.startsWith("🎬") || trimmed.startsWith("graph") || trimmed.startsWith(">")) {
        console.log(`  Line ${index + 1}: ${trimmed.substring(0, 100)}`)
      }
    }
  })
}

run().catch(console.error).finally(() => prisma.$disconnect())
