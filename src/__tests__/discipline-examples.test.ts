import { describe, expect, it } from "vitest"
import {
  getCourseModuleLabel,
  getDisciplineExamples,
  getExamIntelligence,
} from "@/lib/ai-service"

describe("getCourseModuleLabel", () => {
  it("program > ders formatından modül adını çıkarır", () => {
    expect(
      getCourseModuleLabel("Zeliha — Mevzuat Gelişim Alanı > Kişisel Verilerin Korunması Kanunu"),
    ).toBe("Kişisel Verilerin Korunması Kanunu")
  })
})

describe("getDisciplineExamples", () => {
  it("mevzuat modunda pozitif örnekler ders kapsamına yönlendirir", () => {
    const disc = getDisciplineExamples(
      false,
      false,
      "mevzuat",
      "Zeliha > Kişisel Verilerin Korunması Kanunu",
    )
    expect(disc.disciplineName).toBe("Kişisel Verilerin Korunması Kanunu")
    expect(disc.analogies).toMatch(/veri sorumlusu|açık rıza/i)
    expect(disc.stories).toMatch(/Kaynak metindeki kural/)
    expect(disc.analogies).toMatch(/YASAK/)
  })

  it("finance modunda finans örnekleri korunur", () => {
    const disc = getDisciplineExamples(false, false, "finance", "SPL > Sermaye Piyasası")
    expect(disc.analogies).toMatch(/Pay Senedi|Portföy/)
  })
})

describe("getExamIntelligence mevzuat", () => {
  it("modül adına göre alan uyumu kuralı içerir", () => {
    const rules = getExamIntelligence(
      "mevzuat",
      "Zeliha > Kambiyo Mevzuatı",
    )
    expect(rules).toMatch(/Kambiyo Mevzuatı/)
    expect(rules).toMatch(/ihraççı|pay senedi/i)
    expect(rules).toMatch(/YALNIZCA|KULLANMA/)
  })
})
