import { prisma } from '../src/lib/prisma';

async function resetSection2() {
  console.log("Resetting Section 2 (Bilgi Güvenliği Yönetimi)...");
  
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  });

  if (!course) {
    console.error("Course not found!");
    return;
  }

  // Find Section 2 (which is index 1, or order 2, let's find by title)
  const section = course.sections.find(s => s.title.includes("BİLGİ GÜVENLİĞİ") || s.title.includes("Bilgi Güvenliği"));
  
  if (!section) {
    console.error("Section 2 not found!");
    return;
  }

  console.log(`Found section: ${section.title} (ID: ${section.id})`);

  // 1. Delete all Questions for this section
  const deletedQ = await prisma.question.deleteMany({
    where: { sectionId: section.id }
  });
  console.log(`Deleted ${deletedQ.count} questions.`);

  // 2. Delete all Flashcards for this section
  const deletedF = await prisma.flashcard.deleteMany({
    where: { sectionId: section.id }
  });
  console.log(`Deleted ${deletedF.count} flashcards.`);

  // 3. Reset Section Data
  await prisma.section.update({
    where: { id: section.id },
    data: {
      notes: null,
      processed: false,
      verificationScore: null,
      verificationIssues: null
    }
  });
  console.log(`Reset section data (notes, processed, scores, issues).`);

  // Ensure course is processing or paused
  await prisma.course.update({
    where: { id: course.id },
    data: { status: "paused" }
  });

  console.log("Done! Section 2 is completely reset.");
}

resetSection2()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
