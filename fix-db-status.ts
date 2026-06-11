import { prisma } from './src/lib/prisma';
async function main() {
  // 1. Tüm section'ları sıfırla
  await prisma.section.updateMany({
    where: { course: { slug: 'bd-bilgi-sistemleri-guvenligi' } },
    data: { processed: false, notes: null, verificationScore: 0, verificationIssues: null }
  });
  
  // 2. Flashcard ve soruları sil
  const course = await prisma.course.findUnique({ where: { slug: 'bd-bilgi-sistemleri-guvenligi' } });
  if (course) {
    await prisma.flashcard.deleteMany({ where: { courseId: course.id } });
    await prisma.question.deleteMany({ where: { courseId: course.id } });
  }
  
  // 3. Course status'u processing'e çek
  await prisma.course.update({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    data: { status: 'pending', updatedAt: new Date() }
  });
  
  console.log('✅ Tüm veriler sıfırlandı. Yeni ayarlarla tekrar işlenmeye hazır.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
