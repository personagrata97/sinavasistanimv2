import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  })
  
  if (!course) return;
  const sec1 = course.sections[0];
  console.log(`Bölüm: ${sec1.title}`);
  console.log(`Not Uzunluğu: ${sec1.notes ? sec1.notes.length : 0}`);
  console.log(`Son Skor: ${sec1.verificationScore}`);
  
  try {
    const issues = JSON.parse(sec1.verificationIssues || "{}");
    console.log(`Log Geçmişi / History:`, JSON.stringify(issues.history || issues.attemptHistory || "Yok", null, 2));
  } catch(e) {
    console.log("JSON parse hatası");
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
