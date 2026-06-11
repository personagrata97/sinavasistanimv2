import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  })
  
  if (!course) return;
  const sec1 = course.sections[0];
  console.log(`Section 1 rawContent length: ${sec1.rawContent ? sec1.rawContent.length : 0}`);
}
main().catch(console.error).finally(() => prisma.$disconnect())
