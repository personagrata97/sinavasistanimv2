import { prisma } from './src/lib/prisma'

async function main() {
  const logs = await prisma.apiUsageLog.findMany();
  for (const log of logs) {
    if (log.courseSlug.startsWith("Soru Müfettişi - ")) {
      const topic = log.courseSlug.split(" - ")[1];
      await prisma.apiUsageLog.update({
        where: { id: log.id },
        data: { courseSlug: `SPL Düzey 3 > Bilgi Sistemleri Güvenliği > Soru Müfettişi (${topic})` }
      });
    } else if (log.courseSlug.startsWith("Detay Müfettişi - ")) {
      const topic = log.courseSlug.split(" - ")[1];
      await prisma.apiUsageLog.update({
        where: { id: log.id },
        data: { courseSlug: `SPL Düzey 3 > Bilgi Sistemleri Güvenliği > Detay Müfettişi (${topic})` }
      });
    } else if (log.courseSlug.startsWith("Flashcard Müfettişi - ")) {
      const topic = log.courseSlug.split(" - ")[1];
      await prisma.apiUsageLog.update({
        where: { id: log.id },
        data: { courseSlug: `SPL Düzey 3 > Bilgi Sistemleri Güvenliği > Flashcard Müfettişi (${topic})` }
      });
    } else if (log.courseSlug.startsWith("GroundTruth - ")) {
      const topic = log.courseSlug.split(" - ")[1];
      await prisma.apiUsageLog.update({
        where: { id: log.id },
        data: { courseSlug: `SPL Düzey 3 > Bilgi Sistemleri Güvenliği > GroundTruth (${topic})` }
      });
    } else if (!log.courseSlug.includes(" > ") && log.courseSlug.length > 5) {
      await prisma.apiUsageLog.update({
        where: { id: log.id },
        data: { courseSlug: `SPL Düzey 3 > Bilgi Sistemleri Güvenliği > ${log.courseSlug}` }
      });
    }
  }
  console.log("Eski API loglarındaki eksik lisans isimleri düzeltildi.");
}
main().catch(console.error)
