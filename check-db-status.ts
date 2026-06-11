import { prisma } from './src/lib/prisma';
async function main() {
  const c = await prisma.course.findUnique({ where: { slug: 'bd-bilgi-sistemleri-guvenligi' }});
  console.log('STATUS:', c?.status);
}
main().catch(console.error).finally(() => prisma.$disconnect());
