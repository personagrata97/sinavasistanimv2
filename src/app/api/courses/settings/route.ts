import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth-options"

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }

    const { slug, generateNotes, generateQuestions, generateFlashcards } = await req.json()

    if (!slug) {
      return NextResponse.json({ success: false, error: "Missing slug" }, { status: 400 })
    }

    const course = await prisma.course.findUnique({
      where: { slug }
    })

    if (!course) {
      return NextResponse.json({ success: false, error: "Course not found" }, { status: 404 })
    }

    await prisma.course.update({
      where: { id: course.id },
      data: {
        generateNotes: generateNotes ?? true,
        generateQuestions: generateQuestions ?? true,
        generateFlashcards: generateFlashcards ?? true,
      }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[SETTINGS_API] Error updating course settings:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
