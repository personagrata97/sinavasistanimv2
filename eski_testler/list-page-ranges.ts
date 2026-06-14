import { prisma } from "./src/lib/prisma"

async function run() {
  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" },
    include: {
      sections: {
        orderBy: { order: "asc" }
      }
    }
  })

  if (!course) {
    console.log("Course not found!")
    return
  }

  console.log(`Course: ${course.name} | Total Sections: ${course.sections.length}`)
  console.log("--------------------------------------------------------------------------------")
  console.log("Order | Title | PDF Page Range (Start - End) | Page Count")
  console.log("--------------------------------------------------------------------------------")
  course.sections.forEach(sec => {
    const pageCount = sec.pageEnd && sec.pageStart ? (sec.pageEnd - sec.pageStart + 1) : 0
    console.log(`${sec.order.toString().padEnd(5)} | ${sec.title.substring(0, 40).padEnd(40)} | Pages ${sec.pageStart} - ${sec.pageEnd} | ${pageCount} pages`)
  })
}

run().catch(console.error).finally(() => prisma.$disconnect())
