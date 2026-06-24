import { prisma } from './src/lib/prisma';

async function check() {
  const logs = await prisma.apiUsageLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log("LAST 5 LOGS:");
  logs.forEach(l => console.log(l.operation + ' : ' + l.status));
}

check().catch(console.error).finally(() => prisma.$disconnect());
