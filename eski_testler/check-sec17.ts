import { prisma } from "./src/lib/prisma"

async function run() {
  const sec17 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 17
    }
  })

  if (!sec17) {
    console.error("Section 17 not found!")
    return
  }

  console.log("=== SECTION 17 DETAILS ===")
  console.log(`Title: ${sec17.title}`)
  console.log(`Raw Content Length: ${sec17.rawContent ? sec17.rawContent.length : 0} chars`)
  console.log(`Notes Length: ${sec17.notes ? sec17.notes.length : 0} chars`)
  console.log(`Score: ${sec17.verificationScore}%`)
  
  console.log("\n--- Notes Preview (First 800 chars) ---")
  console.log(sec17.notes ? sec17.notes.substring(0, 800) : "No notes")
}

run().catch(console.error).finally(() => prisma.$disconnect())
