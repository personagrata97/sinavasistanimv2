import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const course = await prisma.course.findFirst({ where: { name: { contains: 'Varlık Yönetimi' } } })
  if (!course) {
    console.log("Varlık Yönetimi dersi bulunamadı.")
    return
  }
  console.log(`Ders bulundu: ${course.name} (ID: ${course.id})`)
  
  const sections = await prisma.section.findMany({ where: { courseId: course.id } })
  console.log(`Bölüm sayısı: ${sections.length}`)
  
  let inspectorCount = 0;
  for (const s of sections) {
    if (s.verificationIssues) {
      if (s.verificationIssues.includes('inspectorFindings') || s.verificationIssues.includes('MÜFETTİŞ')) {
        inspectorCount++;
        console.log(`- ${s.title}: Müfettiş denetimi YAPILMIŞ (Skor: ${s.verificationScore})`);
      }
    }
  }
  console.log(`Müfettiş denetiminden geçen bölüm sayısı: ${inspectorCount} / ${sections.length}`)
}
main().catch(console.error).finally(() => prisma.$disconnect())
