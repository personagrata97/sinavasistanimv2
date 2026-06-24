import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { isAdminSession } from "@/lib/quota-guard"
import { cancelCourseProcessing } from "@/lib/process-registry"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isAdminSession(session?.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const jobs = await prisma.job.findMany({
      where: {
        status: { in: ["pending", "processing", "failed"] }
      },
      orderBy: { createdAt: "desc" },
    })

    const courses = await prisma.course.findMany({
      where: { slug: { in: jobs.map(j => j.courseSlug) } },
      select: { 
        slug: true, 
        name: true, 
        status: true, 
        program: { select: { name: true, slug: true } },
        sections: {
          where: { processed: false },
          orderBy: { order: "asc" },
          take: 1,
          select: { verificationIssues: true }
        }
      }
    })

    const enrichedJobs = jobs.map(job => {
      const course = courses.find(c => c.slug === job.courseSlug)
      let phaseLabel = null;
      if (course?.sections && course.sections.length > 0 && course.sections[0].verificationIssues) {
        try {
          const issues = typeof course.sections[0].verificationIssues === "string" 
            ? JSON.parse(course.sections[0].verificationIssues) 
            : course.sections[0].verificationIssues;
          phaseLabel = issues.currentMicroPhase || null;
        } catch (e) {}
      }

      return {
        ...job,
        courseName: course?.name || job.courseSlug,
        programName: course?.program?.name || null,
        programSlug: course?.program?.slug || null,
        courseStatus: course?.status || null,
        phaseLabel
      }
    })

    return NextResponse.json(enrichedJobs)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isAdminSession(session?.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id, courseSlug } = await req.json()
    
    if (courseSlug) {
      const course = await prisma.course.findUnique({ where: { slug: courseSlug } })
      cancelCourseProcessing(courseSlug, course?.name)
    }

    // Delete the job
    if (id) {
      await prisma.job.delete({ where: { id } })
    }

    // Optionally set course to paused so UI updates
    if (courseSlug) {
      await prisma.course.update({
        where: { slug: courseSlug },
        data: { status: "paused" }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isAdminSession(session?.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id, courseSlug, action } = await req.json()
    
    if (action === "pause" && courseSlug) {
      const course = await prisma.course.findUnique({ where: { slug: courseSlug } })
      cancelCourseProcessing(courseSlug, course?.name)

      await prisma.course.update({
        where: { slug: courseSlug },
        data: { status: "paused" }
      })
      
      // Update the Job in the DB immediately so GET /jobs stops returning it as 'processing'
      if (id) {
        await prisma.job.update({
          where: { id },
          data: { status: "failed", error: "Duraklatıldı" }
        })
      }
      
      return NextResponse.json({ success: true, paused: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
