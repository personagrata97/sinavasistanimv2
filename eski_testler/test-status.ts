import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  })
  
  if (!course) {
    console.log("Kurs bulunamadı");
    return;
  }
  
  console.log(`Course status: ${course.processingStatus}`);
  
  for (const s of course.sections) {
    console.log(`Section ${s.order} (${s.title}): Status=${s.status}, NotesLength=${s.notes ? s.notes.length : 0}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
