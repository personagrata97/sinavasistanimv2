import { prisma } from '../src/lib/prisma';

async function run() {
  const sections = await prisma.section.findMany({
    where: { course: { slug: 'bd-bilgi-sistemleri-guvenligi' } },
    orderBy: { order: 'asc' },
    select: { title: true, order: true, processed: true }
  });
  console.log("Sections in DB:", sections);
}
run().catch(console.error);
