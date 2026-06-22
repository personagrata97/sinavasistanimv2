import { prisma } from './src/lib/prisma'
async function main() {
  const section = await prisma.section.findFirst({
    where: { title: { contains: 'KISALTMALAR' } },
    select: { title: true, rawContent: true, course: { select: { name: true } } }
  })
  if (section) {
    console.log("COURSE:", section.course?.name)
    console.log("TITLE:", section.title)
    console.log("--- RAW CONTENT START ---")
    console.log(section.rawContent)
    console.log("--- RAW CONTENT END ---")
  } else {
    console.log("Not found.")
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
