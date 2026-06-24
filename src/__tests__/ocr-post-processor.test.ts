import { describe, it, expect } from "vitest"
import { postProcessOcrMarkdown } from "@/lib/ocr-post-processor"

describe("ocr-post-processor", () => {
  it("GÖRSEL İÇERİKLER bölümündeki öğeleri sayar", () => {
    const raw = `[MARKDOWN_OCR_SUCCESS]
[VISUAL_OCR_COMPLETE]

# Bölüm

Metin paragrafı.

[GÖRSEL İÇERİKLER]
- Şema 1: risk matrisi tablosu açıklaması burada uzun bir tarif olarak yer alır
- Şema 2: süreç akış diyagramı detaylı anlatımı burada uzun bir tarif olarak yer alır`

    const result = postProcessOcrMarkdown(raw)
    expect(result.metrics.hasVisualSection).toBe(true)
    expect(result.markdown).toContain("[MARKDOWN_OCR_SUCCESS]")
    expect(result.markdown).toContain("[VISUAL_OCR_COMPLETE]")
  })

  it("OCR damgalarını korur", () => {
    const raw = `[MARKDOWN_OCR_SUCCESS]
[VISUAL_OCR_COMPLETE]

Sadece metin.`
    const result = postProcessOcrMarkdown(raw)
    expect(result.markdown.startsWith("[MARKDOWN_OCR_SUCCESS]")).toBe(true)
    expect(result.metrics.charLength).toBeGreaterThan(0)
  })
})
