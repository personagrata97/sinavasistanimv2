import { prisma } from './src/lib/prisma'

async function main() {
  console.log("Cleaning old sections for bd-bilgi-sistemleri-guvenligi...")
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (course) {
    const deleted = await prisma.section.deleteMany({
      where: { courseId: course.id }
    })
    console.log(`Deleted ${deleted.count} sections!`)
  } else {
    console.log("Course not found!")
  }
}

main().catch(console.error)
