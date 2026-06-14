import { prisma } from './src/lib/prisma'

async function main() {
  const logs = await prisma.apiUsageLog.findMany({
    where: {
      courseSlug: {
        startsWith: "SPL Düzey 3 > Bilgi Sistemleri Güvenliği"
      }
    }
  });
  for (const log of logs) {
    const newSlug = log.courseSlug.replace("SPL Düzey 3 >", "Bilgi Sistemleri Bağımsız Denetim >");
    await prisma.apiUsageLog.update({
      where: { id: log.id },
      data: { courseSlug: newSlug }
    });
  }
  console.log("DB fixed!");
}
main().catch(console.error)
