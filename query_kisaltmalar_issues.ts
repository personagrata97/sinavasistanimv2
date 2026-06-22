import { prisma } from './src/lib/prisma'
async function main() {
  const section = await prisma.section.findFirst({
    where: { title: { contains: 'KISALTMALAR' } },
    select: { title: true, verificationIssues: true }
  })
  if (section) {
    console.log("TITLE:", section.title)
    console.log("ISSUES:", section.verificationIssues)
  } else {
    console.log("Not found.")
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
