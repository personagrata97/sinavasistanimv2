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

  // Print text under "Kavramlar ve Tanımlar"
  const lines = sec7.notes.split("\n")
  const startIndex = lines.findIndex(l => l.includes("### 📝 Kavramlar ve Tanımlar"))
  const endIndex = lines.findIndex(l => l.includes("### 🎬 Hikaye Yöntemi"))

  if (startIndex !== -1 && endIndex !== -1) {
    console.log(lines.slice(startIndex, endIndex).join("\n"))
  } else {
    console.log("Could not find range!")
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
