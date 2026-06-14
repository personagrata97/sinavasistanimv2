import { prisma } from '../src/lib/prisma';

async function run() {
  const course = await prisma.course.findUnique({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    include: { sections: { orderBy: { order: 'asc' } } }
  });

  if (!course) {
    console.log("Course not found!");
    return;
  }

  console.log(`Course: ${course.name}`);
  for (const s of course.sections) {
    console.log(`[${s.order}] ID: ${s.id} | Title: ${s.title}`);
    
    // Check if title should be KEPT
    const keep = s.title.toLowerCase().includes("kısaltmalar") || s.title.toLowerCase().includes("bilgi sistemleri güvenliği yönetimi");
    
    if (!keep) {
      console.log(`  -> CLEARING: ${s.title}`);
      await prisma.section.update({
        where: { id: s.id },
        data: {
          notes: null,
          verificationScore: null,
          verificationIssues: null
        }
      });
      // Clear questions and flashcards explicitly
      await prisma.question.deleteMany({ where: { sectionId: s.id } });
      await prisma.flashcard.deleteMany({ where: { sectionId: s.id } });
    } else {
      console.log(`  -> KEEPING: ${s.title}`);
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
