import { describe, it, expect } from "vitest"
import {
  parseMarkdownHeadingAnchors,
  buildCharSlicesFromAnchors,
  validateCharSliceRanges,
  resolveCharSlicesForSection,
} from "@/lib/char-slice-resolver"
import { getEffectiveRawContent } from "@/lib/effective-raw-content"

const OCR_PREFIX = "[MARKDOWN_OCR_SUCCESS]\n[VISUAL_OCR_COMPLETE]\n\n"

describe("char-slice-resolver", () => {
  it("sayfa ortasındaki ## başlıklardan alt konu dilimleri üretir", () => {
    const body = `${"Bu paragraf giriş metnidir ve minimum eşiği aşmak için tekrarlanır. ".repeat(12)}

## Risk Yönetimi Çerçevesi
${"Risk tanımı, kapsamı ve örnekleri bu bölümde anlatılır. ".repeat(15)}

## İç Kontrol Süreçleri
${"İç kontrol adımları, sorumluluklar ve denetim noktaları burada açıklanır. ".repeat(15)}

## Raporlama Yükümlülükleri
${"Raporlama takvimi, formatı ve onay süreçleri son bölümde yer alır. ".repeat(15)}`

    const raw = OCR_PREFIX + body
    const anchors = parseMarkdownHeadingAnchors(raw)
    expect(anchors.length).toBeGreaterThanOrEqual(3)

    const slices = buildCharSlicesFromAnchors(anchors, raw.length)
    expect(slices.length).toBeGreaterThanOrEqual(2)

    const validation = validateCharSliceRanges(slices, raw.length)
    expect(validation.valid).toBe(true)

    const resolved = resolveCharSlicesForSection(raw)
    expect(resolved.validation.valid).toBe(true)
    expect(resolved.slices[0].title).toMatch(/Risk Yönetimi/i)
    expect(resolved.slices[1].title).toMatch(/İç Kontrol/i)
  })

  it("örtüşen veya çok kısa dilimler doğrulamadan geçemez", () => {
    const bad = [
      { title: "A", charStart: 0, charEnd: 50, anchorHeading: "## A", anchorLevel: 2 },
      { title: "B", charStart: 40, charEnd: 60, anchorHeading: "## B", anchorLevel: 2 },
    ]
    const validation = validateCharSliceRanges(bad, 200)
    expect(validation.valid).toBe(false)
    expect(validation.errors.some((e) => e.includes("örtüş"))).toBe(true)
  })

  it("getEffectiveRawContent char_range diliminde kesilmiş metni döndürür", () => {
    const sliced = "Sadece bu alt konu metni burada."
    const effective = getEffectiveRawContent({
      rawContent: sliced,
      sliceKind: "char_range",
      charStart: 100,
      charEnd: 200,
    })
    expect(effective).toBe(sliced)
  })
})
