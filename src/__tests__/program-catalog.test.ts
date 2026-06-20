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
  getProcessButtonLabel,
  getProcessBannerHint,
  getNotesGenerationPhaseLabel,
  adaptProcessingPhaseLabel,
  isProfessionalProgram,
} from "@/lib/program-catalog"

describe("program-catalog", () => {
  it("7 hazır program tanımlı olmalı (Zeliha dahil)", () => {
    expect(getReadyPrograms()).toHaveLength(7)
    expect(READY_PROGRAM_SLUGS).toContain("zeliha-mevzuat")
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
    expect(getProgramGridLabel("zeliha-mevzuat")).toBe("7 Mevzuat Modülü")
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

  it("işlem butonu metinleri duruma göre tutarlı olmalı", () => {
    expect(getProcessButtonLabel({ status: "uploaded" }, false)).toBe("İşleme Başlat")
    expect(getProcessButtonLabel({ status: "uploaded" }, true)).toBe("Çalışıyor...")
    expect(getProcessButtonLabel({ status: "error", sections: [{ id: 1 }] }, false)).toBe("Devam Ettir")
    expect(getProcessButtonLabel({ status: "ready" }, false)).toBe("Yeniden Tara")
    expect(getProcessBannerHint({ status: "uploaded" })).toContain("İşleme Başlat")
    expect(getProcessBannerHint({ status: "paused", sections: [{ id: 1 }] })).toContain("Devam Ettir")
  })

  it("Zeliha işleme aşamasında Çalışma Notları kullanmalı", () => {
    expect(isProfessionalProgram("zeliha-mevzuat")).toBe(true)
    expect(getNotesGenerationPhaseLabel(true, "1/1", 1)).toBe(
      "1/1. Aşama 2: Çalışma Notları üretiliyor (Deneme #1)",
    )
    expect(getNotesGenerationPhaseLabel(false, "2/5", 3)).toBe(
      "2/5. Aşama 2: Ders Notları Üretiliyor (Deneme #3)",
    )
  })

  it("adaptProcessingPhaseLabel eski Ders metinlerini Zeliha için düzeltmeli", () => {
    const legacy = "1/1. Aşama 2: Ders Notları Üretiliyor (Deneme #1)"
    expect(adaptProcessingPhaseLabel(legacy, "zeliha-mevzuat")).toBe(
      "1/1. Aşama 2: Çalışma Notları üretiliyor (Deneme #1)",
    )
    expect(adaptProcessingPhaseLabel(legacy, "spl-duzey-3")).toBe(legacy)
  })
})
