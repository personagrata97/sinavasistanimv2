import { prisma } from './src/lib/prisma'

async function main() {
  const course = await prisma.course.findFirst({ where: { status: 'processing' } });
  if (!course) {
     console.log("No processing course found");
     return;
  }
  const sections = await prisma.section.findMany({
    where: { courseId: course.id, processed: false }
  });
  console.log("Unprocessed sections:", sections.map(s => ({ title: s.title, verificationIssues: s.verificationIssues })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
