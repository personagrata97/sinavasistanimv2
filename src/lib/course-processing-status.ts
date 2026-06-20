import { prisma } from "@/lib/prisma"
import { shouldRunMarkdownOcr } from "@/lib/pdf-engine"
import {
  computeDebounceRemainingMs,
  PROCESS_TRIGGER_DEBOUNCE_MS,
  shouldApplyProcessTriggerDebounce,
} from "@/lib/quota-guard"
import {
  getHeartbeatEntry,
  hasFreshHeartbeat,
  isHeartbeatStale,
  isWorkerLive,
} from "@/lib/process-registry"

export const HEARTBEAT_PAGE_LEFT_MESSAGE =
  "Not üretim sayfasından ayrıldınız — «Devam Ettir» ile sürdürebilirsiniz."
export const HEARTBEAT_STALE_MESSAGE =
  "Canlılık sinyali kesildi — «Devam Ettir» ile sürdürebilirsiniz."

/** Yeni başlatılan / zorla devam eden iş — hayalet ve zombi dedektörü bu süre boyunca bekler. */
export const PROCESS_START_GRACE_MS = 30_000

/** Son PROCESS_START_GRACE_MS içinde kullanıcı veya zorla tetikleme var mı? */
export async function hasRecentExplicitProcessStart(slug: string): Promise<boolean> {
  const hit = await prisma.processTriggerLog.findFirst({
    where: {
      courseSlug: slug,
      createdAt: { gte: new Date(Date.now() - PROCESS_START_GRACE_MS) },
    },
    select: { id: true },
  })
  return !!hit
}

export type LiveProcessingState = {
  status: string
  workerLive: boolean
  needsPause: boolean
  pauseReason?: string
  pauseMessage?: string
}

/** DB processing/uploading iken bellek + heartbeat ile gerçek durumu çöz. */
export function resolveLiveProcessingState(dbStatus: string, slug: string): LiveProcessingState {
  if (dbStatus !== "processing" && dbStatus !== "uploading") {
    return { status: dbStatus, workerLive: false, needsPause: false }
  }

  if (isWorkerLive(slug)) {
    return { status: dbStatus, workerLive: true, needsPause: false }
  }

  const entry = getHeartbeatEntry(slug)
  const pauseReason = !entry ? "page_left" : isHeartbeatStale(slug) ? "heartbeat_stale" : "worker_dead"
  const pauseMessage =
    pauseReason === "page_left" ? HEARTBEAT_PAGE_LEFT_MESSAGE : HEARTBEAT_STALE_MESSAGE

  return {
    status: "paused",
    workerLive: false,
    needsPause: true,
    pauseReason,
    pauseMessage,
  }
}

export { hasFreshHeartbeat, isWorkerLive }

/** Duraklatma/iptal sonrası eski tetikleme kayıtlarını temizle — haksız debounce engeli kalkar. */
export async function clearProcessTriggerDebounce(slug: string): Promise<void> {
  const since = new Date(Date.now() - PROCESS_TRIGGER_DEBOUNCE_MS)
  await prisma.processTriggerLog.deleteMany({
    where: { courseSlug: slug, createdAt: { gte: since } },
  })
}

export type TriggerDebounceState = {
  remainingMs: number
  retryAfterSeconds: number
  debounceUntil: string | null
}

/** Status API ve kart için: debounce gerçekten aktif mi? */
export async function resolveTriggerDebounceState(
  slug: string,
  courseStatus: string,
): Promise<TriggerDebounceState> {
  const workerLive = isWorkerLive(slug)
  const hasHeartbeat = hasFreshHeartbeat(slug)
  const shouldDebounce = shouldApplyProcessTriggerDebounce({
    workerLive,
    courseStatus,
    hasFreshHeartbeat: hasHeartbeat,
  })

  if (!shouldDebounce) {
    return { remainingMs: 0, retryAfterSeconds: 0, debounceUntil: null }
  }

  const recentTrigger = await prisma.processTriggerLog.findFirst({
    where: {
      courseSlug: slug,
      createdAt: { gte: new Date(Date.now() - PROCESS_TRIGGER_DEBOUNCE_MS) },
    },
    orderBy: { createdAt: "desc" },
  })

  if (!recentTrigger) {
    return { remainingMs: 0, retryAfterSeconds: 0, debounceUntil: null }
  }

  const remainingMs = computeDebounceRemainingMs(recentTrigger.createdAt)
  if (remainingMs <= 0) {
    return { remainingMs: 0, retryAfterSeconds: 0, debounceUntil: null }
  }

  return {
    remainingMs,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    debounceUntil: new Date(
      recentTrigger.createdAt.getTime() + PROCESS_TRIGGER_DEBOUNCE_MS,
    ).toISOString(),
  }
}

/** Hayalet işlemi DB'de duraklat — UI ile backend uyumlu kalsın. */
export async function pauseGhostProcessingInDb(
  courseId: string,
  slug: string,
  pauseMessage: string,
  pauseReason: string,
): Promise<void> {
  const pendingSection = await prisma.section.findFirst({
    where: { courseId, processed: false },
    orderBy: { order: "asc" },
    select: { id: true },
  })
  if (pendingSection) {
    await prisma.section.update({
      where: { id: pendingSection.id },
      data: {
        verificationIssues: JSON.stringify({
          currentMicroPhase: pauseMessage,
          pauseReason,
          pausedAt: new Date().toISOString(),
        }),
      },
    })
  }
  await prisma.course.update({
    where: { slug },
    data: { status: "paused", updatedAt: new Date() },
  })
  await clearProcessTriggerDebounce(slug)
}

export type ProcessingProgressInput = {
  courseStatus: string
  totalPages: number
  processedPages: number
  totalSections: number
  processedSections: number
  currentMicroPhase?: string | null
}

export function sectionRawContentReady(rawContent: string | null | undefined): boolean {
  if (!rawContent || rawContent.trim().length < 100) return false
  return !shouldRunMarkdownOcr(rawContent)
}

/** Mevcut bölüm içinde mikro-aşamaya göre 0–1 arası ilerleme payı */
export function inferMicroPhaseFraction(microPhase: string): number {
  const p = microPhase.toLowerCase()

  if (
    p.includes("pdf metne") ||
    p.includes("ocr") ||
    p.includes("aşama 1") ||
    p.includes("ham içerik")
  ) {
    return 0.1
  }
  if (
    p.includes("aşama 2") ||
    p.includes("notları üretiliyor") ||
    p.includes("notları çıkarılıyor") ||
    p.includes("çalışma notları") ||
    p.includes("ders notları")
  ) {
    return 0.32
  }
  if (p.includes("cerrahi yama") || p.includes("yama iptal") || p.includes("konu yeniden")) {
    return 0.4
  }
  if (p.includes("aşama 3") || p.includes("kalite kontrolörü") || p.includes("kontrolör")) {
    return 0.52
  }
  if (
    p.includes("aşama 4") ||
    p.includes("müfettiş") ||
    p.includes("başmüfettiş") ||
    p.includes("deep audit") ||
    p.includes("denetimi")
  ) {
    return 0.65
  }
  if (p.includes("flashcard") || p.includes("bilgi kart") || p.includes("hazırlık")) {
    return 0.78
  }
  if (p.includes("rotalama") || p.includes("soru havuzu") || p.includes("soru üret")) {
    return 0.88
  }
  if (p.includes("çevirisi") || p.includes("onay") || p.includes("tamamlandı")) {
    return 0.95
  }

  return 0.25
}

export function isOcrLikeMicroPhase(microPhase: string): boolean {
  const p = microPhase.toLowerCase()
  return (
    p.includes("pdf metne") ||
    p.includes("ocr") ||
    p.includes("aşama 1") ||
    p.includes("ham içerik") ||
    /sayfa\s+\d/.test(p)
  )
}

export function getNotesWritingLabel(isProfessional: boolean): string {
  return isProfessional
    ? "Çalışma notları yazılıyor — bu birkaç dakika sürebilir"
    : "Ders notları yazılıyor — bu birkaç dakika sürebilir"
}

export function sanitizePhaseLabel(
  microPhase: string,
  opts: { isProfessional: boolean; rawContentReady: boolean },
): string {
  const lower = microPhase.toLowerCase()

  if (opts.rawContentReady && isOcrLikeMicroPhase(microPhase)) {
    return getNotesWritingLabel(opts.isProfessional)
  }

  if (
    opts.isProfessional &&
    (lower.includes("aşama 2") ||
      lower.includes("notları üretiliyor") ||
      lower.includes("ders notları"))
  ) {
    return getNotesWritingLabel(true)
  }

  if (opts.isProfessional) {
    return microPhase
      .replace(/Ders Notları/g, "Çalışma Notları")
      .replace(/Ders notları/g, "Çalışma notları")
  }

  return microPhase
}

export function computeProcessingProgress(input: ProcessingProgressInput): number {
  const {
    courseStatus,
    totalPages,
    processedPages,
    totalSections,
    processedSections,
    currentMicroPhase,
  } = input

  if (courseStatus === "ready") return 100
  if (totalPages <= 0) return 0

  if (courseStatus === "processing" && totalSections === 0) {
    const pagesDone = processedPages >= totalPages
    if (pagesDone) return 38
    return Math.round((processedPages / totalPages) * 38)
  }

  if (totalSections > 0) {
    if (courseStatus === "processing" && processedSections >= totalSections) {
      return 92
    }

    const sectionShare = 50 / totalSections
    const completedShare = processedSections * sectionShare
    let currentShare = 0

    if (processedSections < totalSections) {
      const fraction = currentMicroPhase
        ? inferMicroPhaseFraction(currentMicroPhase)
        : 0.2
      currentShare = fraction * sectionShare
    }

    return Math.min(99, Math.round(40 + completedShare + currentShare))
  }

  return 0
}
