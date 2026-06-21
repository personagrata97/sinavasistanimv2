import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const kvkk = await prisma.course.findFirst({where: {slug: {contains: "kvkk"}}})
  console.log("KVKK Status:", kvkk?.status)
  if (kvkk) {
    const sections = await prisma.section.findMany({where: {courseId: kvkk.id}})
    console.log("KVKK Sections Total:", sections.length)
    console.log("KVKK Sections Processed:", sections.filter(s => s.processed).length)
  }
}
main()
