import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { program: true }
  })

  if (course) {
    console.log(`Course Name: ${course.name}`)
    console.log(`Program Name: ${course.program?.name}`)
    console.log(`aiMode: ${course.program?.aiMode}`)
  } else {
    console.log("Course not found!")
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
