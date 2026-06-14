import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (!course) {
    console.log("Course not found!")
    return
  }

  const sec17 = await prisma.section.findFirst({
    where: { courseId: course.id, order: 17 }
  })
  const sec18 = await prisma.section.findFirst({
    where: { courseId: course.id, order: 18 }
  })

  if (sec17) {
    console.log(`=== BÖLÜM 17: "${sec17.title}" (Sayfa ${sec17.pageStart} - ${sec17.pageEnd}) ===`)
    console.log("Not uzunluğu:", sec17.notes ? sec17.notes.length : 0)
    console.log("İçerik özeti:")
    console.log(sec17.rawContent.substring(0, 1500))
  }

  if (sec18) {
    console.log(`\n=== BÖLÜM 18: "${sec18.title}" (Sayfa ${sec18.pageStart} - ${sec18.pageEnd}) ===`)
    console.log("İçerik özeti:")
    console.log(sec18.rawContent.substring(0, 1500))
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
