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

    if (!course.blueprint) {
      const allQuestions = await prisma.question.findMany({
        where: { courseId: course.id, reported: false },
        include: { section: { select: { title: true } } }
      })
      for (let i = allQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]]
      }
      if (programSlug === "masak" && allQuestions.length < takeCount) {
        return NextResponse.json(
          { error: `MASAK deneme sınavı için en az ${takeCount} soru gerekir. Mevcut: ${allQuestions.length}` },
          { status: 400 }
        )
      }
      const randomQuestions = allQuestions.slice(0, takeCount)
      const parsedRandomQuestions = randomQuestions.map(q => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
      }))
      return NextResponse.json({
        questions: parsedRandomQuestions,
        isBlueprint: false,
        totalQuestions: takeCount,
        durationMinutes: examParams?.durationMinutes ?? examConfig?.durationMinutes ?? 45,
        passingScore: examParams?.passingScore ?? examConfig?.passingScore ?? 60,
        moduleBarrier: examParams?.moduleBarrier ?? examConfig?.moduleBarrier ?? 50,
      })
    }

    let finalExamQuestions: any[] = []

    for (const module of course.blueprint.modules) {
      const moduleQuestions = await prisma.question.findMany({
        where: {
          courseId: course.id,
          module: module.moduleName,
          reported: false
        },
        take: module.questionCount,
        orderBy: { id: 'desc' },
        include: { section: { select: { title: true } } }
      })

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
