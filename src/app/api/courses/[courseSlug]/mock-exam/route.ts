import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { getCourseMockExamParams, getExamConfig } from "@/lib/course-data"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ courseSlug: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const { courseSlug } = await params
    const course = await prisma.course.findUnique({
      where: { slug: courseSlug },
      include: {
        blueprint: {
          include: { modules: true }
        },
        program: true
      }
    })

    if (!course) {
      return NextResponse.json({ error: "Eğitim bulunamadı" }, { status: 404 })
    }

    const programSlug = course.program?.slug ?? ""
    const examParams = getCourseMockExamParams(programSlug, courseSlug)
    const examConfig = getExamConfig(programSlug)
    const takeCount = examParams?.questionCount ?? 25

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    const userAnswers = user ? await prisma.userQuestionAnswer.findMany({
      where: { userId: user.id },
      select: { questionId: true }
    }) : []
    const answeredQuestionIds = new Set(userAnswers.map(a => a.questionId))

    if (!course.blueprint) {
      // 1. Önce examReserve: true ve kullanıcının DAHA ÖNCE GÖRMEDİĞİ soruları çek
      let reserveUnseen = await prisma.question.findMany({
        where: {
          courseId: course.id,
          reported: false,
          examReserve: true,
          id: { notIn: Array.from(answeredQuestionIds) }
        },
        include: { section: { select: { title: true } } }
      })

      let pool = reserveUnseen

      // 2. Yeterli değilse examReserve: true diğer sorularla tamamla
      if (pool.length < takeCount) {
        const existingIds = new Set(pool.map(q => q.id))
        const reserveAll = await prisma.question.findMany({
          where: {
            courseId: course.id,
            reported: false,
            examReserve: true,
            id: { notIn: Array.from(existingIds) }
          },
          include: { section: { select: { title: true } } }
        })
        pool = [...pool, ...reserveAll]
      }

      // 3. Hâlâ yeterli değilse genel havuzdaki diğer sorularla tamamla
      if (pool.length < takeCount) {
        const existingIds = new Set(pool.map(q => q.id))
        const fallback = await prisma.question.findMany({
          where: {
            courseId: course.id,
            reported: false,
            id: { notIn: Array.from(existingIds) }
          },
          include: { section: { select: { title: true } } }
        })
        pool = [...pool, ...fallback]
      }

      if (programSlug === "masak" && pool.length < takeCount) {
        return NextResponse.json(
          { error: `MASAK deneme sınavı için en az ${takeCount} soru gerekir. Mevcut: ${pool.length}` },
          { status: 400 }
        )
      }

      // 3. Stratified Sampling (Zorluk Dengesi: %30 kolay, %40 orta, %30 zor)
      const targetEasy = Math.round(takeCount * 0.3)
      const targetMedium = Math.round(takeCount * 0.4)
      const targetHard = Math.max(0, takeCount - targetEasy - targetMedium)

      const byDifficulty: { easy: any[]; medium: any[]; hard: any[] } = { easy: [], medium: [], hard: [] }
      pool.forEach(q => {
        const diff = (q.difficulty || "medium").toLowerCase()
        if (diff === "easy") byDifficulty.easy.push(q)
        else if (diff === "hard") byDifficulty.hard.push(q)
        else byDifficulty.medium.push(q)
      })

      const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5)

      let selected = [
        ...shuffle(byDifficulty.easy).slice(0, targetEasy),
        ...shuffle(byDifficulty.medium).slice(0, targetMedium),
        ...shuffle(byDifficulty.hard).slice(0, targetHard)
      ]

      // Eksik kalırsa havuzun geri kalanıyla tamamla
      if (selected.length < takeCount && pool.length >= takeCount) {
        const selectedIds = new Set(selected.map(q => q.id))
        const remainingPool = shuffle(pool.filter(q => !selectedIds.has(q.id)))
        selected = [...selected, ...remainingPool.slice(0, takeCount - selected.length)]
      }

      const parsedRandomQuestions = shuffle(selected).slice(0, takeCount).map(q => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
      }))

      return NextResponse.json({
        questions: parsedRandomQuestions,
        isBlueprint: false,
        totalQuestions: parsedRandomQuestions.length,
        durationMinutes: examParams?.durationMinutes ?? examConfig?.durationMinutes ?? 45,
        passingScore: examParams?.passingScore ?? examConfig?.passingScore ?? 60,
        moduleBarrier: examParams?.moduleBarrier ?? examConfig?.moduleBarrier ?? 50,
      })
    }

    let finalExamQuestions: any[] = []

    for (const module of course.blueprint.modules) {
      let moduleQuestions = await prisma.question.findMany({
        where: {
          courseId: course.id,
          module: module.moduleName,
          reported: false,
          examReserve: true
        },
        take: module.questionCount,
        orderBy: { id: 'desc' },
        include: { section: { select: { title: true } } }
      })

      if (moduleQuestions.length < module.questionCount) {
        const existingIds = new Set(moduleQuestions.map(q => q.id))
        const remainingCount = module.questionCount - moduleQuestions.length
        const fallbackQuestions = await prisma.question.findMany({
          where: {
            courseId: course.id,
            module: module.moduleName,
            reported: false,
            id: { notIn: Array.from(existingIds) }
          },
          take: remainingCount,
          orderBy: { id: 'desc' },
          include: { section: { select: { title: true } } }
        })
        moduleQuestions = [...moduleQuestions, ...fallbackQuestions]
      }

      finalExamQuestions = [...finalExamQuestions, ...moduleQuestions]
    }

    finalExamQuestions.sort(() => Math.random() - 0.5)

    const parsedFinalQuestions = finalExamQuestions.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    }))

    return NextResponse.json({
      totalQuestions: course.blueprint.totalQuestions || takeCount,
      passingScore: course.blueprint.passingScore || examParams?.passingScore || examConfig?.passingScore || 60,
      durationMinutes: examParams?.durationMinutes ?? examConfig?.durationMinutes ?? 45,
      moduleBarrier: examParams?.moduleBarrier ?? examConfig?.moduleBarrier ?? 50,
      questions: parsedFinalQuestions,
      isBlueprint: true
    })

  } catch (error) {
    console.error("[MOCK_EXAM_API] Error:", error)
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 })
  }
}
