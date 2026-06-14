import { PrismaClient } from '@prisma/client'

// Bypass options validation by just letting it use .env
const prisma = new PrismaClient()

async function main() {
  const courses = await prisma.course.findMany({
    orderBy: { order: 'asc' },
    include: { sections: true }
  })

  if (courses.length < 2) return

  const bolum1 = courses[0]
  const bolum2 = courses[1]

  console.log(`[BÖLÜM 1] ${bolum1.name} -> Sadece flashcardlar sıfırlanıyor...`)
  await prisma.flashcard.deleteMany({ where: { courseId: bolum1.id } })
  console.log(`[BÖLÜM 1] Flashcardlar silindi.`)

  console.log(`[BÖLÜM 2] ${bolum2.name} -> Tamamen sıfırlanıyor...`)
  await prisma.section.deleteMany({ where: { courseId: bolum2.id } })
  await prisma.flashcard.deleteMany({ where: { courseId: bolum2.id } })
  await prisma.question.deleteMany({ where: { courseId: bolum2.id } })
  await prisma.course.update({
    where: { id: bolum2.id },
    data: { status: 'not_started', processedPages: 0 }
  })
  console.log(`[BÖLÜM 2] Tamamen sıfırlandı. UI'dan üretim başlatılabilir.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
