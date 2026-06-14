import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: {
      sections: {
        orderBy: { order: "asc" },
        select: {
          title: true,
          order: true,
          processed: true,
          verificationScore: true,
          notes: true
        }
      },
      _count: {
        select: {
          questions: true,
          flashcards: true
        }
      }
    }
  })

  if (!course) {
    console.log("Course not found!")
    return
  }

  const loadedNotes = course.sections.filter(s => s.notes && s.notes.trim().length > 100).length
  console.log(`Ders: ${course.name} | Durum: ${course.status}`)
  console.log(`Bölümler: Toplam ${course.sections.length} | Yüklü Notlar: ${loadedNotes}`)
  console.log(`Sorular: ${course._count.questions} | Flashcard: ${course._count.flashcards}`)

  if (loadedNotes > 0) {
    console.log("\nYüklü/İşlenen Bölümler:")
    course.sections.forEach(s => {
      if (s.notes && s.notes.trim().length > 100) {
        console.log(`- [Bölüm ${s.order}] ${s.title} (Skor: ${s.verificationScore}%)`)
      }
    })
  }
}

run().catch(console.error).finally(() => prisma.$disconnect())
