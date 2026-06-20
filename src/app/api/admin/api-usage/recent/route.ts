import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { prisma } from "@/lib/prisma"
import { resolveApiLogCourseFullName } from "@/lib/api-log-course-label"
import { getApiUsageDaySummary } from "@/lib/api-usage-summary"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 })
  }

  const systemKeyCount = (process.env.GEMINI_API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean).length

  const summary = await getApiUsageDaySummary(systemKeyCount)

  // Son 100 kayıt — tablo akışı için (üst özet kartları summary'den gelir)
  const rawApiLogs = await prisma.apiUsageLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const coursesForLogs = await prisma.course.findMany({
    select: { slug: true, name: true, program: { select: { name: true } } },
  })

  const logs = rawApiLogs.map((log) => ({
    ...log,
    courseFullName: resolveApiLogCourseFullName(log.courseSlug, coursesForLogs),
  }))

  return NextResponse.json({
    logs,
    summary,
    todayTotal: summary.todayTotal,
    recentCount: logs.length,
    fetchedAt: new Date().toISOString(),
  })
}
