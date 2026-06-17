import { describe, it, expect } from "vitest"
import {
  PROGRAM_CATALOG,
  READY_PROGRAM_SLUGS,
  getProgramBySlug,
  getReadyPrograms,
  getProgramSeedRows,
  getProgramGridLabel,
  getProgramCardUnit,
  getCourseCardBadge,
  getCourseCardCta,
} from "@/lib/program-catalog"

describe("program-catalog", () => {
  it("6 hazır program tanımlı olmalı", () => {
    expect(getReadyPrograms()).toHaveLength(6)
    expect(READY_PROGRAM_SLUGS).toEqual([
      "spl-duzey-3",
      "masak",
      "spl-bagimsiz-denetim",
      "cisa",
      "cia",
      "smmm",
    ])
  })

  it("tüm kartlar aynı isim kalıbını kullanmalı (Başlık — Alt bilgi)", () => {
    for (const p of getReadyPrograms()) {
      expect(p.displayName).toMatch(/^.+ — .+$/)
      expect(p.dbName).toBe(p.displayName)
      expect(p.subtitle).toContain("·")
    }
  })

  it("CISA katalogda ve hazır olmalı", () => {
    const cisa = getProgramBySlug("cisa")
    expect(cisa).toBeDefined()
    expect(cisa?.ready).toBe(true)
    expect(cisa?.displayName).toContain("CISA —")
    expect(cisa?.subtitle).toContain("1 oturum")
  })

  it("grid etiketleri gerçek sınav yapısını yansıtmalı", () => {
    expect(getProgramGridLabel("spl-duzey-3")).toBe("12 Ders")
    expect(getProgramGridLabel("cia")).toBe("3 Parça")
    expect(getProgramGridLabel("cisa")).toBe("1 Oturum")
    expect(getProgramGridLabel("spl-bagimsiz-denetim")).toBe("5 Ders")
    expect(getProgramGridLabel("smmm")).toBe("8 Ders")
    expect(getProgramGridLabel("masak")).toBe("1 Ders")
  })

  it("kart rozetleri program birimine göre yeknesak olmalı", () => {
    expect(getProgramCardUnit("spl-duzey-3")).toBe("ders")
    expect(getProgramCardUnit("cia")).toBe("parça")
    expect(getProgramCardUnit("cisa")).toBe("oturum")
    expect(getCourseCardBadge("spl-duzey-3", 3)).toBe("Ders 3")
    expect(getCourseCardBadge("cia", 2)).toBe("Parça 2")
    expect(getCourseCardBadge("cisa", 1)).toBe("Oturum")
    expect(getCourseCardBadge("masak", 1)).toBe("Ders")
    expect(getCourseCardCta("cia")).toBe("Parçaya Git")
    expect(getCourseCardCta("cisa")).toBe("Oturuma Git")
    expect(getCourseCardCta("masak")).toBe("Derse Git")
  })

  it("seed satırları katalog ile eşleşmeli", () => {
    const rows = getProgramSeedRows()
    expect(rows.length).toBe(PROGRAM_CATALOG.length)
    for (const row of rows) {
      const cat = getProgramBySlug(row.slug)
      expect(cat?.dbName).toBe(row.name)
      expect(cat?.dbDescription).toBe(row.description)
      expect(cat?.aiMode).toBe(row.aiMode)
    }
  })

  it("slug benzersiz olmalı", () => {
    const slugs = PROGRAM_CATALOG.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
