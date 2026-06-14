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

  if (sec17) {
    console.log(`=== BÖLÜM 17: ${sec17.title} ===`)
    console.log(`Sayfa Aralığı: ${sec17.pageStart} - ${sec17.pageEnd}`)
    console.log("-----------------------------------------")
    console.log(sec17.rawContent.substring(0, 2500))
  } else {
    console.log("Section 17 not found!")
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
