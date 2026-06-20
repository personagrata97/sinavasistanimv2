import { describe, it, expect } from "vitest"
import {
  getApiOperationLabel,
  getApiStatusLabel,
  getApiStatusTone,
} from "@/lib/api-operation-labels"

describe("api-operation-labels", () => {
  it("section_titles_text → Türkçe etiket", () => {
    expect(getApiOperationLabel("section_titles_text")).toBe("PDF bölüm başlıkları tespiti")
    expect(getApiOperationLabel("SECTION_TITLES_TEXT")).toBe("PDF bölüm başlıkları tespiti")
  })

  it("ocr_extraction_chunk → Türkçe etiket", () => {
    expect(getApiOperationLabel("ocr_extraction_chunk")).toBe("PDF okuma (OCR)")
  })

  it("WAITING → nötr bekleme etiketi", () => {
    expect(getApiStatusLabel("WAITING")).toBe("Bekleniyor (yoğunluk)")
    expect(getApiStatusTone("WAITING")).toBe("pending")
  })

  it("REQUEST → devam ediyor (nötr)", () => {
    expect(getApiStatusLabel("REQUEST")).toBe("Devam ediyor")
    expect(getApiStatusTone("REQUEST")).toBe("pending")
  })

  it("429 → uyarı tonu", () => {
    expect(getApiStatusTone("RATE_LIMIT_429")).toBe("warning")
  })

  it("gerçek hata → error tonu", () => {
    expect(getApiStatusTone("TIMEOUT")).toBe("error")
  })
})
