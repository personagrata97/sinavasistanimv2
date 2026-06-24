import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { prisma } from "@/lib/prisma"
import { generateStudySchedule } from "@/lib/schedule-engine"

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { courseId, targetExamDate, targetHours } = await req.json()
    if (!courseId || !targetExamDate) {
      return NextResponse.json({ error: "courseId and targetExamDate are required" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Kullanıcının hedeflerini güncelle
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        targetExamDate: new Date(targetExamDate),
        targetHours: targetHours ? Number(targetHours) : (user.targetHours || undefined)
      }
    })

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sections: {
          orderBy: { order: "asc" }
        }
      }
    })

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 })
    }

    // Zayıf Konuları Bul (Hem Mock Exam sonuçlarından hem de normal soru testlerindeki yanlışlardan)
    const mockResults = await prisma.userMockExamResult.findMany({
      where: { userId: user.id, courseId: course.id },
      orderBy: { createdAt: "desc" },
      take: 1
    })

    let weakSectionIds: string[] = []
    if (mockResults.length > 0 && mockResults[0].weakAreas) {
      try {
        weakSectionIds = JSON.parse(mockResults[0].weakAreas)
      } catch (e) {
        console.error("Failed to parse weakAreas", e)
      }
    }

    // Normal testlerdeki yanlış yapılan soruların bölümlerini de ekle
    const wrongAnswers = await prisma.userQuestionAnswer.findMany({
      where: {
        userId: user.id,
        isCorrect: false,
        question: {
          courseId: course.id
        }
      },
      include: {
        question: true
      }
    })

    const wrongAnswerSectionIds = wrongAnswers
      .map(wa => wa.question?.sectionId)
      .filter((id): id is string => !!id)

    // Her iki listeyi birleştirip tekilleştir
    weakSectionIds = Array.from(new Set([...weakSectionIds, ...wrongAnswerSectionIds]))

    // Eski planı sil
    await prisma.studyPlan.deleteMany({
      where: {
        userId: user.id,
        courseId: course.id
      }
    })

    // Yeni planı oluştur
    const items = generateStudySchedule({
      examDate: new Date(targetExamDate),
      userLevel: course.userLevel as any,
      totalSections: course.sections.length,
      sectionTitles: course.sections.map(s => s.title),
      sectionIds: course.sections.map(s => s.id),
      weakSectionIds,
      targetHours: targetHours ? Number(targetHours) : (user.targetHours || undefined)
    })

    // Veritabanına kaydet
    const planItems = []
    for (const item of items) {
      const created = await prisma.studyPlan.create({
        data: {
          userId: user.id,
          courseId: course.id,
          date: item.date.toISOString(),
          task: item.task,
          type: item.type,
          duration: item.duration.toString(),
          sectionIds: JSON.stringify(item.sectionIds),
          completed: false
        }
      })
      planItems.push(created)
    }

    return NextResponse.json({ success: true, count: planItems.length, weakAreasCount: weakSectionIds.length })
  } catch (error: any) {
    console.error("[STUDY_PLAN_GENERATE_API]", error)
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
  }
}
