import { describe, it, expect } from "vitest"
import { getEffectiveRawContent } from "@/lib/effective-raw-content"

describe("effective-raw-content", () => {
  it("null char alanlarında tam metni döndürür (eski davranış)", () => {
    const raw = "[MARKDOWN_OCR_SUCCESS]\n\nTam bölüm metni burada."
    expect(getEffectiveRawContent({ rawContent: raw })).toBe("Tam bölüm metni burada.")
  })

  it("charStart/charEnd ile dilim keser", () => {
    const raw = "AAAA## Başlık\nDilim metni BBBB"
    const start = raw.indexOf("Dilim")
    const end = raw.indexOf("BBBB") + 4
    const effective = getEffectiveRawContent({
      rawContent: raw,
      charStart: start,
      charEnd: end,
    })
    expect(effective).toBe("Dilim metni BBBB")
  })
})
