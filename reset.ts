import { prisma } from './src/lib/prisma';

async function reset() {
  await prisma.course.updateMany({ data: { status: 'error' } });
  console.log('Tüm dersler error moduna çekildi.');
}

reset().catch(console.error).finally(() => prisma.$disconnect());
