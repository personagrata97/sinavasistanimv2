import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (!course) {
    console.log("Course not found!")
    return
  }

  const firstSection = await prisma.section.findFirst({
    where: { courseId: course.id, order: 1 }
  })

  if (firstSection) {
    console.log(`Current Title: ${firstSection.title}`)
    const updated = await prisma.section.update({
      where: { id: firstSection.id },
      data: {
        title: "Kısaltmalar ve Terimler"
      }
    })
    console.log(`Updated Title: ${updated.title}`)
  } else {
    console.log("Section 1 not found!")
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
