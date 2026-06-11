import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })
  
  if (!course) return;
  console.log("Eski durum:", course.status);

  // Set status to "paused" or "idle" to unlock the UI button without deleting notes
  await prisma.course.update({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    data: { status: "paused" } // Using paused so user can click Devam Et
  });
  
  console.log("Yeni durum paused olarak ayarlandı.");
}
main().catch(console.error).finally(() => prisma.$disconnect())
