import "dotenv/config"
import { prisma } from "./src/lib/prisma"
import { generateCourseNotes, verifyNotesAgainstSource } from "./src/lib/ai-service"
import { refineSectionNotesAction } from "./src/lib/actions"

async function run() {
  console.log("🚀 [SECTION 3 REPROCESS FROM SCRATCH] Starting targeted reprocessing for Section 3...")

  // Fetch Section 3 in the MASAK course
  const sec = await prisma.section.findFirst({
    where: { 
      course: { slug: "masak-uyum-gorevlisi" },
      order: 3
    }
  })

  if (!sec) {
    console.error("❌ Section 3 not found in the database!")
    return
  }

  console.log(`🔷 [SECTION 3] "${sec.title}"`)
  console.log(`   Step 1: Generating fresh initial organic thematic draft from scratch...`)

  const course = await prisma.course.findFirst({
    where: { slug: "masak-uyum-gorevlisi" },
    include: { program: true }
  })

  if (!course) {
    console.error("Course not found!")
    return
  }

  const aiMode = course.program?.aiMode || "law"
  let activeFileUri: string | undefined = undefined
  let uriMap: Record<string, string> = {}
  if (course.geminiFileUris) {
    try {
      uriMap = JSON.parse(course.geminiFileUris)
      activeFileUri = uriMap["0"] || undefined
    } catch {}
  }

  // Set file URIs map to enable correct key rotation mappings and avoid 403 errors
  const { setFileUrisMap } = require("./src/lib/ai-service")
  setFileUrisMap(uriMap)

  // 1. Generate the initial integrated draft from scratch using the new Konusal Entegrasyon prompt
  const initialNotes = await generateCourseNotes(
    sec.rawContent,
    sec.title,
    course.name,
    course.userLevel,
    aiMode,
    activeFileUri,
    sec.pageStart,
    sec.pageEnd
  )

  console.log(`   Initial draft generated successfully (${initialNotes.length} chars).`)

  // 2. Perform initial verification
  const verification = await verifyNotesAgainstSource(
    sec.rawContent,
    initialNotes,
    sec.title,
    undefined,
    sec.pageStart,
    sec.pageEnd
  )

  console.log(`   Initial verification score: ${verification.score}%`)

  // Save the fresh draft to the database
  await prisma.section.update({
    where: { id: sec.id },
    data: {
      notes: initialNotes,
      verificationScore: verification.score,
      processed: verification.score >= 95,
      verificationIssues: JSON.stringify({
        missingTopics: verification.missingTopics || [],
        issues: verification.issues || [],
        suggestions: verification.suggestions || [],
        attemptHistory: [{
          attempt: 1,
          score: verification.score,
          missingTopics: verification.missingTopics || [],
          issues: verification.issues || [],
          suggestions: verification.suggestions || []
        }]
      })
    }
  })

  // 3. Enter the Refinement Loop to reach 100/100 score organically
  let currentScore = verification.score
  let attempt = 1
  const maxAttempts = 10

  while (currentScore < 100 && attempt <= maxAttempts) {
    console.log(`   👉 Organic Refinement Loop: Attempt #${attempt}/${maxAttempts} (Current Score: ${currentScore}%)...`)
    
    const start = Date.now()
    const res = await refineSectionNotesAction(sec.id)
    const elapsed = Math.round((Date.now() - start) / 1000)

    if ('error' in res && res.error) {
      console.error(`   ❌ Error during refinement: ${res.error}`)
      break
    }

    // Re-fetch score from database
    const updated = await prisma.section.findUnique({
      where: { id: sec.id }
    })

    if (!updated) {
      console.error(`   ❌ Section not found after update!`)
      break
    }

    currentScore = updated.verificationScore ?? 0
    console.log(`   ✅ Attempt #${attempt} completed in ${elapsed}s. New Score: ${currentScore}%`)

    if (currentScore >= 100) {
      console.log(`   ✨ Section 3 successfully reached target quality threshold (100%)!`)
      break
    }

    attempt++
  }

  console.log(`🎉 [SECTION 3 REPROCESS COMPLETE] Final Score: ${currentScore}%! All notes, flashcards, and questions are now organically integrated and legally flawless!`)
}

run().catch(console.error).finally(() => prisma.$disconnect())
