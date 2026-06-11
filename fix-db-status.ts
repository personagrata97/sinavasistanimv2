import { prisma } from './src/lib/prisma';
async function main() {
  await prisma.course.updateMany({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    data: { status: 'processing', updatedAt: new Date() }
  });
  console.log('Status updated to processing');
}
main().catch(console.error).finally(() => prisma.$disconnect());
