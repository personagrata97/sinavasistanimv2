import { prisma } from "./src/lib/prisma"

async function run() {
  console.log("🚀 [DATABASE CORRECTION] Starting merge and correction for Section 17...")

  const course = await prisma.course.findFirst({
    where: { slug: "bd-bilgi-sistemleri-guvenligi" }
  })

  if (!course) {
    console.error("Course not found!")
    return
  }

  // 1. Fetch Section 16 and 17
  const sec16 = await prisma.section.findFirst({
    where: { courseId: course.id, order: 16 }
  })
  const sec17 = await prisma.section.findFirst({
    where: { courseId: course.id, order: 17 }
  })

  if (!sec16 || !sec17) {
    console.error("Section 16 or Section 17 not found!")
    return
  }

  console.log(`Found Section 16: "${sec16.title}" (Pages ${sec16.pageStart} - ${sec16.pageEnd})`)
  console.log(`Found Section 17: "${sec17.title}" (Pages ${sec17.pageStart} - ${sec17.pageEnd})`)

  // 2. Append Section 17's raw content to Section 16 if not already present
  let newRawContent = sec16.rawContent
  if (!sec16.rawContent.includes(sec17.rawContent.trim())) {
    console.log("Appending Section 17's raw content to Section 16...")
    newRawContent = `${sec16.rawContent}\n\n--- ÜNİTE DEĞERLENDİRME SORULARI (Ek) ---\n${sec17.rawContent}`
  }

  // 3. Delete Section 17
  console.log(`Deleting Section 17 (ID: ${sec17.id}) from the database...`)
  await prisma.section.delete({
    where: { id: sec17.id }
  })

  // 4. Update Section 16's pageEnd to 112 and merge content
  console.log(`Updating Section 16 pageEnd to 112...`)
  await prisma.section.update({
    where: { id: sec16.id },
    data: {
      pageEnd: 112,
      rawContent: newRawContent,
      notes: null, // Reset notes so it regenerates organic notes including the test questions
      verificationScore: 0,
      processed: false
    }
  })

  // 5. Update Section 18's pageStart to 113
  const sec18 = await prisma.section.findFirst({
    where: { courseId: course.id, order: 18 }
  })
  if (sec18) {
    console.log(`Updating Section 18 ("${sec18.title}") pageStart to 113...`)
    await prisma.section.update({
      where: { id: sec18.id },
      data: {
        pageStart: 113,
        notes: null,
        verificationScore: 0,
        processed: false
      }
    })
  }

  // 6. Reorder all remaining sections sequentially
  const remainingSections = await prisma.section.findMany({
    where: { courseId: course.id },
    orderBy: { order: "asc" }
  })

  console.log(`\nReordering remaining ${remainingSections.length} sections sequentially...`)
  for (let i = 0; i < remainingSections.length; i++) {
    const sec = remainingSections[i]
    const newOrder = i + 1
    if (sec.order !== newOrder) {
      console.log(`  Updating order for "${sec.title}": ${sec.order} -> ${newOrder}`)
      await prisma.section.update({
        where: { id: sec.id },
        data: { order: newOrder }
      })
    }
  }

  console.log("\n✅ [DATABASE CORRECTION COMPLETED] New page ranges:")
  const finalSections = await prisma.section.findMany({
    where: { courseId: course.id },
    orderBy: { order: "asc" }
  })
  finalSections.forEach(s => {
    console.log(`- [Bölüm ${s.order}] ${s.title.padEnd(45)} | Sayfa ${s.pageStart} - ${s.pageEnd}`)
  })
}

run().catch(console.error).finally(() => prisma.$disconnect())
