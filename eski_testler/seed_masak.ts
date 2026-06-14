import { prisma } from './src/lib/prisma'

async function main() {
  // Delete all old MASAK courses
  const deleted = await prisma.course.deleteMany({
    where: {
      program: { slug: "masak" }
    }
  })
  console.log("Deleted old courses:", deleted.count)

  // Create proper single module
  const masakProgram = await prisma.program.findUnique({ where: { slug: "masak" } })
  if (!masakProgram) { console.log("MASAK program not found!"); return }

  const m = {
    name: "MASAK Uyum Görevlisi Yetkilendirme Sınavı",
    slug: "masak-uyum-gorevlisi",
    order: 1,
    description: "Modül 1 (Hukuki Çerçeve) ve Modül 2 (Uyum Yönetimi) tüm konuları kapsar."
  }

  const existing = await prisma.course.findUnique({ where: { slug: m.slug } })
  if (!existing) {
    await prisma.course.create({ data: { ...m, programId: masakProgram.id } })
    console.log("+ Created:", m.name)
  } else {
    console.log("= Exists:", m.name)
  }

  const count = await prisma.course.count({ where: { program: { slug: "masak" } } })
  console.log("\nTotal MASAK courses in DB:", count)
}

main().catch(console.error)
