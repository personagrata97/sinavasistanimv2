import { prisma } from './src/lib/prisma'

async function main() {
  const logs = await prisma.apiUsageLog.findMany();
  for (const log of logs) {
    if (log.courseSlug.includes("GroundTruth (")) {
      const newSlug = log.courseSlug.replace("GroundTruth (", "").replace(")", "");
      await prisma.apiUsageLog.update({
        where: { id: log.id },
        data: { courseSlug: newSlug }
      });
    }
  }
  console.log("Eski loglardaki GroundTruth yazilari silindi.");
}
main().catch(console.error)
