/** API kotası koruma sabitleri — test edilebilir tek kaynak */

export const PROCESS_TRIGGER_DEBOUNCE_MS = 60_000
export const RECENT_API_ACTIVITY_MS = 4 * 60_000
export const MAX_NOTES_GENERATION_RETRIES = 5
export const MAX_SECTION_OUTER_RETRIES = 3
export const MAX_QUOTA_FAILURES_PER_SECTION = 2
export const MAX_OCR_ROUTE_ATTEMPTS = 2
/** OCR parça başına: 1 ilk deneme + 2 yeniden deneme */
export const MAX_CHUNK_OCR_ATTEMPTS = 3

export function isAdminSession(user: unknown): boolean {
  return Boolean(
    user &&
      typeof user === "object" &&
      (user as { role?: string }).role === "admin",
  )
}

export function sectionsLookValid(
  sections: Array<{ pageStart: number; pageEnd: number; title: string }>,
): boolean {
  if (sections.length === 0) return false
  return sections.every(
    (s) =>
      s.pageStart >= 1 &&
      s.pageEnd >= s.pageStart &&
      s.title.trim().length > 0,
  )
}

export type ProcessTriggerDebounceInput = {
  workerLive: boolean
  courseStatus: string
  hasFreshHeartbeat: boolean
}

/** 60 sn debounce yalnızca gerçekten çalışan işçi veya taze heartbeat varken uygulanır. */
export function shouldApplyProcessTriggerDebounce(
  input: ProcessTriggerDebounceInput,
): boolean {
  if (input.workerLive) return true
  if (
    (input.courseStatus === "processing" || input.courseStatus === "uploading") &&
    input.hasFreshHeartbeat
  ) {
    return true
  }
  return false
}

export function computeDebounceRemainingMs(
  lastTriggerAt: Date,
  now = Date.now(),
): number {
  const elapsed = now - lastTriggerAt.getTime()
  return Math.max(0, PROCESS_TRIGGER_DEBOUNCE_MS - elapsed)
}

export function debounceUntilIso(lastTriggerAt: Date): string {
  return new Date(lastTriggerAt.getTime() + PROCESS_TRIGGER_DEBOUNCE_MS).toISOString()
}
