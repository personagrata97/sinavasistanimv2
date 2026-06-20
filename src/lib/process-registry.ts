// Global işlem yönetim kayıtları (Next.js server hafızasında kalır)
export const activeProcesses = new Set<string>()
export const cancelledProcesses = new Set<string>()

/** Eski işlemler bu süreden sonra otomatik devam etmez — kullanıcı butona basmalı. */
export const STALE_PROCESS_MAX_AGE_MS = 2 * 60 * 60 * 1000 // 2 saat

/** Sekme açıkken (arka plan dahil) bu süre heartbeat gelmezse işlem duraklar.
 *  Tarayıcılar arka plan sekmelerinde setInterval'ı ~60sn'ye yavaşlatır.
 *  5 dakika = tarayıcı throttle'ını rahatlıkla tolere eder.
 *  Sekme kapatma/sayfa terk etme zaten beforeunload/pagehide ile ayrıca yakalanır. */
export const HEARTBEAT_STALE_VISIBLE_MS = 300_000

export type HeartbeatEntry = { lastAt: number; visible: boolean }

function getHeartbeatStore(): Record<string, HeartbeatEntry> {
  const g = global as typeof globalThis & { courseHeartbeats?: Record<string, HeartbeatEntry> }
  if (!g.courseHeartbeats) g.courseHeartbeats = {}
  return g.courseHeartbeats
}

export function recordHeartbeat(slug: string, visible = true) {
  getHeartbeatStore()[slug] = { lastAt: Date.now(), visible }
}

export function clearHeartbeat(slug: string) {
  delete getHeartbeatStore()[slug]
}

export function getHeartbeatEntry(slug: string): HeartbeatEntry | undefined {
  return getHeartbeatStore()[slug]
}

export function isHeartbeatStale(slug: string): boolean {
  const entry = getHeartbeatEntry(slug)
  if (!entry) return true
  const age = Date.now() - entry.lastAt
  return age > HEARTBEAT_STALE_VISIBLE_MS
}

/** Aktif işçi + taze heartbeat — gerçekten çalışıyor mu? */
export function hasFreshHeartbeat(slug: string): boolean {
  const entry = getHeartbeatEntry(slug)
  if (!entry) return false
  return !isHeartbeatStale(slug)
}

export function isWorkerLive(slug: string): boolean {
  return activeProcesses.has(slug) && hasFreshHeartbeat(slug)
}

function getGlobalSignals(): Record<string, boolean> {
  const g = global as typeof globalThis & { cancelSignals?: Record<string, boolean> }
  if (!g.cancelSignals) g.cancelSignals = {}
  return g.cancelSignals
}

export function setCancelSignal(slug: string, courseName?: string) {
  cancelledProcesses.add(slug)
  const signals = getGlobalSignals()
  signals[slug] = true
  if (courseName) signals[courseName] = true
}

export function clearCancelSignal(slug: string, courseName?: string) {
  cancelledProcesses.delete(slug)
  const signals = getGlobalSignals()
  signals[slug] = false
  if (courseName) signals[courseName] = false
}

export function isCancelled(slug: string, courseName?: string): boolean {
  if (cancelledProcesses.has(slug)) return true
  const signals = getGlobalSignals()
  if (signals[slug]) return true
  if (courseName && signals[courseName]) return true
  return false
}

/** Aynı anda yalnızca bir ders işlenebilir. */
export function getOtherActiveSlug(slug: string): string | undefined {
  return [...activeProcesses].find((s) => s !== slug)
}

export function tryClaimProcessing(slug: string): { ok: true } | { ok: false; blockedBy: string } {
  if (activeProcesses.has(slug)) return { ok: true }
  const other = getOtherActiveSlug(slug)
  if (other) return { ok: false, blockedBy: other }
  activeProcesses.add(slug)
  return { ok: true }
}

export function releaseProcessing(slug: string) {
  activeProcesses.delete(slug)
}

export function clearAllActiveProcessing() {
  activeProcesses.clear()
}

/** Arka plan işçisini durdur — veri silmez, yalnızca iptal sinyali gönderir. */
export function cancelCourseProcessing(slug: string, courseName?: string) {
  setCancelSignal(slug, courseName)
  releaseProcessing(slug)
}
