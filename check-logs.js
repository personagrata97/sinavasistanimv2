const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.apiUsageLog.findMany({
    where: {
      status: "FORBIDDEN_403"
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(logs);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
