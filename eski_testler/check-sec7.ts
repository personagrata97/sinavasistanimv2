import { prisma } from "./src/lib/prisma"

async function run() {
  const sec7 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 7
    }
  })

  if (!sec7) {
    console.error("Section 7 not found!")
    return
  }

  console.log("=== SECTION 7 DETAILS ===")
  console.log(`Title: ${sec7.title}`)
  console.log(`Score: ${sec7.verificationScore}%`)
  
  console.log("\n--- Notes ---")
  console.log(sec7.notes || "No notes")
}

run().catch(console.error).finally(() => prisma.$disconnect())
