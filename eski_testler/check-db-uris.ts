import { prisma } from './src/lib/prisma';

async function main() {
  const course = await prisma.course.findUnique({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })
  
  if (!course) return;
  console.log(`geminiFileUri: ${course.geminiFileUri}`);
  console.log(`geminiFileUris: ${course.geminiFileUris ? "Var (" + course.geminiFileUris.length + " bytes)" : "Yok"}`);
}
main().catch(console.error).finally(() => prisma.$disconnect())
