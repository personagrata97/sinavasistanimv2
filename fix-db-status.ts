import { prisma } from './src/lib/prisma';
async function main() {
  await prisma.course.updateMany({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    data: { status: 'error' }
  });
  console.log('Status updated to error');
}
main().catch(console.error).finally(() => prisma.$disconnect());
