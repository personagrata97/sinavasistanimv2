const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const courses = await prisma.course.findMany({
    where: { name: { contains: 'Varlık Yönetimi' } },
    include: { sections: true }
  });

  for (const course of courses) {
    console.log(`\n=== KURS: ${course.name} ===`);
    for (const section of course.sections) {
      if (section.verificationScore < 100 && section.verificationIssues) {
        console.log(`\nBölüm: ${section.title}`);
        console.log(`Son Skor: ${section.verificationScore}`);
        try {
          const issues = JSON.parse(section.verificationIssues);
          console.log(`Issues:`, JSON.stringify(issues, null, 2));
        } catch {
          console.log(`Issues (Raw): ${section.verificationIssues}`);
        }
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
