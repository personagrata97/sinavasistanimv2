import { PrismaClient } from '@prisma/client'
import { ABBREVIATIONS_DICT } from './src/lib/abbreviations'

const prisma = new PrismaClient()

async function main() {
  await prisma.course.update({
    where: { slug: 'bd-bilgi-sistemleri-guvenligi' },
    data: {
      glossary: JSON.stringify(ABBREVIATIONS_DICT)
    }
  })
  console.log("Glossary updated successfully!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
