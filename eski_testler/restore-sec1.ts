import { prisma as livePrisma } from "./src/lib/prisma"
import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import * as path from "path"

async function run() {
  console.log("Reading backup database dev_25mayısakşam2358.db...")
  
  const backupDbPath = path.resolve(process.cwd(), "dev_25mayısakşam2358.db")
  const backupDbUrl = `file:${backupDbPath}`
  const backupAdapter = new PrismaBetterSqlite3({ url: backupDbUrl })
  const backupPrisma = new PrismaClient({ adapter: backupAdapter })

  try {
    const course = await backupPrisma.course.findFirst({
      where: { slug: "bd-bilgi-sistemleri-guvenligi" }
    })
    
    if (!course) {
      console.error("Course not found in backup!")
      return
    }

    const backupSec = await backupPrisma.section.findFirst({
      where: { courseId: course.id, order: 1 }
    })

    if (!backupSec || !backupSec.notes) {
      console.error("Section 1 notes not found in backup!")
      return
    }

    console.log(`Found backup Section 1 notes (${backupSec.notes.length} chars).`)

    // Restore to live database
    const liveCourse = await livePrisma.course.findFirst({
      where: { slug: "bd-bilgi-sistemleri-guvenligi" }
    })

    if (!liveCourse) {
      console.error("Live course not found!")
      return
    }

    const liveSec = await livePrisma.section.findFirst({
      where: { courseId: liveCourse.id, order: 1 }
    })

    if (!liveSec) {
      console.error("Live Section 1 not found!")
      return
    }

    await livePrisma.section.update({
      where: { id: liveSec.id },
      data: {
        notes: backupSec.notes,
        verificationScore: backupSec.verificationScore,
        verificationIssues: backupSec.verificationIssues,
        processed: backupSec.processed
      }
    })

    console.log("✅ Successfully restored Section 1 notes, score, and issues from backup to live database!")
  } catch (err) {
    console.error("Error during restore:", err)
  } finally {
    await backupPrisma.$disconnect()
    await livePrisma.$disconnect()
  }
}

run().catch(console.error)
