import { describe, it, expect } from "vitest"
import { OCR_MODEL } from "@/lib/ai-service"
import {
  SCANNED_PDF_PENDING_OCR,
  shouldRunMarkdownOcr,
  stampNativeTextAsReady,
  hasOcrSuccessFlag,
  hasVisualOcrComplete,
  prepareSearchablePdfSectionContent,
  assessPdfSearchability,
  joinPageTextsForRange,
  NATIVE_TEXT_LOG_MESSAGE,
  SEARCHABLE_PDF_MIN_TOTAL_CHARS,
  MARKDOWN_OCR_SUCCESS_PREFIX,
  VISUAL_OCR_COMPLETE_PREFIX,
} from "@/lib/pdf-engine"

describe("OCR routing — görsel okuma asla tamamen kapanmaz", () => {
  const kvkkLikeContent = "KİŞİSEL VERİLERİN KORUNMASI PROSEDÜRÜ\n".repeat(800)

  it("PDF OCR gemini-3.5-flash kullanır (2.5 değil)", () => {
    expect(OCR_MODEL).toBe("gemini-3.5-flash")
    expect(OCR_MODEL).not.toBe("gemini-2.5-flash")
  })

  it("28628-char yerel metin (damga yok) → görsel OCR gerekli", () => {
    expect(kvkkLikeContent.length).toBeGreaterThan(28000)
    expect(shouldRunMarkdownOcr(kvkkLikeContent)).toBe(true)
  })

  it("searchable PDF ilk yükleme: yerel metin damgasız kalır, OCR gerekir", () => {
    const prepared = prepareSearchablePdfSectionContent(kvkkLikeContent)
    expect(hasOcrSuccessFlag(prepared)).toBe(false)
    expect(shouldRunMarkdownOcr(prepared)).toBe(true)
  })

  it("Devam Ettir: görsel OCR tamamlandıysa (her iki damga) tekrar OCR atlanır", () => {
    const stamped = `${MARKDOWN_OCR_SUCCESS_PREFIX}\n${VISUAL_OCR_COMPLETE_PREFIX}\n\n${kvkkLikeContent}`
    expect(hasOcrSuccessFlag(stamped)).toBe(true)
    expect(hasVisualOcrComplete(stamped)).toBe(true)
    expect(shouldRunMarkdownOcr(stamped)).toBe(false)
  })

  it("stampNativeTextAsReady sahte OCR damgası basmaz", () => {
    const prepared = stampNativeTextAsReady(kvkkLikeContent)
    expect(hasOcrSuccessFlag(prepared)).toBe(false)
    expect(shouldRunMarkdownOcr(prepared)).toBe(true)
  })

  it("taranmış PDF placeholder → OCR gerekli (atlanmaz)", () => {
    expect(shouldRunMarkdownOcr(SCANNED_PDF_PENDING_OCR)).toBe(true)
  })

  it("çok kısa metin → OCR gerekli (atlanmaz)", () => {
    expect(shouldRunMarkdownOcr("kısa")).toBe(true)
  })
})

describe("assessPdfSearchability — b5138551 KVKK prosedür kanıtı", () => {
  it("16 sayfa × ~1789 karakter/sayfa → aranabilir (yükleme geçer, görsel OCR yine çalışır)", () => {
    const pages = Array.from({ length: 16 }, () => "KİŞİSEL VERİLERİN KORUNMASI PROSEDÜRÜ metni. ".repeat(50))
    const total = pages.reduce((s, p) => s + p.length, 0)
    expect(total).toBeGreaterThan(28000)

    const result = assessPdfSearchability(pages)
    expect(result.isSearchable).toBe(true)
    expect(result.isNonSearchable).toBe(false)
    expect(result.totalChars).toBeGreaterThan(SEARCHABLE_PDF_MIN_TOTAL_CHARS)
    expect(result.avgCharsPerPage).toBeGreaterThan(50)
    expect(result.nonEmptyPages).toBe(16)
  })

  it("taranmış PDF (16 sayfa, toplam 40 karakter) → aranabilir değil", () => {
    const pages = Array.from({ length: 16 }, () => "")
    const result = assessPdfSearchability(pages)
    expect(result.isSearchable).toBe(false)
    expect(result.isNonSearchable).toBe(true)
  })

  it("joinPageTextsForRange tam belge metnini birleştirir", () => {
    const pages = ["Sayfa 1", "Sayfa 2", "Sayfa 3"]
    expect(joinPageTextsForRange(pages, 1, 3)).toBe("Sayfa 1\n\nSayfa 2\n\nSayfa 3")
    expect(joinPageTextsForRange(pages, 2, 2)).toBe("Sayfa 2")
  })

  it("NATIVE_TEXT_LOG_MESSAGE görsel okumanın devam edeceğini belirtir", () => {
    expect(NATIVE_TEXT_LOG_MESSAGE).toContain("yerel metin")
    expect(NATIVE_TEXT_LOG_MESSAGE).not.toContain("görsel okuma yok")
    expect(NATIVE_TEXT_LOG_MESSAGE).toMatch(/görsel okuma/i)
  })
})
