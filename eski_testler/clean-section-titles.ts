import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (!course) {
    console.log("Course not found!")
    return
  }

  const sections = await prisma.section.findMany({
    where: { courseId: course.id }
  })

  console.log(`Cleaning parenthesized parts like (Bölüm X/Y) or (Bölüm X) from ${sections.length} sections...`)

  let updatedCount = 0

  for (const sec of sections) {
    // Regex to match (Bölüm X/Y) or (Bölüm X) case-insensitively, with or without Turkish characters (bölüm, bolum, vb.)
    // It should also match trailing whitespace.
    const cleanedTitle = sec.title.replace(/\s*\(\s*Bölüm\s*\d+\/\d+\s*\)/gi, "")
                                  .replace(/\s*\(\s*Bölüm\s*\d+\s*\)/gi, "")
                                  .replace(/\s*\(\s*Bolum\s*\d+\/\d+\s*\)/gi, "")
                                  .replace(/\s*\(\s*Bolum\s*\d+\s*\)/gi, "")
                                  .trim()

    if (cleanedTitle !== sec.title) {
      console.log(`Renaming: "${sec.title}" -> "${cleanedTitle}"`)
      await prisma.section.update({
        where: { id: sec.id },
        data: { title: cleanedTitle }
      })
      updatedCount++
    }
  }

  console.log(`Successfully cleaned ${updatedCount} section titles in the database!`)
}

run().catch(console.error).finally(() => prisma.$disconnect())
