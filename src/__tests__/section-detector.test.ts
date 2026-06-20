import { describe, it, expect } from "vitest"
import {
  extractTitlesFromTocPages,
  detectSectionsDeterministic,
  validateSectionRanges,
  resolveSectionValidationLimits,
  anchorTitlesToPages,
  detectTocPages,
  buildSectionRangesFromAnchors,
  findBibliographyPageStart,
  shouldUseSingleSectionMode,
  buildSingleSectionFromPages,
  extractTitlesFromProcedureBody,
  anchorProcedureTitlesToPages,
} from "@/lib/section-detector"

const FILLER = "Bu sayfa ders kitabı gövde metni ile doldurulmuş sentetik içeriktir. ".repeat(8)

/** BD Güvenlik kitabının yapısını taklit eden 121 sayfalık fixture */
function buildBdGoldenFixture(): string[] {
  const pages = Array.from({ length: 121 }, (_, i) => `${FILLER} sayfa ${i + 1}`)

  pages[3] = `İÇİNDEKİLER
Kısaltmalar ................ 7
1. Bilgi Güvenliği Yönetimi ... 11
2. Varlık Yönetimi ... 21
3. Fiziksel ve Çevresel Güvenlik ... 26
4. Ağ Güvenliği ... 36
5. Erişim Güvenliği ... 49
6. Veri ve İz Kayıtlarının Güvenliği ... 69
7. Üçüncü Taraflarla İletişim Güvenliği ... 103`

  pages[6] = `KISALTMALAR\n${FILLER}`
  pages[10] = `1. Bilgi Güvenliği Yönetimi\n${FILLER}`
  pages[20] = `2. Varlık Yönetimi\n${FILLER}`
  pages[25] = `3. Fiziksel ve Çevresel Güvenlik\n${FILLER}`
  pages[35] = `4. Ağ Güvenliği\n${FILLER}`
  pages[48] = `5. Erişim Güvenliği\n${FILLER}`
  pages[68] = `6. Veri ve İz Kayıtlarının Güvenliği\n${FILLER}`
  pages[102] = `7. Üçüncü Taraflarla İletişim Güvenliği\n${FILLER}`
  pages[118] = `KAYNAKÇA\nReferans listesi`

  return pages
}

/** BS Güvenliği kitabı — beklenen fiziksel sayfa aralıkları (test doğrulama anahtarı) */
const BD_GOLDEN = [
  { title: "Kısaltmalar", pageStart: 7, pageEnd: 10 },
  { title: "1. Bilgi Güvenliği Yönetimi", pageStart: 11, pageEnd: 20 },
  { title: "2. Varlık Yönetimi", pageStart: 21, pageEnd: 25 },
  { title: "3. Fiziksel ve Çevresel Güvenlik", pageStart: 26, pageEnd: 35 },
  { title: "4. Ağ Güvenliği", pageStart: 36, pageEnd: 48 },
  { title: "5. Erişim Güvenliği", pageStart: 49, pageEnd: 68 },
  { title: "6. Veri ve İz Kayıtlarının Güvenliği", pageStart: 69, pageEnd: 102 },
  { title: "7. Üçüncü Taraflarla İletişim Güvenliği", pageStart: 103, pageEnd: 118 },
]

describe("section-detector", () => {
  it("TOC sayfasından BD başlıklarını çıkarır", () => {
    const pages = buildBdGoldenFixture()
    const titles = extractTitlesFromTocPages(pages)
    expect(titles.length).toBeGreaterThanOrEqual(8)
    expect(titles[0]).toMatch(/Kısaltmalar/i)
    expect(titles.some((t) => t.includes("Bilgi Güvenliği Yönetimi"))).toBe(true)
    expect(titles.some((t) => t.includes("Üçüncü Taraflarla"))).toBe(true)
  })

  it("başlıkları BD golden sayfalarına çiviler", () => {
    const pages = buildBdGoldenFixture()
    const titles = extractTitlesFromTocPages(pages)
    const tocPages = detectTocPages(pages, titles)
    const anchored = anchorTitlesToPages(titles, pages, tocPages)

    expect(anchored.map((a) => a.pageStart)).toEqual([7, 11, 21, 26, 36, 49, 69, 103])
  })

  it("pageEnd ve kaynakça sınırı BD golden ile eşleşir", () => {
    const pages = buildBdGoldenFixture()
    const titles = extractTitlesFromTocPages(pages)
    const tocPages = detectTocPages(pages, titles)
    const anchored = anchorTitlesToPages(titles, pages, tocPages)
    const bib = findBibliographyPageStart(pages)
    const ranges = buildSectionRangesFromAnchors(anchored, pages.length, bib)

    expect(bib).toBe(119)
    expect(ranges).toHaveLength(8)
    expect(ranges[0]).toMatchObject({ pageStart: 7, pageEnd: 10 })
    expect(ranges[1]).toMatchObject({ pageStart: 11, pageEnd: 20 })
    expect(ranges[7]).toMatchObject({ pageStart: 103, pageEnd: 118 })
  })

  it("deterministik pipeline BD golden tablosuyla doğrulanır", () => {
    const pages = buildBdGoldenFixture()
    const result = detectSectionsDeterministic(pages)
    expect(result).not.toBeNull()
    expect(result!.validation.valid).toBe(true)

    for (let i = 0; i < BD_GOLDEN.length; i++) {
      expect(result!.sections[i].pageStart).toBe(BD_GOLDEN[i].pageStart)
      expect(result!.sections[i].pageEnd).toBe(BD_GOLDEN[i].pageEnd)
    }
  })

  it("devasa tek bölüm (6-112 hatası) doğrulamadan geçemez", () => {
    const pages = buildBdGoldenFixture()
    const bad = [{ title: "Veri ve İz", pageStart: 6, pageEnd: 112 }]
    const validation = validateSectionRanges(bad, pages, { minSections: 1 })
    expect(validation.valid).toBe(false)
    expect(validation.errors.some((e) => e.includes("çok geniş") || e.includes("hacmi"))).toBe(true)
  })

  it("16 sayfalık prosedür tek parça modunda işlenir", () => {
    expect(
      shouldUseSingleSectionMode({
        totalPages: 16,
        programSlug: "zeliha-mevzuat",
        aiMode: "mevzuat",
        courseSlug: "zeliha-kvkk-prosedur",
        courseName: "Kişisel Verilerin Korunması Prosedürü",
        sourceKind: "internal-procedure",
      }),
    ).toBe(true)
  })

  it("70 sayfalık prosedür de tek parça — ad/tür öncelikli", () => {
    expect(
      shouldUseSingleSectionMode({
        totalPages: 70,
        programSlug: "zeliha-mevzuat",
        courseSlug: "zeliha-kvkk-prosedur",
        courseName: "Kişisel Verilerin Korunması Prosedürü",
      }),
    ).toBe(true)
  })

  it("16 sayfalık prosedürde AMAÇ VE KAPSAM 9 sayfa değil tek sayfada kalır", () => {
    const HEADER = "KİŞİSEL VERİLERİN KORUNMASI PROSEDÜRÜ"
    const pages = Array.from({ length: 16 }, (_, i) => {
      if (i === 2) {
        return `${HEADER}\nİÇİNDEKİLER\n1. AMAÇ VE KAPSAM .......... 5\n2. DAYANAK .......... 5\n3. TANIMLAR .......... 5\n4. KİŞİSEL VERİ ENVANTERİ .......... 6`
      }
      if (i === 4) {
        return `${HEADER}\n1. AMAÇ VE KAPSAM\n(1) İki satırlık amaç metni.\n(2) Kapsam cümlesi.\n2. DAYANAK\n(1) Kanun dayanağı.\n3. TANIMLAR\n(1) Tanım maddesi.`
      }
      if (i === 5) return `${HEADER}\n4. KİŞİSEL VERİ ENVANTERİ\n${FILLER}`
      if (i === 6) return `${HEADER}\n5. ÖZEL NİTELİKLİ KİŞİSEL VERİLER\n${FILLER}`
      if (i === 7) return `${HEADER}\n6. GİZLİLİK VE GÜVENLİK ÖNLEMLERİ\n${FILLER}`
      if (i === 11) return `${HEADER}\n7. SAKLAMA VE İMHA SÜREÇLERİ\n8. VERİ PAYLAŞIMI VE AKTARIMI\n${FILLER}`
      if (i === 13) return `${HEADER}\n9. VERİ SAHİBİ BAŞVURULARI\n10. KİŞİSEL VERİLERİN KORUNMASI KOMİTESİ\n${FILLER}`
      if (i === 14) return `${HEADER}\n11. VERİ İHLAL BİLDİRİM SÜRECİ\n12. EK LİSTESİ\n${FILLER}`
      if (i === 15) return `${HEADER}\n13. YÜRÜRLÜK, YÜRÜTME VE GÖZDEN GEÇİRME\n${FILLER}`
      return `${HEADER}\n${FILLER}`
    })

    const result = detectSectionsDeterministic(pages)
    expect(result).not.toBeNull()
    expect(result!.titleSource).toBe("procedure-body")
    expect(result!.validation.valid).toBe(true)

    const amac = result!.sections.find((s) => s.title.includes("AMAÇ"))
    expect(amac).toBeDefined()
    expect(amac!.pageEnd - amac!.pageStart + 1).toBeLessThanOrEqual(2)
    expect(amac!.pageEnd).toBeLessThan(10)

    const titles = extractTitlesFromProcedureBody(pages)
    const tocPages = detectTocPages(pages, titles)
    const anchored = anchorProcedureTitlesToPages(titles, pages, tocPages)
    expect(anchored.find((a) => a.title.includes("AMAÇ"))?.pageStart).toBe(5)
  })

  it("121 sayfalık SPL kitabı çoklu bölüm modunda kalır", () => {
    const pages = buildBdGoldenFixture()
    expect(
      shouldUseSingleSectionMode({
        totalPages: pages.length,
        programSlug: "spl-bagimsiz-denetim",
        aiMode: "finance",
      }),
    ).toBe(false)
    expect(resolveSectionValidationLimits(pages.length).maxSectionPageRatio).toBe(0.45)
  })

  it("tek parça modu tüm sayfaları tek bölümde birleştirir", () => {
    const pages = Array.from({ length: 16 }, (_, i) => `Sayfa ${i + 1} metni`)
    const single = buildSingleSectionFromPages(pages, "KVKK Prosedürü")
    expect(single).toHaveLength(1)
    expect(single[0]).toMatchObject({ pageStart: 1, pageEnd: 16, title: "KVKK Prosedürü" })
    expect(single[0].content).toContain("Sayfa 1 metni")
    expect(single[0].content).toContain("Sayfa 16 metni")
  })
})
