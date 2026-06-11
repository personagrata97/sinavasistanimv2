import { prisma } from './src/lib/prisma';
import fs from 'fs';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: { sections: { orderBy: { order: 'asc' } } }
  })
  
  if (!course) return;
  const sec1 = course.sections[0];
  fs.writeFileSync('kisaltmalar_dump.txt', sec1.notes);
  console.log("Notlar kisaltmalar_dump.txt dosyasına yazıldı. Toplam karakter:", sec1.notes.length);
}
main().catch(console.error).finally(() => prisma.$disconnect())
