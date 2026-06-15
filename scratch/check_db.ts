import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const course = await prisma.course.findFirst({
    where: { name: { contains: "Bilgi Sistemleri" } },
    include: { sections: true }
  });
  if (!course) {
    console.log("Course not found");
    return;
  }
  console.log(`Course: ${course.name}`);
  console.log(`Sections count: ${course.sections.length}`);
  
  let processedCount = 0;
  let ocrSuccessCount = 0;
  
  for (const s of course.sections) {
    if (s.processed) processedCount++;
    if (s.rawContent && s.rawContent.includes("[MARKDOWN_OCR_SUCCESS]")) ocrSuccessCount++;
  }
  
  console.log(`Processed sections: ${processedCount}`);
  console.log(`Sections with perfect OCR: ${ocrSuccessCount}`);
}
main().finally(() => prisma.$disconnect());
