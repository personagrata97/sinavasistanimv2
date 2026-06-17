import { describe, it, expect } from "vitest"
import {
  extractTitlesFromTocPages,
  detectSectionsDeterministic,
  validateSectionRanges,
  anchorTitlesToPages,
  detectTocPages,
  buildSectionRangesFromAnchors,
  findBibliographyPageStart,
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
})
