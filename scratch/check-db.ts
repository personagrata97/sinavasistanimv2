import { prisma } from '../src/lib/prisma';

async function run() {
  const course = await prisma.course.findUnique({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    include: {
      _count: {
        select: { flashcards: true, questions: true }
      }
    }
  });
  console.log("Course _count:", course?._count);
  
  const totalCards = await prisma.flashcard.count({ where: { courseId: course?.id } });
  const totalQuestions = await prisma.question.count({ where: { courseId: course?.id } });
  console.log("Actual flashcards count:", totalCards);
  console.log("Actual questions count:", totalQuestions);
}
run().catch(console.error);
