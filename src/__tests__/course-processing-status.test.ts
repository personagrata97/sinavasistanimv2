import { describe, expect, it } from "vitest"
import {
  computeProcessingProgress,
  hasRecentExplicitProcessStart,
  inferMicroPhaseFraction,
  PROCESS_START_GRACE_MS,
  sanitizePhaseLabel,
  sectionRawContentReady,
} from "@/lib/course-processing-status"
import { MARKDOWN_OCR_SUCCESS_PREFIX, VISUAL_OCR_COMPLETE_PREFIX } from "@/lib/pdf-engine"

describe("course-processing-status", () => {
  it("tek bölümde not aşamasında ilerleme %40'ta takılmamalı", () => {
    const progress = computeProcessingProgress({
      courseStatus: "processing",
      totalPages: 3,
      processedPages: 3,
      totalSections: 1,
      processedSections: 0,
      currentMicroPhase: "1/1. Aşama 2: Çalışma Notları üretiliyor (Deneme #1)",
    })
    expect(progress).toBeGreaterThan(45)
    expect(progress).toBeLessThan(70)
  })

  it("mikro-aşama yokken bile mevcut bölüm için kısmi ilerleme vermeli", () => {
    const progress = computeProcessingProgress({
      courseStatus: "processing",
      totalPages: 10,
      processedPages: 10,
      totalSections: 1,
      processedSections: 0,
      currentMicroPhase: null,
    })
    expect(progress).toBeGreaterThan(40)
  })

  it("görsel OCR tamamlandıysa OCR etiketini not yazımına çevirmeli (Zeliha)", () => {
    const raw = `${MARKDOWN_OCR_SUCCESS_PREFIX}\n${VISUAL_OCR_COMPLETE_PREFIX}\n\nUzun mevzuat metni `.repeat(200)
    expect(sectionRawContentReady(raw)).toBe(true)
    expect(
      sanitizePhaseLabel("1/1. PDF Metne Çevriliyor — sayfa 1-3", {
        isProfessional: true,
        rawContentReady: true,
      }),
    ).toBe("Çalışma notları yazılıyor — bu birkaç dakika sürebilir")
  })

  it("Aşama 2 için Zeliha'da dürüst bekleme metni göstermeli", () => {
    expect(
      sanitizePhaseLabel("1/1. Aşama 2: Ders Notları Üretiliyor (Deneme #1)", {
        isProfessional: true,
        rawContentReady: false,
      }),
    ).toBe("Çalışma notları yazılıyor — bu birkaç dakika sürebilir")
  })

  it("not üretimi aşaması OCR'dan daha ileri sayılmalı", () => {
    const ocr = inferMicroPhaseFraction("1/1. PDF Metne Çevriliyor")
    const notes = inferMicroPhaseFraction("1/1. Aşama 2: Çalışma Notları üretiliyor")
    expect(notes).toBeGreaterThan(ocr)
  })

  it("PROCESS_START_GRACE_MS yeni başlangıç koruması için makul süre olmalı", () => {
    expect(PROCESS_START_GRACE_MS).toBeGreaterThanOrEqual(20_000)
    expect(PROCESS_START_GRACE_MS).toBeLessThanOrEqual(60_000)
  })

  it("hasRecentExplicitProcessStart son tetikleme kaydını kontrol eder", async () => {
    const result = await hasRecentExplicitProcessStart("nonexistent-slug-test")
    expect(typeof result).toBe("boolean")
  })
})
