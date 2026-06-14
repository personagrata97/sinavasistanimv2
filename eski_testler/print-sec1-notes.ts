import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })
  if (!course) return
  const sec = await prisma.section.findFirst({
    where: { courseId: course.id, order: 1 }
  })
  if (!sec || !sec.notes) return
  console.log(sec.notes)
}

run().catch(console.error).finally(() => prisma.$disconnect())
