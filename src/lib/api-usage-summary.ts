import { prisma } from "./prisma"

export type ApiUsageDaySummary = {
  todayTotal: number
  today429: number
  todaySuccess: number
  deadKeysCount: number
  healthyKeysCount: number
  keysOverQuota: number
  activeKeyCount: number
}

function startOfUtcDay(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Admin üst özet kartları — bugünkü gerçek DB sayıları (liste sınırı yok). */
export async function getApiUsageDaySummary(activeKeyCount: number): Promise<ApiUsageDaySummary> {
  const since = startOfUtcDay()

  const todayWhere = { createdAt: { gte: since } }

  const [todayTotal, today429, todaySuccess, deadKeyRows, successRows] = await Promise.all([
    prisma.apiUsageLog.count({ where: todayWhere }),
    prisma.apiUsageLog.count({ where: { ...todayWhere, status: "RATE_LIMIT_429" } }),
    prisma.apiUsageLog.count({ where: { ...todayWhere, status: "SUCCESS" } }),
    prisma.apiUsageLog.findMany({
      where: { ...todayWhere, status: "FORBIDDEN_403" },
      select: { apiKey: true },
      distinct: ["apiKey"],
    }),
    prisma.apiUsageLog.findMany({
      where: { ...todayWhere, status: "SUCCESS" },
      select: { apiKey: true },
    }),
  ])

  const deadKeysCount = deadKeyRows.length

  const successByKey = successRows.reduce<Record<string, number>>((acc, log) => {
    acc[log.apiKey] = (acc[log.apiKey] || 0) + 1
    return acc
  }, {})

  const keysOverQuota = Object.values(successByKey).filter((n) => n >= 1500).length
  const healthyKeysCount = Math.max(0, activeKeyCount - keysOverQuota - deadKeysCount)

  return {
    todayTotal,
    today429,
    todaySuccess,
    deadKeysCount,
    healthyKeysCount,
    keysOverQuota,
    activeKeyCount,
  }
}
