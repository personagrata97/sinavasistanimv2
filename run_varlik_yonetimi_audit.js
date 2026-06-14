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
  
  for (const section of sections) {
    if (!section.notes) {
      console.log(`Bölüm ${section.title} not içermiyor, atlanıyor.`);
      continue;
    }
    console.log(`Bölüm ${section.title} için kontrol başlıyor...`);
    
    // We need to trigger the deep audit logic here.
    // For now, let's just reset their processed status or verification score to trigger the route.ts to pick it up?
    // Wait, the user said: "BU NOTU SİLMEDEN KONTROLÖR GROUND TRUTH VE MÜFETTİŞ SÜREÇLERİNE SOKUCAZ."
    // If I change processed = false and verificationScore = null, route.ts will pick it up and REGENERATE the notes.
    // We don't want to regenerate the notes! "BU NOTU SİLMEDEN"
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
