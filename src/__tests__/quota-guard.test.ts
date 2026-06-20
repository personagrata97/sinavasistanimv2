import { describe, it, expect } from "vitest"
import {
  isAdminSession,
  sectionsLookValid,
  MAX_NOTES_GENERATION_RETRIES,
  MAX_CHUNK_OCR_ATTEMPTS,
  PROCESS_TRIGGER_DEBOUNCE_MS,
  shouldApplyProcessTriggerDebounce,
  computeDebounceRemainingMs,
} from "@/lib/quota-guard"
import {
  shouldRunMarkdownOcr,
  hasOcrSuccessFlag,
  hasVisualOcrComplete,
  VISUAL_OCR_COMPLETE_PREFIX,
  MARKDOWN_OCR_SUCCESS_PREFIX,
} from "@/lib/pdf-engine"

describe("quota-guard helpers", () => {
  it("isAdminSession yalnızca admin rolünü tanır", () => {
    expect(isAdminSession({ role: "admin" })).toBe(true)
    expect(isAdminSession({ role: "user" })).toBe(false)
    expect(isAdminSession(null)).toBe(false)
  })

  it("sectionsLookValid geçerli sayfa aralığı ister", () => {
    expect(
      sectionsLookValid([
        { title: "Giriş", pageStart: 1, pageEnd: 10 },
        { title: "Konu", pageStart: 11, pageEnd: 20 },
      ]),
    ).toBe(true)
    expect(sectionsLookValid([{ title: "", pageStart: 1, pageEnd: 5 }])).toBe(false)
    expect(sectionsLookValid([{ title: "X", pageStart: 5, pageEnd: 3 }])).toBe(false)
  })

  it("kota limit sabitleri makul aralıkta", () => {
    expect(MAX_NOTES_GENERATION_RETRIES).toBeLessThanOrEqual(5)
    expect(MAX_CHUNK_OCR_ATTEMPTS).toBe(3)
    expect(PROCESS_TRIGGER_DEBOUNCE_MS).toBe(60_000)
  })

  it("shouldApplyProcessTriggerDebounce yalnızca canlı işçi veya taze heartbeat'te", () => {
    expect(
      shouldApplyProcessTriggerDebounce({
        workerLive: true,
        courseStatus: "paused",
        hasFreshHeartbeat: false,
      }),
    ).toBe(true)

    expect(
      shouldApplyProcessTriggerDebounce({
        workerLive: false,
        courseStatus: "processing",
        hasFreshHeartbeat: true,
      }),
    ).toBe(true)

    expect(
      shouldApplyProcessTriggerDebounce({
        workerLive: false,
        courseStatus: "paused",
        hasFreshHeartbeat: false,
      }),
    ).toBe(false)

    expect(
      shouldApplyProcessTriggerDebounce({
        workerLive: false,
        courseStatus: "processing",
        hasFreshHeartbeat: false,
      }),
    ).toBe(false)
  })

  it("computeDebounceRemainingMs geri sayım hesaplar", () => {
    const last = new Date(Date.now() - 40_000)
    const remaining = computeDebounceRemainingMs(last)
    expect(remaining).toBeGreaterThan(15_000)
    expect(remaining).toBeLessThanOrEqual(PROCESS_TRIGGER_DEBOUNCE_MS)
  })
})

describe("OCR damgası — çift kontrol", () => {
  const body = "KİŞİSEL VERİLERİN KORUNMASI PROSEDÜRÜ\n".repeat(100)

  it("yalnızca MARKDOWN_OCR_SUCCESS → yeniden OCR gerekir (sahte damga)", () => {
    const fake = `${MARKDOWN_OCR_SUCCESS_PREFIX}\n\n${body}`
    expect(hasOcrSuccessFlag(fake)).toBe(true)
    expect(hasVisualOcrComplete(fake)).toBe(false)
    expect(shouldRunMarkdownOcr(fake)).toBe(true)
  })

  it("her iki damga varsa OCR atlanır", () => {
    const real = `${MARKDOWN_OCR_SUCCESS_PREFIX}\n${VISUAL_OCR_COMPLETE_PREFIX}\n\n${body}`
    expect(shouldRunMarkdownOcr(real)).toBe(false)
  })
})
