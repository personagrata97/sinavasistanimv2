import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } }, flashcards: true, questions: true }
  })
  
  if (!course) return;
  const sec1 = course.sections[0];
  const fCount = course.flashcards.filter(f => f.sectionId === sec1.id).length;
  const qCount = course.questions.filter(q => q.sectionId === sec1.id).length;
  
  console.log(`Section 1 status: ${sec1.status}`);
  console.log(`Flashcards: ${fCount}`);
  console.log(`Questions: ${qCount}`);
}
main().catch(console.error).finally(() => prisma.$disconnect())
