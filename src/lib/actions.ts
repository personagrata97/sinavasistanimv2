"use server"

import { unstable_noStore as noStore } from "next/cache"
import { prisma } from "./prisma"
import { SPL_LEVEL_3_COURSES, MASAK_COURSES, SPL_BD_COURSES, CIA_COURSES, CISA_COURSES, SMMM_COURSES, ZELIHA_COURSES, ALL_COURSES, getExamConfig } from "./course-data"
import { ensureProgramsSeeded } from "./course-seed"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { answerSchema, reviewSchema } from "@/lib/validations"
import { recalibrateStudyPlan, checkAndInjectMockExams } from "./dynamic-engine"
import { filterProgramsForUser, parseAllowedProgramSlugs, type ProgramAccessContext } from "./program-access"
import { courseHasUploadedPdf } from "./course-upload-meta"
import { getStudyNotFoundMessage, getApprovedNotesNotFoundMessage } from "./program-catalog"
import { cancelCourseProcessing, clearCancelSignal, clearHeartbeat } from "./process-registry"
import { clearProcessTriggerDebounce } from "./course-processing-status"

async function getSession() {
  return await getServerSession(authOptions)
}

// Admin yetkilendirmesi: Sadece admin rolündeki kullanıcılar kritik işlemleri yapabilir
async function requireAdmin() {
  if (process.env.CLI_MODE === "true") {
    return { authorized: true, userId: "cli-admin" }
  }
  const session = await getSession()
  if (!session?.user?.id) return { error: "Oturum açmadınız", authorized: false }
  
  if ((session.user as any).role === "admin") {
    return { authorized: true, userId: session.user.id }
  }
  
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (!user || user.role !== "admin") return { error: "Bu işlem için admin yetkisi gereklidir", authorized: false }
  return { authorized: true, userId: session.user.id }
}

// ==================== COURSE ACTIONS ====================

export async function initializeCourses() {
  await ensureProgramsSeeded()
}

export async function updateUserStreak() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: session.user.email }
  })
  if (!user) return null

  // E-16: Timezone-safe gün hesaplaması — sadece tarih kısmını karşılaştır
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0] // "2026-05-27"
  const lastActiveStr = user.lastActiveAt.toISOString().split('T')[0]
  
  const today = new Date(todayStr + 'T00:00:00Z')
  const lastActive = new Date(lastActiveStr + 'T00:00:00Z')
  const diffDays = Math.round((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24))

  let newStreak = user.currentStreak

  if (diffDays === 1) {
    newStreak += 1
  } else if (diffDays > 1) {
    newStreak = 1
  } else if (diffDays === 0 && user.currentStreak === 0) {
    newStreak = 1
  }
  // diffDays === 0 ve streak > 0 ise bugün zaten girilmiş, streak değişmez

  await prisma.user.update({
    where: { id: user.id },
    data: {
      currentStreak: newStreak,
      longestStreak: Math.max(user.longestStreak, newStreak),
      lastActiveAt: now
    }
  })

  return newStreak
}

export async function getUserStats() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { currentStreak: true, lastActiveAt: true, onboardingCompleted: true, targetExamDate: true, targetHours: true, _count: { select: { mockResults: true, questionAnswers: true } } }
  })
  return user
}

export async function getUserProgramAccess(): Promise<ProgramAccessContext> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { role: "student", allowedProgramSlugs: null }
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, allowedProgramSlugs: true },
  })
  return {
    role: user?.role ?? (session.user as { role?: string }).role ?? "student",
    allowedProgramSlugs: parseAllowedProgramSlugs(user?.allowedProgramSlugs),
  }
}

export async function getAccessibleProgramSlugs(): Promise<string[]> {
  const ctx = await getUserProgramAccess()
  return filterProgramsForUser(ctx).map(p => p.slug)
}

export async function getPrograms() {
  try {
    await initializeCourses()
    const ctx = await getUserProgramAccess()
    const allowedSlugs = new Set(filterProgramsForUser(ctx).map(p => p.slug))
    const all = await prisma.program.findMany({ orderBy: { createdAt: "asc" } })
    return all.filter(p => allowedSlugs.has(p.slug))
  } catch (error) {
    console.error("Failed to fetch programs:", error)
    return []
  }
}

export async function getAllCourses() {
  try {
    // Streak'i arka planda güncelle (hata fırlatsa da süreci bölmemesi için)
    updateUserStreak().catch(() => {})

    await initializeCourses()

    const courses = await prisma.course.findMany({
      orderBy: { order: "asc" },
      include: {
        _count: {
          select: {
            sections: true,
            flashcards: true,
            questions: true,
          }
        }
      }
    })

    return courses.map(c => {
      const staticInfo = ALL_COURSES.find(s => s.slug === c.slug)
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        order: c.order,
        description: c.description || staticInfo?.description || "",
        icon: staticInfo?.icon || "📚",
        color: staticInfo?.color || "from-blue-600 to-indigo-700",
        estimatedPages: staticInfo?.estimatedPages || "150-300",
        examDate: c.examDate,
        userLevel: c.userLevel,
        totalPages: c.totalPages,
        processedPages: c.processedPages,
        status: c.status,
        sectionCount: c._count.sections,
        flashcardCount: c._count.flashcards,
        questionCount: c._count.questions,
      }
    })
  } catch (error) {
    console.error("Failed to fetch courses:", error)
    return []
  }
}

export async function getCourseBySlug(slug: string) {
  noStore()
  try {
    await initializeCourses()

    const course = await prisma.course.findUnique({
      where: { slug },
      include: {
        program: true,
        sections: { orderBy: { order: "asc" } },
        _count: {
          select: {
            flashcards: true,
            questions: true,
          }
        }
      }
    })

    if (!course) return null

    const staticInfo = ALL_COURSES.find(s => s.slug === slug)

    let correctedStatus = course.status
    const hasPdf = courseHasUploadedPdf(course)
    if (
      course.status === "ready" &&
      course._count.questions === 0 &&
      course._count.flashcards === 0
    ) {
      correctedStatus = hasPdf ? "uploaded" : "not_started"
      if (correctedStatus !== course.status) {
        await prisma.course.update({
          where: { slug },
          data: { status: correctedStatus },
        })
      }
    }

    return {
      ...course,
      status: correctedStatus,
      totalPages: course.totalPages,
      pdfPath: course.pdfPath,
      icon: staticInfo?.icon || "📚",
      color: staticInfo?.color || "from-blue-600 to-indigo-700",
      estimatedPages: staticInfo?.estimatedPages || "150-300",
    }
  } catch (error) {
    console.error("Failed to fetch course:", error)
    return null
  }
}

export async function updateExamDate(slug: string, examDate: string | null) {
  try {
    await prisma.course.update({
      where: { slug },
      data: { examDate: examDate ? new Date(examDate) : null }
    })
    return { success: true }
  } catch (error: any) {
    return { error: error.message }
  }
}

// ==================== REPROCESS COURSE ====================

export async function reprocessCourse(slug: string) {
  try {
    // E-13: Admin yetkilendirmesi
    const auth = await requireAdmin()
    if (!auth.authorized) return { error: auth.error }

    const course = await prisma.course.findUnique({
      where: { slug },
      include: { program: { select: { slug: true } } },
    })
    if (!course) {
      return { error: getStudyNotFoundMessage(slug.startsWith("zeliha-") ? "zeliha-mevzuat" : "") }
    }
    if (!course.pdfPath) return { error: "PDF yüklenmemiş" }

    await prisma.flashcard.deleteMany({ where: { courseId: course.id } })
    await prisma.question.deleteMany({ where: { courseId: course.id } })
    await prisma.section.deleteMany({ where: { courseId: course.id } })

    await prisma.course.update({
      where: { slug },
      data: {
        status: "uploaded",
        processedPages: 0,
        updatedAt: new Date(),
      },
    })

    // Eski işçiyi durdur; debounce/heartbeat temizle — sıfırdan tetikleme engellenmesin
    cancelCourseProcessing(slug, course.name)
    clearCancelSignal(slug, course.name)
    clearHeartbeat(slug)
    await clearProcessTriggerDebounce(slug)

    return { success: true }
  } catch (error: any) {
    return { error: error.message }
  }
}

export async function cancelCourseProcess(slug: string) {
  try {
    const auth = await requireAdmin()
    if (!auth.authorized) return { error: auth.error }

    const course = await prisma.course.findUnique({
      where: { slug }
    })
    if (!course) return { error: "Course not found" }

    cancelCourseProcessing(slug, course.name)
    
    // Anında UI'ın tepki vermesi için status'u error'a çekiyoruz.
    // İşçi durduğunda zaten en son kaldığı section processed=false olarak bekleyecek.
    await prisma.course.update({
      where: { slug },
      data: { status: "error" }
    })

    return { success: true }
  } catch (error: any) {
    return { error: error.message }
  }
}

// ==================== SECTION ACTIONS ====================

export async function getCourseSections(slug: string) {
  try {
    const course = await prisma.course.findUnique({
      where: { slug },
      include: {
        sections: { orderBy: { order: "asc" } }
      }
    })
    return course?.sections || []
  } catch (error) {
    console.error("Failed to fetch sections:", error)
    return []
  }
}

export async function refineSectionNotesAction(sectionId: string) {
  try {
    // E-13: Admin yetkilendirmesi
    const auth = await requireAdmin()
    if (!auth.authorized) return { error: auth.error }
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { course: { include: { program: true } } }
    })
    if (!section) return { error: "Bölüm bulunamadı" }

    const course = section.course
    const aiMode = course.program?.aiMode || "general"
    const programSlug = course.program?.slug || "spl-duzey-3"
    const sourceMode = getExamConfig(programSlug)?.sourceMode ?? "strict"

    // Her key'in kendi fileUri'sini ayarla — merkezi helper ile (DRY)
    const { ensureGeminiFileUris } = await import("./gemini-file-helper")
    const { uriMap, updated: updatedUris } = await ensureGeminiFileUris(
      course.pdfPath || "", 
      course.geminiFileUris, 
      course.slug
    )

    if (updatedUris) {
      await prisma.course.update({
        where: { id: course.id },
        data: {
          geminiFileUri: uriMap["0"] || course.geminiFileUri,
          geminiFileUris: JSON.stringify(uriMap)
        }
      })
      console.log(`[REFINEMENT] 💾 Yeni fileUri'ler veri tabanına başarıyla kaydedildi.`)
    }

    const { setFileUrisMap } = await import("./ai-service")
    setFileUrisMap(uriMap)

    // Parse issues
    let issuesObj: any = {}
    try {
      issuesObj = JSON.parse(section.verificationIssues || "{}")
    } catch {}

    const missingTopics = issuesObj.missingTopics || []
    const validationIssues = issuesObj.issues || []
    const suggestions = issuesObj.suggestions || []
    const attemptHistory = issuesObj.attemptHistory || []
    if (attemptHistory.length === 0 && section.verificationScore !== null) {
      attemptHistory.push({
        attempt: 0,
        score: section.verificationScore,
        missingTopics: [...missingTopics],
        issues: [...validationIssues]
      })
    }
    const isPerfect = section.verificationScore === 100

    if (missingTopics.length === 0 && validationIssues.length === 0 && suggestions.length === 0 && isPerfect) {
      return { success: true, message: "Eksik konu veya iyileştirilmesi gereken nokta bulunamadı." }
    }

    // Construct enriched content
    let enrichedContent = section.rawContent
    const allExs = [...missingTopics, ...validationIssues, ...suggestions]
    if (allExs.length > 0) {
      const missingList = allExs.join("\n- ")
      enrichedContent = `⚠️⚠️⚠️ ÖNCEKİ DENEMEDE ATLANAN/HATALI OLAN VEYA İYİLEŞTİRİLMESİ ÖNERİLEN KONULAR:\n- ${missingList}\n\n⚠️ KESİN KURAL: Aşağıda sana bir önceki adımda başarıyla üretilmiş olan mevcut ders notlarını (PREVIOUS STUDY NOTES) ve orijinal kaynak metni (RAW SOURCE CONTENT) veriyorum.\n\nBir önceki adımda üretilmiş notlardaki hiçbir başlığı, tabloyu, senaryoyu, terimi veya bilgiyi KESİNLİKLE SİLME VE DEĞİŞTİRME. Sadece yukarıda belirtilen eksik veya hatalı konuları, mevcut ders notunun ilgili paragraflarının/bölümlerinin içine doğal ve derin bir akışla yerleştirerek notu zenginleştir. Tam bir bütün oluştur, sonuna yama gibi ekleme!\n\n---\n\n[PREVIOUS STUDY NOTES]\n${section.notes || ""}\n\n---\n\n[RAW SOURCE CONTENT]\n${section.rawContent}`
    }

    // Import dynamic dependencies
    const { generateCourseNotes, verifyNotesAgainstSource } = await import("./ai-service")

    // 🚨 GÖRSEL BYPASS KALDIRILDI: Kullanıcı kararı doğrultusunda PDF varsa KESİNLİKLE Multimodal (Vision) kullanılır.
    // Metinde "resim, şema" kelimeleri geçmese bile gizli görseller olabileceği için bu risk artık alınmıyor.
    const activeFileUri = course.geminiFileUri || undefined;

    const fullCourseName = `${course.program?.name || ""} > ${course.name}`.replace(/^ \> /, "");
    const staticMeta = ALL_COURSES.find((c) => c.slug === course.slug)
    const { getDocumentNoteInstructions, getDocumentProcessingProfile } = await import(
      "./document-processing-profile"
    )
    const documentProfile = getDocumentProcessingProfile({
      slug: course.slug,
      name: course.name,
      sourceKind: staticMeta?.sourceKind,
      sourceKindLabel: staticMeta?.sourceKindLabel,
      gridGroup: staticMeta?.gridGroup,
      programSlug,
      aiMode,
      totalPages: course.totalPages ?? 0,
    })
    const notes = await generateCourseNotes(
      enrichedContent, section.title, fullCourseName, course.userLevel,
      aiMode, section.pageStart, section.pageEnd,
      false, 0, 1, undefined, sourceMode,
      getDocumentNoteInstructions(documentProfile),
      documentProfile.documentType,
    )

    // Verify notes - KÖKLÜ VE TUTARLI ÇÖZÜM: Sayfa çakışmalarını ve mükerrerlikleri tamamen engellemek için,
    // not doğrulama aşamasında PDF dosyasını (fileUri) pas geçerek SADECE veritabanındaki izole rawContent kullanılır!
    const verification = await verifyNotesAgainstSource(
      section.rawContent, notes, section.title, fullCourseName, sourceMode,
      documentProfile.documentType,
    )

    // Save back to DB
    const nextAttempt = attemptHistory.filter((h: any) => h.attempt > 0).length + 1
    attemptHistory.push({
      attempt: nextAttempt,
      score: verification.score,
      missingTopics: verification.missingTopics || [],
      issues: verification.issues || [],
      suggestions: verification.suggestions || []
    })

    const updatedSection = await prisma.section.update({
      where: { id: sectionId },
      data: {
        notes: verification.score === 100 ? notes : null,
        verificationScore: verification.score,
        processed: verification.score === 100,
        verificationIssues: JSON.stringify({
          missingTopics: verification.missingTopics || [],
          issues: verification.issues || [],
          suggestions: verification.suggestions || [],
          attemptHistory: attemptHistory
        })
      }
    })

    // 🔒 CANLIYA ÇIKIŞ KİLİDİ (Madde 1): Not %100 onaylanmadıysa soru/flashcard üretilmez.
    if (verification.score !== 100) {
      return {
        success: false,
        score: verification.score,
        message: `Not %${verification.score} aldı. Yalnızca %100 onaylı notlardan soru/flashcard üretilir. Lütfen tekrar deneyin.`,
        missingTopics: verification.missingTopics || [],
        issues: verification.issues || [],
      }
    }

    // Regenerate flashcards and questions from approved notes (main pipeline ile aynı kaynak)
    try {
      const { generateFlashcards, generateQuestions, validateFlashcardsWithSolver, validateQuestionsWithSolver } = await import("./ai-service")
      
      const finalContent = notes

      // Recreate flashcards
      let flashcards = await generateFlashcards(
        finalContent, section.title, fullCourseName, course.userLevel,
        aiMode, undefined, section.pageStart, section.pageEnd
      )
      flashcards = await validateFlashcardsWithSolver(finalContent, flashcards)

      // Recreate questions
      let questions = await generateQuestions(
        finalContent, section.title, fullCourseName, course.userLevel,
        aiMode, undefined, section.pageStart, section.pageEnd, section.importance || undefined
      )
      questions = await validateQuestionsWithSolver(finalContent, questions)

      // Save new flashcards if successfully generated using a diff approach to prevent wipping UserFlashcardProgress
      if (flashcards && flashcards.length > 0) {
        const existingCards = await prisma.flashcard.findMany({ where: { sectionId } })
        const existingMap = new Map(existingCards.map(c => [c.front.trim().toLowerCase(), c]))
        const newFronts = new Set(flashcards.map(c => c.front.trim().toLowerCase()))

        // Delete cards no longer in the new set
        for (const card of existingCards) {
          if (!newFronts.has(card.front.trim().toLowerCase())) {
            try {
              await prisma.flashcard.delete({ where: { id: card.id } })
            } catch {}
          }
        }

        // Create new or update existing
        for (const card of flashcards) {
          const frontLower = card.front.trim().toLowerCase()
          const match = existingMap.get(frontLower)
          if (match) {
            try {
              await prisma.flashcard.update({
                where: { id: match.id },
                data: {
                  back: card.back,
                  difficulty: card.difficulty || "medium"
                }
              })
            } catch {}
          } else {
            try {
              await prisma.flashcard.create({
                data: {
                  courseId: course.id,
                  sectionId: section.id,
                  front: card.front,
                  back: card.back,
                  difficulty: card.difficulty || "medium"
                }
              })
            } catch {}
          }
        }
      }

      // Save new questions if successfully generated using a diff approach to prevent wipping UserQuestionAnswer
      if (questions && questions.length > 0) {
        const existingQuestions = await prisma.question.findMany({ where: { sectionId } })
        const existingMap = new Map(existingQuestions.map(q => [q.text.trim().toLowerCase(), q]))
        const newTexts = new Set(questions.map(q => q.text.trim().toLowerCase()))

        // Delete questions no longer in the new set
        for (const q of existingQuestions) {
          if (!newTexts.has(q.text.trim().toLowerCase())) {
            try {
              await prisma.question.delete({ where: { id: q.id } })
            } catch {}
          }
        }

        // Create new or update existing
        for (const q of questions) {
          const textLower = q.text.trim().toLowerCase()
          const match = existingMap.get(textLower)
          if (match) {
            try {
              await prisma.question.update({
                where: { id: match.id },
                data: {
                  options: JSON.stringify(q.options),
                  correct: q.correct,
                  explanation: q.explanation,
                  difficulty: q.difficulty || "medium",
                  module: section.module
                }
              })
            } catch {}
          } else {
            try {
              await prisma.question.create({
                data: {
                  courseId: course.id,
                  sectionId: section.id,
                  text: q.text,
                  options: JSON.stringify(q.options),
                  correct: q.correct,
                  explanation: q.explanation,
                  difficulty: q.difficulty || "medium",
                  module: section.module
                }
              })
            } catch {}
          }
        }
      }
      console.log(`[REFINE_ACTION] ✅ Re-generated ${flashcards.length} flashcards and ${questions.length} questions.`)
    } catch (regenErr: any) {
      console.error("[REFINE_ACTION] ⚠️ Flashcard/Question regeneration failed:", regenErr.message)
    }

    return { success: true, section: updatedSection }
  } catch (error: any) {
    console.error("[REFINE_SECTION_NOTES_ACTION]", error)
    return { error: error.message }
  }
}

// ==================== FLASHCARD ACTIONS ====================

export async function getCourseFlashcards(slug: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []
    const userId = session.user.id

    const course = await prisma.course.findUnique({ where: { slug } })
    if (!course) return []

    // Fetch all flashcards for this course
    const flashcards = await prisma.flashcard.findMany({
      where: { courseId: course.id },
      include: { section: true },
    })

    // Fetch user progress for these flashcards
    const userProgress = await prisma.userFlashcardProgress.findMany({
      where: { userId, flashcardId: { in: flashcards.map(f => f.id) } }
    })

    const progressMap = new Map(userProgress.map(up => [up.flashcardId, up]))

    const cardsWithProgress = flashcards.map(c => {
      const p = progressMap.get(c.id)
      return {
        id: c.id,
        front: c.front,
        back: c.back,
        difficulty: c.difficulty,
        section: c.section,
        mastered: p?.mastered || false,
        nextReview: p?.nextReview.toISOString() || new Date().toISOString(),
        interval: p?.interval || 1,
        easeFactor: p?.easeFactor || 2.5,
        reviewCount: p?.reviewCount || 0,
      }
    })

    // Sort by nextReview
    return cardsWithProgress.sort((a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime())
  } catch (error) {
    console.error("Failed to fetch flashcards:", error)
    return []
  }
}

export async function reviewFlashcard(id: string, quality: number) {
  try {
    const validation = reviewSchema.safeParse({ flashcardId: id, quality })
    if (!validation.success) {
      return { error: validation.error.issues.map(i => i.message).join(", ") }
    }

    const session = await getSession()
    if (!session?.user?.id) return { error: "Oturum açmadınız" }
    const userId = session.user.id

    const card = await prisma.flashcard.findUnique({ where: { id } })
    if (!card) return { error: "Card not found" }

    // Get current progress or default values
    const up = await prisma.userFlashcardProgress.findUnique({
      where: { userId_flashcardId: { userId, flashcardId: id } }
    })

    let interval = up?.interval || 1
    let easeFactor = up?.easeFactor || 2.5
    let reviewCount = up?.reviewCount || 0
    
    if (quality < 2) {
      interval = 1
    } else {
      if (reviewCount === 0) {
        interval = 1
      } else if (reviewCount === 1) {
        interval = 3
      } else {
        interval = Math.round(interval * easeFactor)
      }
    }

    easeFactor = Math.max(1.3, easeFactor + (0.1 - (4 - quality) * (0.08 + (4 - quality) * 0.02)))

    const nextReview = new Date()
    nextReview.setDate(nextReview.getDate() + interval)

    await prisma.userFlashcardProgress.upsert({
      where: { userId_flashcardId: { userId, flashcardId: id } },
      create: {
        userId,
        flashcardId: id,
        interval,
        easeFactor,
        reviewCount: 1,
        nextReview,
        mastered: quality >= 3 && reviewCount >= 1, // review count is technically 1 now
      },
      update: {
        interval,
        easeFactor,
        reviewCount: reviewCount + 1,
        nextReview,
        mastered: quality >= 3 && reviewCount >= 2,
      }
    })

    // E-22: Flashcard review'i leaderboard'a yansıt ve Dinamik Motoru Tetikle
    Promise.all([
      updateLeaderboard(userId, { flashcardsReviewed: 1 }),
      recalibrateStudyPlan(userId, card.courseId),
      checkAndInjectMockExams(userId, card.courseId)
    ]).catch(err => console.error("Flashcard background logic error:", err))

    return { success: true, nextReview: nextReview.toISOString(), interval }
  } catch (error: any) {
    return { error: error.message }
  }
}

// ==================== QUESTION ACTIONS ====================

export async function getCourseQuestions(slug: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []
    const userId = session.user.id

    const course = await prisma.course.findUnique({ where: { slug } })
    if (!course) return []

    const questions = await prisma.question.findMany({
      where: { courseId: course.id },
      orderBy: { createdAt: "desc" },
      include: { section: { select: { title: true, notes: true, module: true, rawContent: true } } },
    })

    const userAnswers = await prisma.userQuestionAnswer.findMany({
      where: { userId, questionId: { in: questions.map(q => q.id) } }
    })

    const answerMap = new Map(userAnswers.map(a => [a.questionId, a]))

    return questions.map(q => {
      let options: string[] = []
      try {
        if (Array.isArray(q.options)) {
          options = q.options
        } else if (typeof q.options === "string") {
          options = JSON.parse(q.options)
        }
      } catch (e) {
        console.error("Option parse error for question:", q.id, e)
        options = ["Seçenekler yüklenemedi"]
      }

      const uq = answerMap.get(q.id)

      return {
        id: q.id,
        courseId: q.courseId,
        text: q.text,
        options,
        correct: q.correct,
        explanation: q.explanation || "Açıklama mevcut değil.",
        difficulty: q.difficulty,
        section: q.section,
        answered: !!uq,
        userAnswer: uq?.userAnswer || null,
        isCorrect: uq?.isCorrect || false,
      }
    })
  } catch (error) {
    console.error("Failed to fetch questions:", error)
    return []
  }
}

export async function answerQuestion(id: string, answer: string) {
  try {
    const validation = answerSchema.safeParse({ questionId: id, answer })
    if (!validation.success) {
      return { error: validation.error.issues.map(i => i.message).join(", ") }
    }

    const session = await getSession()
    if (!session?.user?.id) return { error: "Oturum açmadınız" }
    const userId = session.user.id

    // Check if user exists to prevent foreign key violation
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return { error: "Kullanıcı hesabınız bulunamadı (oturum süresi dolmuş veya hesap silinmiş olabilir). Lütfen çıkış yapıp tekrar giriş yapın." }
    }

    const question = await prisma.question.findUnique({ where: { id } })
    if (!question) return { error: "Question not found" }

    const isCorrect = question.correct === answer

    await prisma.userQuestionAnswer.upsert({
      where: { userId_questionId: { userId, questionId: id } },
      create: { userId, questionId: id, isCorrect, userAnswer: answer, attemptCount: 1 },
      update: { isCorrect, userAnswer: answer, attemptCount: { increment: 1 } },
    })

    // --- Gamification Tetikleyicileri ---
    if (isCorrect) {
      await logActivityXP(userId, "question_answered", 1) // 1 soru * 2 = 2 XP
    }
    
    // Asenkron olarak başarımları, leaderboard'u güncelle ve Dinamik Adaptasyon Motorunu çalıştır
    Promise.all([
      checkAndAwardAchievements(userId),
      updateLeaderboard(userId, {
        questionsAnswered: 1,
        correctAnswers: isCorrect ? 1 : 0,
        xpEarned: isCorrect ? 2 : 0
      }),
      recalibrateStudyPlan(userId, question.courseId),
      checkAndInjectMockExams(userId, question.courseId)
    ]).catch(err => console.error("Gamification/engine background error:", err))

    return {
      success: true,
      correct: isCorrect,
      correctAnswer: question.correct,
      explanation: question.explanation,
    }
  } catch (error: any) {
    return { error: error.message }
  }
}

// ==================== HATALI SORU BİLDİR ====================

export async function reportQuestion(id: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { error: "Oturum açmadınız" }

    const question = await prisma.question.findUnique({ where: { id } })
    if (!question) return { error: "Soru bulunamadı" }

    await prisma.question.update({
      where: { id },
      data: { reported: true }
    })

    return { success: true }
  } catch (error: any) {
    return { error: error.message }
  }
}

export async function resolveQuestion(id: string) {
  try {
    const session = await getSession()
    if (!session?.user || (session.user as any).role !== "admin") {
      return { error: "Yetkiniz yok" }
    }

    await prisma.question.update({
      where: { id },
      data: { reported: false }
    })

    return { success: true }
  } catch (error: any) {
    return { error: error.message }
  }
}

function toTitleCase(str: string): string {
  let lower = str.toLocaleLowerCase('tr-TR');
  let title = lower.replace(/(?:^|[\s\[\(\-])([a-zçğıöşü])/g, (match) => match.toLocaleUpperCase('tr-TR'));
  const conjunctions = ['ve', 'ile', 'veya', 'de', 'da', 'ki'];
  conjunctions.forEach(c => {
     title = title.replace(new RegExp(`\\s${c}\\s`, 'gi'), ` ${c} `);
  });
  const acronyms = ["MASAK", "CMK", "SPK", "AB", "BDDK", "TCMB", "MKK", "AŞ", "PDF", "KVHS", "SPL", "ŞİB", "FATF"];
  acronyms.forEach(ac => {
     const lowerAc = ac.toLocaleLowerCase("tr-TR");
     const titleAc = lowerAc.replace(/^[a-zçğıöşü]/g, m => m.toLocaleUpperCase("tr-TR"));
     
     const escapedLower = lowerAc.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
     const escapedTitle = titleAc.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
     const escapedAc = ac.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
     
     title = title.replace(new RegExp(`(^|[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ])(${escapedLower}|${escapedTitle}|${escapedAc})([^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]|$)`, 'g'), `$1${ac}$3`);
  });
  return title;
}

// ==================== DAILY GOALS ====================

export async function getDailyGoals(slug: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []
    const userId = session.user.id

    const course = await prisma.course.findUnique({
      where: { slug },
      include: {
        sections: { orderBy: { order: "asc" } },
      }
    })
    
    if (!course) return []

    const goals = []
    
    // 1. Spaced Repetition Flashcards Goal
    const dueFlashcards = await prisma.userFlashcardProgress.count({
      where: {
        userId,
        flashcard: { courseId: course.id },
        nextReview: { lte: new Date() },
        mastered: false
      }
    })

    // Toplam flashcard sayısını kontrol et
    const totalFlashcards = await prisma.flashcard.count({
      where: { courseId: course.id }
    })

    if (totalFlashcards > 0) {
      if (dueFlashcards > 0) {
        goals.push({
          id: "daily_flashcards",
          title: "Tekrar Zamanı",
          desc: `Öğrenme eğrisini kırmak için ${dueFlashcards} adet kartı tekrar etmen gerekiyor.`,
          type: "flashcards",
          count: dueFlashcards,
          completed: false
        })
      } else {
        goals.push({
          id: "daily_flashcards_done",
          title: "Tekrarlar Tamam",
          desc: "Bugün için tüm aralıklı tekrarlarını bitirdin. Harika!",
          type: "flashcards",
          count: 0,
          completed: true
        })
      }
    }

    // 2. Reading Goal (Find first unread/unanswered section)
    const answeredQuestions = await prisma.userQuestionAnswer.findMany({
      where: { userId, question: { courseId: course.id } },
      select: { question: { select: { sectionId: true } } }
    })
    const touchedSectionIds = new Set(answeredQuestions.map(a => a.question.sectionId))
    
    const nextSection = course.sections.find(s => !touchedSectionIds.has(s.id))
    
    if (nextSection) {
      const sectionIndex = course.sections.findIndex(s => s.id === nextSection.id);
      const cleanTitle = nextSection.title.replace(/\s*\(Bölüm\s+\d+\/\d+\)\s*$/i, "");
      const formattedTitle = toTitleCase(cleanTitle);
      goals.push({
        id: "daily_reading",
        title: "Yeni Konu Öğrenimi",
        desc: `"Kısım ${sectionIndex + 1}: ${formattedTitle}" ders notlarını oku ve sorularını çöz.`,
        type: "reading",
        sectionId: nextSection.id,
        completed: false
      })
    } else if (course.sections.length > 0) {
      goals.push({
        id: "daily_exam",
        title: "Deneme Sınavı Pratiği",
        desc: "Tüm konuları tamamladın. Artık bol bol deneme sınavı çözerek hızlanmalısın.",
        type: "mock_exam",
        completed: false
      })
    }

    return goals

  } catch (error) {
    console.error("Failed to generate daily goals:", error)
    return []
  }
}


// ==================== EXAM RESULTS ====================

export async function saveMockExamResult(courseId: string, result: {
  score: number;
  correct: number;
  wrong: number;
  empty: number;
  timeUsed: number;
  passed: boolean;
  weakAreas: any[];
  wrongQuestions?: any[];
}) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { error: "Oturum açmadınız" }
    const userId = session.user.id

    const saved = await prisma.userMockExamResult.create({
      data: {
        userId,
        courseId,
        score: result.score,
        correct: result.correct,
        wrong: result.wrong,
        empty: result.empty,
        timeUsed: result.timeUsed,
        passed: result.passed,
        weakAreas: JSON.stringify({
          topics: result.weakAreas,
          wrongQuestions: result.wrongQuestions || []
        }),
      }
    })

    // --- Gamification Tetikleyicileri ---
    await logActivityXP(userId, "exam_completed", result.score) // Kazanılan XP = Sınav Puanı
    
    // Arka planda leaderboard ve başarımları güncelle
    Promise.all([
      checkAndAwardAchievements(userId),
      updateLeaderboard(userId, {
        questionsAnswered: result.correct + result.wrong + result.empty,
        correctAnswers: result.correct,
        xpEarned: result.score
      })
    ]).catch(err => console.error("Mock exam gamification error:", err))

    return { success: true, id: saved.id }
  } catch (error) {
    console.error("Failed to save mock exam result:", error)
    return { error: "Sonuç kaydedilemedi" }
  }
}

export async function getMockExamResults(courseId: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []
    const userId = session.user.id

    const results = await prisma.userMockExamResult.findMany({
      where: { courseId, userId },
      orderBy: { createdAt: 'asc' }
    })
    return results
  } catch (error) {
    console.error("Failed to fetch mock exam results:", error)
    return []
  }
}

// ==================== GAMIFICATION ENGINE ====================

const ACHIEVEMENT_DEFINITIONS = [
  // Soru çözme başarıları
  { key: "first_question", title: "İlk Adım", description: "İlk sorunuzu çözdünüz!", icon: "🎯", xp: 10, check: (s: any) => s.totalQuestions >= 1 },
  { key: "questions_10", title: "Isınma Turu", description: "10 soru çözdünüz!", icon: "📝", xp: 25, check: (s: any) => s.totalQuestions >= 10 },
  { key: "questions_50", title: "Çalışkan Öğrenci", description: "50 soru çözdünüz!", icon: "📚", xp: 50, check: (s: any) => s.totalQuestions >= 50 },
  { key: "questions_100", title: "Soru Canavarı", description: "100 soru çözdünüz!", icon: "🦾", xp: 100, check: (s: any) => s.totalQuestions >= 100 },
  { key: "questions_500", title: "Efsane", description: "500 soru çözdünüz!", icon: "👑", xp: 250, check: (s: any) => s.totalQuestions >= 500 },
  
  // Doğruluk başarıları
  { key: "accuracy_80", title: "Keskin Nişancı", description: "Soru doğruluk oranınız %80'i geçti!", icon: "🎯", xp: 75, check: (s: any) => s.totalQuestions >= 20 && s.accuracy >= 80 },
  { key: "accuracy_90", title: "Lazer Odak", description: "Soru doğruluk oranınız %90'ı geçti!", icon: "💎", xp: 150, check: (s: any) => s.totalQuestions >= 30 && s.accuracy >= 90 },
  
  // Seri başarıları
  { key: "streak_3", title: "Üç Günlük Seri", description: "3 gün üst üste çalıştınız!", icon: "🔥", xp: 30, check: (s: any) => s.streak >= 3 },
  { key: "streak_7", title: "Haftalık Seri", description: "7 gün üst üste çalıştınız!", icon: "🔥", xp: 75, check: (s: any) => s.streak >= 7 },
  { key: "streak_14", title: "Demir İrade", description: "14 gün üst üste çalıştınız!", icon: "💪", xp: 150, check: (s: any) => s.streak >= 14 },
  { key: "streak_30", title: "Durdurulamaz", description: "30 gün üst üste çalıştınız!", icon: "⚡", xp: 300, check: (s: any) => s.streak >= 30 },
  
  // Flashcard başarıları
  { key: "flashcard_50", title: "Kart Meraklısı", description: "50 flashcard'ı öğrendiniz!", icon: "🃏", xp: 50, check: (s: any) => s.masteredCards >= 50 },
  { key: "flashcard_200", title: "Hafıza Ustası", description: "200 flashcard'ı öğrendiniz!", icon: "🧠", xp: 150, check: (s: any) => s.masteredCards >= 200 },
  
  // Deneme sınavı başarıları
  { key: "first_exam", title: "Cesur Adım", description: "İlk deneme sınavınızı çözdünüz!", icon: "📋", xp: 50, check: (s: any) => s.totalExams >= 1 },
  { key: "exam_pass", title: "Geçti!", description: "Deneme sınavında barajı geçtiniz!", icon: "✅", xp: 100, check: (s: any) => s.bestExamScore >= 60 },
  { key: "exam_80", title: "Üstün Başarı", description: "Deneme sınavında %80+ aldınız!", icon: "🏆", xp: 200, check: (s: any) => s.bestExamScore >= 80 },
  { key: "perfect_exam", title: "Mükemmeliyetçi", description: "Deneme sınavında %95+ aldınız!", icon: "💯", xp: 500, check: (s: any) => s.bestExamScore >= 95 },
]

export async function logActivityXP(userId: string, actionType: "question_answered" | "exam_completed", amount: number = 1) {
  try {
    // E-18: Amount validasyonu — negatif veya aşırı XP enjeksiyonunu engelle
    const safeAmount = Math.max(0, Math.min(Math.floor(amount), 100))
    if (safeAmount <= 0) return

    let xpToAward = 0
    if (actionType === "question_answered") {
      xpToAward = safeAmount * 2 // 2 XP per correct question
    } else if (actionType === "exam_completed") {
      xpToAward = safeAmount // amount is the score
    }

    if (xpToAward > 0) {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { totalXP: { increment: xpToAward } },
        select: { totalXP: true }
      })
      const newLevel = Math.floor(updated.totalXP / 500) + 1
      await prisma.user.update({
        where: { id: userId },
        data: { level: newLevel }
      })
    }
  } catch (error) {
    console.error("Failed to log activity XP:", error)
  }
}

export async function checkAndAwardAchievements(userId: string) {
  try {
    // Kullanıcının mevcut istatistiklerini topla
    const [user, questionStats, flashcardStats, examStats, existingAchievements] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { currentStreak: true } }),
      prisma.userQuestionAnswer.count({ where: { userId } }),
      prisma.userFlashcardProgress.count({ where: { userId, mastered: true } }),
      prisma.userMockExamResult.findMany({
        where: { userId },
        select: { score: true }
      }),
      prisma.userAchievement.findMany({
        where: { userId },
        select: { key: true }
      })
    ])

    const totalQuestions = questionStats || 0
    const correctQuestions = await prisma.userQuestionAnswer.count({ where: { userId, isCorrect: true } })
    const accuracy = totalQuestions > 0 ? (correctQuestions / totalQuestions) * 100 : 0
    const bestExamScore = examStats.length > 0 ? Math.max(...examStats.map(e => e.score)) : 0

    const stats = {
      totalQuestions,
      accuracy,
      streak: user?.currentStreak || 0,
      masteredCards: flashcardStats,
      totalExams: examStats.length,
      bestExamScore,
    }

    const earnedKeys = new Set(existingAchievements.map(a => a.key))
    const newAchievements: typeof ACHIEVEMENT_DEFINITIONS = []

    for (const def of ACHIEVEMENT_DEFINITIONS) {
      if (!earnedKeys.has(def.key) && def.check(stats)) {
        newAchievements.push(def)
      }
    }

    // Yeni başarıları kaydet
    let totalNewXP = 0
    for (const achievement of newAchievements) {
      await prisma.userAchievement.create({
        data: {
          userId,
          key: achievement.key,
          title: achievement.title,
          description: achievement.description,
          icon: achievement.icon,
          xpReward: achievement.xp,
        }
      })
      totalNewXP += achievement.xp
    }

    // XP ve level güncelle
    if (totalNewXP > 0) {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          totalXP: { increment: totalNewXP },
        },
        select: { totalXP: true }
      })
      // Level hesapla: her 500 XP = 1 level
      const newLevel = Math.floor(updated.totalXP / 500) + 1
      await prisma.user.update({
        where: { id: userId },
        data: { level: newLevel }
      })
    }

    return newAchievements.map(a => ({ key: a.key, title: a.title, description: a.description, icon: a.icon, xp: a.xp }))
  } catch (error) {
    console.error("Achievement check error:", error)
    return []
  }
}

export async function getUserAchievements() {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { achievements: [], totalXP: 0, level: 1 }
    const userId = session.user.id

    const [achievements, user] = await Promise.all([
      prisma.userAchievement.findMany({
        where: { userId },
        orderBy: { earnedAt: "desc" }
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { totalXP: true, level: true, longestStreak: true }
      })
    ])

    return {
      achievements,
      totalXP: user?.totalXP || 0,
      level: user?.level || 1,
      longestStreak: user?.longestStreak || 0,
      allDefinitions: ACHIEVEMENT_DEFINITIONS.map(d => ({
        key: d.key, title: d.title, description: d.description, icon: d.icon, xp: d.xp,
        earned: achievements.some(a => a.key === d.key)
      }))
    }
  } catch (error) {
    console.error("Failed to fetch achievements:", error)
    return { achievements: [], totalXP: 0, level: 1, allDefinitions: [] }
  }
}

// ==================== GERÇEKÇİ HAZIRLIK ENDEKSİ ====================
// İnsanlar bu orana güvenip sınava girecek ve sınavlar paralı.
// Bu yüzden ASLA şişirilmiş oran verme. Gerçek performansa dayalı hesapla.

export async function getCourseReadiness(courseId: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return null
    const userId = session.user.id

    const [
      totalQuestions,
      answeredQuestions,
      correctAnswers,
      totalFlashcards,
      masteredFlashcards,
      totalSections,
      processedSections,
      examResults,
    ] = await Promise.all([
      prisma.question.count({ where: { courseId } }),
      prisma.userQuestionAnswer.count({ where: { userId, question: { courseId } } }),
      prisma.userQuestionAnswer.count({ where: { userId, isCorrect: true, question: { courseId } } }),
      prisma.flashcard.count({ where: { courseId } }),
      prisma.userFlashcardProgress.count({ where: { userId, mastered: true, flashcard: { courseId } } }),
      prisma.section.count({ where: { courseId } }),
      prisma.section.count({ where: { courseId, processed: true } }),
      prisma.userMockExamResult.findMany({
        where: { courseId, userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { score: true, correct: true, wrong: true, createdAt: true }
      }),
    ])

    // Alt metrikler (0-100 arası)
    const questionAccuracy = answeredQuestions > 0 ? (correctAnswers / answeredQuestions) * 100 : 0
    const questionCoverage = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0
    const flashcardMastery = totalFlashcards > 0 ? (masteredFlashcards / totalFlashcards) * 100 : 0
    const contentCoverage = totalSections > 0 ? (processedSections / totalSections) * 100 : 0
    
    // Son 5 deneme ortalaması
    const examAvg = examResults.length > 0
      ? examResults.reduce((sum, e) => sum + e.score, 0) / examResults.length
      : 0

    // Trend: son deneme vs önceki denemeler
    const examTrend = examResults.length >= 2
      ? examResults[0].score - examResults[examResults.length - 1].score
      : 0

    // AĞIRLIKLI HAZIRLIK ENDEKSİ
    // Soru doğruluğu %30 — gerçek bilgiyi ölçer
    // Deneme sınav ortalaması %30 — gerçek sınav performansı
    // Flashcard mastery %20 — kavram bilgisi
    // İçerik coverage %10 — materyali ne kadar çalıştın
    // Soru coverage %10 — soruları ne kadar çözdün
    //
    // NOT: Hiç deneme çözmemişsen maks %40 gösterilir (deneme olmadan hazır sayılmazsın)
    // NOT: Hiç soru çözmemişsen maks %20 gösterilir
    
    let readiness = 0

    if (examResults.length > 0 && answeredQuestions > 0) {
      readiness = (
        questionAccuracy * 0.30 +
        examAvg * 0.30 +
        flashcardMastery * 0.20 +
        contentCoverage * 0.10 +
        questionCoverage * 0.10
      )
    } else if (answeredQuestions > 0) {
      // Deneme çözmemiş ama soru çözmüş → maks %40
      readiness = Math.min(40, (
        questionAccuracy * 0.50 +
        flashcardMastery * 0.30 +
        contentCoverage * 0.20
      ))
    } else if (totalSections > 0) {
      // Sadece not okumuş → maks %15
      readiness = Math.min(15, contentCoverage * 0.15)
    }

    readiness = Math.round(readiness)

    return {
      readiness,
      breakdown: {
        questionAccuracy: Math.round(questionAccuracy),
        questionCoverage: Math.round(questionCoverage),
        flashcardMastery: Math.round(flashcardMastery),
        contentCoverage: Math.round(contentCoverage),
        examAvg: Math.round(examAvg),
        examTrend: Math.round(examTrend),
        examCount: examResults.length,
      },
      totals: {
        questions: totalQuestions,
        answered: answeredQuestions,
        correct: correctAnswers,
        flashcards: totalFlashcards,
        mastered: masteredFlashcards,
        sections: totalSections,
      },
      verdict: readiness >= 80 ? "Sınava hazırsın! 🎉" :
               readiness >= 60 ? "İyi gidiyorsun, biraz daha çalış 💪" :
               readiness >= 40 ? "Gelişme var ama deneme sınavı çöz 📝" :
               readiness >= 20 ? "Daha çok çalışman gerekiyor 📖" :
               "Henüz başlangıç aşamasındasın, başla! 🚀"
    }
  } catch (error) {
    console.error("Readiness calc error:", error)
    return null
  }
}

// ==================== LEADERBOARD ====================

// E-17: ISO 8601 uyumlu hafta numarası hesaplaması
function getWeekKey(): string {
  const now = new Date()
  // ISO 8601: Haftalar Pazartesi başlar, yılın ilk Perşembe'sini içeren hafta = W01
  const target = new Date(now.valueOf())
  target.setDate(target.getDate() - ((target.getDay() + 6) % 7) + 3) // En yakın Perşembe
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3)
  const weekNum = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return `${target.getFullYear()}-W${String(weekNum).padStart(2, "0")}`
}

export async function updateLeaderboard(userId: string, data: {
  questionsAnswered?: number
  correctAnswers?: number
  flashcardsReviewed?: number
  mockExamsTaken?: number
  xpEarned?: number
}) {
  try {
    const weekKey = getWeekKey()
    await prisma.weeklyLeaderboard.upsert({
      where: { userId_weekKey: { userId, weekKey } },
      create: { userId, weekKey, ...data },
      update: {
        questionsAnswered: data.questionsAnswered ? { increment: data.questionsAnswered } : undefined,
        correctAnswers: data.correctAnswers ? { increment: data.correctAnswers } : undefined,
        flashcardsReviewed: data.flashcardsReviewed ? { increment: data.flashcardsReviewed } : undefined,
        mockExamsTaken: data.mockExamsTaken ? { increment: data.mockExamsTaken } : undefined,
        xpEarned: data.xpEarned ? { increment: data.xpEarned } : undefined,
      }
    })
  } catch (error) {
    console.error("Leaderboard update error:", error)
  }
}

export async function getWeeklyLeaderboard() {
  try {
    const weekKey = getWeekKey()
    const entries = await prisma.weeklyLeaderboard.findMany({
      where: { weekKey },
      orderBy: { xpEarned: "desc" },
      take: 20,
    })

    // Kullanıcı isimlerini al (anonim hale getir)
    const userIds = entries.map(e => e.userId)
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true }
    })
    const userMap = new Map(users.map(u => [u.id, u.name || "Anonim"]))

    return entries.map((e, i) => ({
      rank: i + 1,
      name: anonymizeName(userMap.get(e.userId) || "Anonim"),
      questionsAnswered: e.questionsAnswered,
      correctAnswers: e.correctAnswers,
      xpEarned: e.xpEarned,
      isCurrentUser: false, // frontend'de set edilecek
      userId: e.userId,
    }))
  } catch (error) {
    console.error("Leaderboard fetch error:", error)
    return []
  }
}

function anonymizeName(name: string): string {
  if (name.length <= 2) return name + "***"
  return name.substring(0, 2) + "***"
}

// ==================== SORU ÇOĞALTMA ====================

export async function generateMoreContentAction(courseSlug: string, contentType: "QUESTIONS" | "FLASHCARDS", sectionId?: string, count: number = 20) {
  try {
    const auth = await requireAdmin()
    if (!auth.authorized) return { success: false, message: auth.error || "Bu işlem için yetkiniz yok." }

    const course = await prisma.course.findUnique({ 
      where: { slug: courseSlug },
      include: { program: true, sections: true }
    })
    if (!course) throw new Error(getStudyNotFoundMessage(courseSlug.startsWith("zeliha-") ? "zeliha-mevzuat" : ""))
    
    const { generateQuestions, generateFlashcards, validateQuestionsWithSolver, validateFlashcardsWithSolver } = await import("./ai-service")
    
    const fullCourseName = `${course.program?.name || "SPL Düzey 3"} > ${course.name}`

    const approvedSections = (sectionId
      ? course.sections.filter(s => s.id === sectionId)
      : course.sections
    ).filter(s => s.notes && s.notes.length > 500 && (s.verificationScore ?? 0) >= 98)

    if (approvedSections.length === 0) {
      return { success: false, message: getApprovedNotesNotFoundMessage(course.program?.slug ?? "") }
    }
    
    let totalGenerated = 0
    const aiMode = course.program?.aiMode || "general"

    if (contentType === "QUESTIONS") {
      const existingItems = await prisma.question.findMany({ where: { courseId: course.id }, select: { text: true } })
      const existingTexts = new Set(existingItems.map(eq => eq.text.trim().toLowerCase()))
      
      for (const section of approvedSections) {
        if (totalGenerated >= count) break
        const remaining = count - totalGenerated
        const sourceNotes = section.notes!
        let questions = await generateQuestions(sourceNotes, section.title, fullCourseName, course.userLevel, aiMode, undefined, section.pageStart, section.pageEnd, section.importance || undefined)
        
        // SOLVER AI: Üretilen soruları test et (ana pipeline ile aynı kaynak: onaylı notlar)
        questions = await validateQuestionsWithSolver(sourceNotes, questions);

        for (const q of questions.slice(0, remaining)) {
          try {
            const textLower = q.text.trim().toLowerCase()
            if (!existingTexts.has(textLower)) {
              await prisma.question.create({
                data: { courseId: course.id, sectionId: section.id, text: q.text, options: JSON.stringify(q.options), correct: q.correct, explanation: q.explanation, difficulty: q.difficulty || "medium" }
              })
              existingTexts.add(textLower)
              totalGenerated++
            }
          } catch {}
        }
      }
    } else {
      const existingItems = await prisma.flashcard.findMany({ where: { courseId: course.id }, select: { front: true } })
      const existingTexts = new Set(existingItems.map(eq => eq.front.trim().toLowerCase()))
      
      for (const section of approvedSections) {
        if (totalGenerated >= count) break
        const remaining = count - totalGenerated
        const sourceNotes = section.notes!
        let cards = await generateFlashcards(sourceNotes, section.title, fullCourseName, course.userLevel, aiMode, undefined, section.pageStart, section.pageEnd)
        
        // SOLVER AI: Üretilen kartları test et (ana pipeline ile aynı kaynak: onaylı notlar)
        cards = await validateFlashcardsWithSolver(sourceNotes, cards);

        for (const c of cards.slice(0, remaining)) {
          try {
            const textLower = c.front.trim().toLowerCase()
            if (!existingTexts.has(textLower)) {
              await prisma.flashcard.create({
                data: { courseId: course.id, sectionId: section.id, front: c.front, back: c.back, difficulty: c.difficulty || "medium" }
              })
              existingTexts.add(textLower)
              totalGenerated++
            }
          } catch {}
        }
      }
    }
    
    return { success: true, message: `${totalGenerated} yeni ${contentType === 'QUESTIONS' ? 'soru' : 'kart'} üretildi!`, count: totalGenerated }
  } catch (error: any) {
    console.error("[generateMoreContentAction]", error)
    return { success: false, message: error.message || "Üretim başarısız." }
  }
}

// ==================== ZAYIF ALAN ANALİZİ ====================

export async function getWeakAreas(courseSlug: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []
    
    const course = await prisma.course.findUnique({ 
      where: { slug: courseSlug },
      include: { sections: true }
    })
    if (!course) return []
    
    // Tüm cevapları çek
    const answers = await prisma.userQuestionAnswer.findMany({
      where: { userId: session.user.id, question: { courseId: course.id } },
      include: { question: { include: { section: true } } }
    })
    
    // Bölüm bazlı analiz
    const sectionStats = new Map<string, { 
      sectionId: string, title: string, total: number, correct: number, wrong: number, 
      wrongTopics: string[], pageStart: number, pageEnd: number 
    }>()
    
    for (const ans of answers) {
      const sId = ans.question.sectionId || "general"
      const title = ans.question.section?.title || "Genel"
      
      if (!sectionStats.has(sId)) {
        sectionStats.set(sId, { 
          sectionId: sId, title, total: 0, correct: 0, wrong: 0, wrongTopics: [],
          pageStart: ans.question.section?.pageStart || 0,
          pageEnd: ans.question.section?.pageEnd || 0
        })
      }
      
      const stats = sectionStats.get(sId)!
      stats.total++
      if (ans.isCorrect) {
        stats.correct++
      } else {
        stats.wrong++
        // Sorunun konusunu tespit et (soru metninin ilk cümlesinden)
        const topic = ans.question.text.substring(0, 60)
        stats.wrongTopics.push(topic)
      }
    }
    
    // Zayıf alanları bul (doğruluk oranı %70'in altında olanlar)
    const weakAreas = Array.from(sectionStats.values())
      .filter(s => s.total >= 2 && (s.correct / s.total) < 0.7)
      .sort((a, b) => (a.correct / a.total) - (b.correct / b.total))
      .map(s => ({
        ...s,
        accuracy: Math.round((s.correct / s.total) * 100),
        recommendation: s.correct / s.total < 0.4 
          ? "🔴 Kritik — Bu konuyu baştan çalışmalısın" 
          : s.correct / s.total < 0.6 
          ? "🟡 Dikkat — Notları tekrar gözden geçir" 
          : "🟢 İyiye gidiyor — Biraz daha pratik yap"
      }))
    
    return weakAreas
  } catch (error) {
    console.error("[getWeakAreas]", error)
    return []
  }
}

// ==================== KAPSAM HARİTASI ====================

export async function getCoverageMap(courseSlug: string) {
  try {
    const session = await getSession()
    const userId = session?.user?.id
    
    const course = await prisma.course.findUnique({
      where: { slug: courseSlug },
      include: { 
        sections: { orderBy: { order: "asc" } },
      }
    })
    if (!course) return []
    
    const sectionIds = course.sections.map(s => s.id)
    
    // Toplu sorgular — N+1 yerine 4 query
    const [allQuestions, allFlashcards, allAnswers, allMastered] = await Promise.all([
      prisma.question.groupBy({ by: ["sectionId"], _count: true, where: { sectionId: { in: sectionIds } } }),
      prisma.flashcard.groupBy({ by: ["sectionId"], _count: true, where: { sectionId: { in: sectionIds } } }),
      userId ? prisma.userQuestionAnswer.findMany({
        where: { userId, question: { sectionId: { in: sectionIds } } },
        select: { isCorrect: true, question: { select: { sectionId: true } } }
      }) : Promise.resolve([]),
      userId ? prisma.userFlashcardProgress.findMany({
        where: { userId, mastered: true, flashcard: { sectionId: { in: sectionIds } } },
        select: { flashcard: { select: { sectionId: true } } }
      }) : Promise.resolve([]),
    ])
    
    // Map'lere dönüştür
    const qCountMap = new Map(allQuestions.map(q => [q.sectionId, q._count]))
    const fCountMap = new Map(allFlashcards.map(f => [f.sectionId, f._count]))
    
    const answersBySection = new Map<string, { total: number, correct: number }>()
    for (const a of allAnswers as any[]) {
      const sid = a.question.sectionId
      if (!sid) continue
      const stats = answersBySection.get(sid) || { total: 0, correct: 0 }
      stats.total++
      if (a.isCorrect) stats.correct++
      answersBySection.set(sid, stats)
    }
    
    const masteredBySection = new Map<string, number>()
    for (const m of allMastered as any[]) {
      const sid = m.flashcard.sectionId
      if (!sid) continue
      masteredBySection.set(sid, (masteredBySection.get(sid) || 0) + 1)
    }
    
    return course.sections.map(section => {
      const totalQuestions = qCountMap.get(section.id) || 0
      const totalFlashcards = fCountMap.get(section.id) || 0
      const ansStats = answersBySection.get(section.id) || { total: 0, correct: 0 }
      const masteredFlashcards = masteredBySection.get(section.id) || 0
      
      const questionProgress = totalQuestions > 0 ? Math.round((ansStats.total / totalQuestions) * 100) : 0
      const questionAccuracy = ansStats.total > 0 ? Math.round((ansStats.correct / ansStats.total) * 100) : 0
      const flashcardProgress = totalFlashcards > 0 ? Math.round((masteredFlashcards / totalFlashcards) * 100) : 0
      const hasNotes = !!section.notes && section.notes.length > 100
      
      const overallScore = Math.round(
        (hasNotes ? 20 : 0) + 
        (questionProgress * 0.4) + 
        (questionAccuracy * 0.2) + 
        (flashcardProgress * 0.2)
      )
      
      return {
        sectionId: section.id,
        title: section.title,
        order: section.order,
        importance: section.importance || "Medium",
        hasNotes,
        totalQuestions,
        answeredQuestions: ansStats.total,
        correctQuestions: ansStats.correct,
        questionProgress,
        questionAccuracy,
        totalFlashcards,
        masteredFlashcards,
        flashcardProgress,
        overallScore,
        processed: section.processed,
        status: !section.processed ? "processing" : overallScore >= 80 ? "mastered" : overallScore >= 50 ? "learning" : overallScore > 0 ? "started" : "not_started"
      }
    })
  } catch (error) {
    console.error("[getCoverageMap]", error)
    return []
  }
}

// ==================== ARAMA FONKSİYONU ====================

export async function searchCourse(courseSlug: string, query: string) {
  try {
    if (!query || query.length < 2) return { notes: [], questions: [] }
    
    const course = await prisma.course.findUnique({
      where: { slug: courseSlug },
      include: { sections: true }
    })
    if (!course) return { notes: [], questions: [] }
    
    const q = query.toLowerCase()
    
    // Notlarda ara
    const noteResults = course.sections
      .filter(s => s.notes && s.notes.toLowerCase().includes(q))
      .map(s => {
        const noteText = s.notes!.toLowerCase()
        const idx = noteText.indexOf(q)
        const start = Math.max(0, idx - 80)
        const end = Math.min(noteText.length, idx + q.length + 80)
        const snippet = "..." + s.notes!.substring(start, end).replace(/\n/g, " ") + "..."
        
        return {
          type: "note" as const,
          sectionId: s.id,
          sectionTitle: s.title,
          snippet,
          pageStart: s.pageStart,
          pageEnd: s.pageEnd
        }
      })
    
    // Sorularda ara
    const questions = await prisma.question.findMany({
      where: { courseId: course.id },
      include: { section: true }
    })
    
    const questionResults = questions
      .filter(q2 => q2.text.toLowerCase().includes(q) || q2.explanation?.toLowerCase().includes(q))
      .map(q2 => ({
        type: "question" as const,
        questionId: q2.id,
        sectionTitle: q2.section?.title || "Genel",
        text: q2.text,
        correct: q2.correct
      }))
    
    return { notes: noteResults, questions: questionResults }
  } catch (error) {
    console.error("[searchCourse]", error)
    return { notes: [], questions: [] }
  }
}

export async function approveSectionAction(sectionId: string) {
  try {
    // E-13: Admin yetkilendirmesi
    const auth = await requireAdmin()
    if (!auth.authorized) return { error: auth.error }
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { course: true }
    })
    if (!section) return { error: "Bölüm bulunamadı" }

    const updatedSection = await prisma.section.update({
      where: { id: sectionId },
      data: { processed: true }
    })

    await prisma.course.update({
      where: { id: section.courseId },
      data: { status: "processing" }
    })

    return { success: true, section: updatedSection, slug: section.course.slug }
  } catch (error: any) {
    console.error("[APPROVE_SECTION_ACTION]", error)
    return { error: error.message }
  }
}

export async function updateUserExamDate(examDate: string | null) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { error: "Oturum açmadınız" }
    
    // Prisma "Record to update not found" hatasını yakalamak için önce kontrol edelim
    let user = await prisma.user.findUnique({ where: { id: session.user.id } })
    
    if (!user) {
      // Geliştirme ortamında veritabanı sıfırlanmışsa, kullanıcıyı session'daki bilgilerle yeniden oluştur
      user = await prisma.user.create({
        data: {
          id: session.user.id,
          name: session.user.name || "Kullanıcı",
          email: session.user.email || `${session.user.id}@temp.com`,
          role: "student",
        }
      })
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { targetExamDate: examDate ? new Date(examDate) : null }
    })
    return { success: true }
  } catch (error: any) {
    return { error: error.message }
  }
}

export async function getDailyTasks() {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []
    
    // Yyyy-mm-dd prefix to match ISO string prefix
    const today = new Date().toISOString().split('T')[0]
    
    const tasks = await prisma.studyPlan.findMany({
      where: {
        userId: session.user.id,
        date: {
          startsWith: today
        }
      },
      include: {
        course: {
          select: { name: true, slug: true, program: { select: { slug: true } } }
        }
      },
      orderBy: { createdAt: 'asc' }
    })
    
    return tasks
  } catch (error) {
    console.error("getDailyTasks error", error)
    return []
  }
}

export async function toggleTaskCompletion(taskId: string, completed: boolean) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { success: false, error: "Unauthorized" }
    
    // To protect data, verify the task belongs to the user
    const task = await prisma.studyPlan.findUnique({ where: { id: taskId } })
    if (!task || task.userId !== session.user.id) return { success: false, error: "Task not found" }
    
    await prisma.studyPlan.update({
      where: { id: taskId },
      data: { completed }
    })
    
    // Add XP if completed
    if (completed) {
      // For tasks, let's treat it as question_answered equivalent for now with a custom amount
      // Since logActivityXP only takes question_answered | exam_completed, I should use question_answered with amount=25 (25 * 2 = 50 XP)
      await logActivityXP(session.user.id, "question_answered", 25)
    }
    
    return { success: true }
  } catch (error) {
    console.error("toggleTaskCompletion error", error)
    return { success: false }
  }
}

// ==================== USER ANNOTATIONS (ODAK MODU BOYAMA) ====================

export async function saveUserAnnotation(data: {
  courseId: string;
  sectionId: string;
  text: string;
  cfi?: string;
  color?: string;
  note?: string;
}) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { success: false, error: "Unauthorized" }

    const annotation = await prisma.userAnnotation.create({
      data: {
        userId: session.user.id,
        courseId: data.courseId,
        sectionId: data.sectionId,
        text: data.text,
        cfi: data.cfi || null,
        color: data.color || "yellow",
        note: data.note || null,
      }
    })

    return { success: true, annotation }
  } catch (error: any) {
    console.error("saveUserAnnotation error", error)
    return { success: false, error: error.message }
  }
}

export async function getSectionAnnotations(sectionId: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return []

    const annotations = await prisma.userAnnotation.findMany({
      where: {
        userId: session.user.id,
        sectionId: sectionId
      },
      orderBy: { createdAt: "desc" }
    })

    return annotations
  } catch (error) {
    console.error("getSectionAnnotations error", error)
    return []
  }
}

export async function deleteUserAnnotation(id: string) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return { success: false, error: "Unauthorized" }

    const annotation = await prisma.userAnnotation.findUnique({ where: { id } })
    if (!annotation || annotation.userId !== session.user.id) {
      return { success: false, error: "Not found or unauthorized" }
    }

    await prisma.userAnnotation.delete({ where: { id } })
    return { success: true }
  } catch (error: any) {
    console.error("deleteUserAnnotation error", error)
    return { success: false, error: error.message }
  }
}
