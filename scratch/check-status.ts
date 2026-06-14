import { prisma } from '../src/lib/prisma';

async function run() {
  const course = await prisma.course.findUnique({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    select: { status: true, processedPages: true, totalPages: true, name: true, _count: { select: { flashcards: true, questions: true, sections: true } } }
  });
  console.log("Course status:", course);
  
  const sections = await prisma.section.findMany({
    where: { courseId: course?.id }
  });
  console.log("Sections count:", sections.length);
  const processedCount = sections.filter(s => s.processed).length;
  console.log("Processed sections:", processedCount);
}
run().catch(console.error);
