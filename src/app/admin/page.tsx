import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import AdminClient from "./AdminClient"
import { getApiUsageDaySummary } from "@/lib/api-usage-summary"
import { resolveApiLogCourseFullName } from "@/lib/api-log-course-label"

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions)
  
  if (!session?.user || (session.user as any).role !== "admin") {
    redirect("/")
  }

  // Admin queries
  const users = await prisma.user.findMany({
    orderBy: { lastActiveAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      lastActiveAt: true,
      currentStreak: true,
      _count: {
        select: {
          mockResults: true,
          questionAnswers: true,
        }
      }
    }
  })

  // Fetch reported questions
  const reportedQuestions = await prisma.question.findMany({
    where: { reported: true },
    include: {
      course: {
        select: {
          slug: true,
          name: true,
          program: { select: { slug: true, name: true } }
        }
      },
      section: {
        select: {
          title: true,
          module: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  })

  // Fetch sections quality
  const sectionsQuality = await prisma.section.findMany({
    include: {
      course: {
        select: {
          slug: true,
          name: true,
          program: { select: { slug: true, name: true } }
        }
      }
    },
    orderBy: [
      { courseId: "asc" },
      { order: "asc" }
    ]
  })

  // Fetch today's API usage logs (UTC günü — yerel saat kayması olmasın)
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const rawApiLogs = await prisma.apiUsageLog.findMany({
    where: { createdAt: { gte: startOfDay } },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  // Ders isimlerini getirmek için slugObjectId veya slug / tam yol eşlemesi
  const courseSlugs = Array.from(new Set(rawApiLogs.map(l => l.courseSlug).filter(Boolean))) as string[]
  
  const coursesForLogs = await prisma.course.findMany({
    select: {
      slug: true,
      name: true,
      program: { select: { name: true } }
    }
  })

  const apiLogs = rawApiLogs.map(log => ({
    ...log,
    courseFullName: resolveApiLogCourseFullName(log.courseSlug, coursesForLogs),
  }))

  const totalUsers = users.length
  const activeToday = users.filter(u => new Date(u.lastActiveAt).toDateString() === new Date().toDateString()).length
  const totalMockExams = users.reduce((acc, u) => acc + u._count.mockResults, 0)

  const stats = {
    totalUsers,
    activeToday,
    totalMockExams
  }

  const systemKeys = (process.env.GEMINI_API_KEYS || "").split(",").map(k => k.trim()).filter(k => k.length > 0)
  const apiSummary = await getApiUsageDaySummary(systemKeys.length)

  return (
    <AdminClient 
      users={users} 
      reportedQuestions={reportedQuestions} 
      sectionsQuality={sectionsQuality} 
      stats={stats} 
      apiLogs={apiLogs}
      apiSummary={apiSummary}
      systemKeys={systemKeys}
    />
  )
}
