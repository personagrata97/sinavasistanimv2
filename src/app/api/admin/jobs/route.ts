import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { isAdminSession } from "@/lib/quota-guard"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isAdminSession(session?.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const jobs = await prisma.job.findMany({
      where: { status: { in: ["pending", "processing"] } },
      orderBy: { createdAt: "desc" },
    })

    const courses = await prisma.course.findMany({
      where: { slug: { in: jobs.map(j => j.courseSlug) } },
      select: { slug: true, name: true, status: true, program: { select: { name: true, slug: true } } }
    })

    const enrichedJobs = jobs.map(job => {
      const course = courses.find(c => c.slug === job.courseSlug)
      return {
        ...job,
        courseName: course?.name || job.courseSlug,
        programName: course?.program?.name || null,
        programSlug: course?.program?.slug || null,
        courseStatus: course?.status || null
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
