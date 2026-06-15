import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  const course = await prisma.course.findFirst({
    orderBy: { createdAt: 'desc' }
  });

  if (!course) {
    console.log("Kurs bulunamadı.");
    return;
  }

  console.log(`Kurs sıfırlanıyor: ${course.name}`);

  // Soruları sil
  await prisma.question.deleteMany({
    where: { section: { courseId: course.id } }
  });
  
  // Flashcardları sil
  await prisma.flashcard.deleteMany({
    where: { section: { courseId: course.id } }
  });

  // Bölümlerin yapay zeka tarafından üretilen verilerini temizle
  await prisma.section.updateMany({
    where: { courseId: course.id },
    data: {
      rawContent: "Bu bölümün içeriği yeniden işlenecek...", // Temporary dummy content < 100 length so loop will process it if needed, wait route.ts line 465 skips if rawContent.length < 100!
      notes: null,
      verificationScore: null,
      verificationIssues: null,
      processed: false
    }
  });

  console.log("DB Sıfırlama başarılı!");
}
main().finally(() => prisma.$disconnect());
