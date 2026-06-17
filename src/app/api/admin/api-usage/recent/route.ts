import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 })
  }

  // Son 100 kayıt — tarih filtresi yok (timezone kayması olmasın)
  const rawApiLogs = await prisma.apiUsageLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const courseSlugs = Array.from(new Set(rawApiLogs.map((l) => l.courseSlug).filter(Boolean))) as string[]
  const coursesForLogs = courseSlugs.length
    ? await prisma.course.findMany({
        where: { slug: { in: courseSlugs } },
        select: { slug: true, name: true, program: { select: { name: true } } },
      })
    : []

  const courseMap = new Map<string, string>()
  for (const c of coursesForLogs) {
    courseMap.set(c.slug, c.program?.name ? `${c.program.name} > ${c.name}` : c.name)
  }

  const logs = rawApiLogs.map((log) => ({
    ...log,
    courseFullName: log.courseSlug
      ? courseMap.get(log.courseSlug) || log.courseSlug
      : null,
  }))

  return NextResponse.json({ logs, total: logs.length, fetchedAt: new Date().toISOString() })
}
