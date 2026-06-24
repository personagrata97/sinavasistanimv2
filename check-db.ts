import { prisma } from './src/lib/prisma';

async function check() {
  const course = await prisma.course.findFirst({
    orderBy: { updatedAt: 'desc' },
    include: { sections: true }
  });
  
  if (!course) {
    console.log("No course found.");
    return;
  }
  
  console.log("Course:", course.name);
  console.log("Status:", course.status);
  console.log("Sections:", course.sections.length);
  if (course.sections.length > 0) {
    console.log("First section:", course.sections[0].title);
    console.log("Page Start:", course.sections[0].pageStart);
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
