import { prisma } from './src/lib/prisma'

async function main() {
  const sections = await prisma.section.findMany({
    where: {
      verificationIssues: {
        contains: 'Yapılandırılıyor'
      }
    },
    select: { id: true, title: true, verificationIssues: true, updatedAt: true }
  });
  console.log("Sections stuck with 'Yapılandırılıyor':", sections);
  
  const processingCourses = await prisma.course.findMany({
    where: { status: 'processing' },
    select: { id: true, name: true, status: true, updatedAt: true }
  });
  console.log("Processing Courses:", processingCourses);
}

main().catch(console.error).finally(() => prisma.$disconnect());
