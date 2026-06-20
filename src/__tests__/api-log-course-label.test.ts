import { describe, it, expect } from "vitest"
import { resolveApiLogCourseFullName } from "@/lib/api-log-course-label"

const ZELIHA_PROGRAM = "Zeliha — Mevzuat Gelişim Alanı"

const courses = [
  {
    slug: "zeliha-bankacilik-kanunu",
    name: "Bankacılık Kanunu ve Temel Düzenlemeler",
    program: { name: ZELIHA_PROGRAM },
  },
  {
    slug: "zeliha-kvkk-prosedur",
    name: "Kişisel Verilerin Korunması Prosedürü",
    program: { name: ZELIHA_PROGRAM },
  },
  {
    slug: "bd-bilgi-sistemleri-guvenligi",
    name: "Bilgi Sistemleri Güvenliği",
    program: { name: "BSBD — Bilgi Sistemleri Bağımsız Denetim Lisansı" },
  },
]

describe("resolveApiLogCourseFullName", () => {
  it("slug ile eşleşir — bankacılığa karışmaz", () => {
    expect(resolveApiLogCourseFullName("zeliha-kvkk-prosedur", courses)).toBe(
      `${ZELIHA_PROGRAM} > Kişisel Verilerin Korunması Prosedürü`,
    )
  })

  it("OCR tam yol metnini prosedüre yazar, bankacılığa değil", () => {
    const ocrPath = `${ZELIHA_PROGRAM} > Kişisel Verilerin Korunması Prosedürü > Kişisel Verilerin Korunması Prosedürü (OCR)`
    const label = resolveApiLogCourseFullName(ocrPath, courses)
    expect(label).toContain("Kişisel Verilerin Korunması Prosedürü")
    expect(label).not.toContain("Bankacılık")
  })

  it("program adı tek başına bankacılık eşleşmesi yapmaz", () => {
    const label = resolveApiLogCourseFullName(ZELIHA_PROGRAM, courses)
    expect(label).toBe(ZELIHA_PROGRAM)
    expect(label).not.toContain("Bankacılık")
  })
})
