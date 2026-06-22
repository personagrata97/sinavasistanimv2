import { prisma } from './src/lib/prisma'
async function main() {
  const courses = await prisma.course.findMany({ select: { name: true } });
  console.log(courses);
}
main().catch(console.error).finally(() => prisma.$disconnect())
