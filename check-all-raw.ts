import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  })
  
  if (!course) return;
  for (const s of course.sections) {
    console.log(`Section ${s.order}: rawLength=${s.rawContent?.length}, hasFlag=${s.rawContent?.includes("[MARKDOWN_OCR_SUCCESS]")}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
