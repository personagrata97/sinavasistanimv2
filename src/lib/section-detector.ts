import { extractSectionsRegex, detectSectionTitlesOnlyTextAI, detectSectionTitlesOnlyMultimodal } from "@/lib/pdf-engine"

/**
 * Sistematik bölüm algılama — sayfa numarası AI'ya bırakılmaz.
 * 1) İçindekilerden başlık listesi (deterministik veya AI yalnızca başlık)
 * 2) Her başlık PDF metninde fiziksel sayfaya çivilenir
 * 3) pageEnd = sonraki bölüm - 1 / kaynakça öncesi
 * 4) Doğrulama kapısı — geçmezse sonraki başlık kaynağı denenir
 */

export type SectionRange = { title: string; pageStart: number; pageEnd: number }

export type SectionValidationResult = {
  valid: boolean
  score: number
  errors: string[]
}

const BIBLIOGRAPHY_TITLES = new Set([
  "KAYNAKÇA",
  "KAYNAKLAR",
  "REFERENCES",
  "BİBLİYOGRAFYA",
  "BIBLIOGRAPHY",
])

const SKIP_TOC_TITLES = new Set([
  "İÇİNDEKİLER",
  "ICINDEKILER",
  "CONTENTS",
  "TABLE OF CONTENTS",
  "ÖNSÖZ",
  "ONSOZ",
  "PREFACE",
  "SUNUŞ",
  "SUNUS",
])

/** Türkçe karakter uyumlu normalize — eşleştirme için */
export function normalizeForMatch(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .replace(/[‐‑–—\-]/g, "-")
    .trim()
}

/** Başlıktaki "1. ", "Bölüm 2 - " gibi önekleri temizle */
export function cleanSectionTitle(title: string): string {
  let clean = title.replace(/^(Bölüm|Ünite|Kısım|BÖLÜM|ÜNİTE)\s*\d+[\.\-\:]?\s*/i, "").trim()
  clean = clean.replace(/^\d+\.\s*/, "").trim()
  return clean.length >= 2 ? clean : title.trim()
}

export function findBibliographyPageStart(pageTexts: string[]): number {
  for (let p = Math.max(0, pageTexts.length - 20); p < pageTexts.length; p++) {
    const lines = pageTexts[p]
      .split("\n")
      .slice(0, 15)
      .map((l) => l.trim().toLocaleUpperCase("tr-TR"))
    if (lines.some((l) => BIBLIOGRAPHY_TITLES.has(l))) {
      return p + 1
    }
  }
  return pageTexts.length + 1
}

/** İçindekiler sayfalarını tespit et (çok sayıda başlık satırı içeren sayfalar) */
export function detectTocPages(
  pageTexts: string[],
  candidateTitles: string[] = []
): Set<number> {
  const tocPages = new Set<number>()

  for (let p = 0; p < Math.min(20, pageTexts.length); p++) {
    const upper = pageTexts[p].toLocaleUpperCase("tr-TR")
    if (
      upper.includes("İÇİNDEKİLER") ||
      upper.includes("ICINDEKILER") ||
      upper.includes("CONTENTS")
    ) {
      tocPages.add(p)
    }
  }

  if (candidateTitles.length >= 3) {
    for (let p = 0; p < Math.min(20, pageTexts.length); p++) {
      const text = normalizeForMatch(pageTexts[p])
      let matchCount = 0
      for (const t of candidateTitles) {
        const key = normalizeForMatch(cleanSectionTitle(t))
        if (key.length >= 4 && text.includes(key)) matchCount++
      }
      if (matchCount >= 3) tocPages.add(p)
    }
  }

  return tocPages
}

function isBibliographyOrSkipTitle(title: string): boolean {
  const upper = title.trim().toLocaleUpperCase("tr-TR")
  if (BIBLIOGRAPHY_TITLES.has(upper)) return true
  if (SKIP_TOC_TITLES.has(upper)) return true
  if (/^(önsöz|sunuş|preface|acknowledgment)/i.test(title.trim())) return true
  return false
}

/** İçindekiler sayfalarından satır satır başlık çıkar (matbaa numarası yok sayılır) */
export function extractTitlesFromTocPages(pageTexts: string[]): string[] {
  const titles: string[] = []
  const seen = new Set<string>()

  const tocLinePatterns = [
    /^(.{3,90}?)\s+(?:[\.…·\u2024\u2025\u2026]{2,})\s*(\d{1,3})\s*$/,
    /^(\d+\.\s+.{3,80}?)\s+(\d{1,3})\s*$/,
    /^((?:Kısaltmalar|Tanımlar|Kavramlar|Giriş)[^\d]{0,40})\s+(\d{1,3})\s*$/i,
  ]

  for (let p = 0; p < Math.min(25, pageTexts.length); p++) {
    const upper = pageTexts[p].toLocaleUpperCase("tr-TR")
    const isTocRegion =
      upper.includes("İÇİNDEKİLER") ||
      upper.includes("ICINDEKILER") ||
      upper.includes("CONTENTS") ||
      p < 12

    if (!isTocRegion && p > 8) continue

    for (const rawLine of pageTexts[p].split("\n")) {
      const line = rawLine.trim()
      if (line.length < 4 || line.length > 120) continue

      for (const pattern of tocLinePatterns) {
        const m = line.match(pattern)
        if (!m) continue
        let title = m[1].trim().replace(/\s+/g, " ")
        title = title.replace(/[\.\…·]+$/, "").trim()
        if (isBibliographyOrSkipTitle(title)) continue
        if (/^\d{1,3}$/.test(title)) continue

        const key = normalizeForMatch(title)
        if (seen.has(key)) continue
        seen.add(key)
        titles.push(title)
        break
      }
    }
  }

  return titles
}

/** Regex ile gövde metninden bölüm başlıklarını çıkar (sadece başlık listesi) */
export function extractTitlesFromBodyRegex(pageTexts: string[]): string[] {
  const sections = extractSectionsRegex(pageTexts)
  return sections
    .map((s) => s.title)
    .filter((t) => !isBibliographyOrSkipTitle(t))
}

function titleMatchesAtPage(title: string, pageText: string, headerLines = 8): boolean {
  const normTitle = normalizeForMatch(cleanSectionTitle(title))
  const strippedNum = normTitle.replace(/^\d+\.\s*/, "")
  const firstBlock = normalizeForMatch(pageText.split("\n").slice(0, headerLines).join("\n"))
  const fullPage = normalizeForMatch(pageText)

  if (normTitle.length >= 3 && firstBlock.includes(normTitle)) return true
  if (strippedNum.length >= 4 && firstBlock.includes(strippedNum)) return true

  // Numaralı başlık: "1. Bilgi Güvenliği" satırı parçalı gelebilir
  const numMatch = title.match(/^(\d+)\.\s*(.+)/)
  if (numMatch) {
    const num = numMatch[1]
    const rest = normalizeForMatch(numMatch[2])
    if (firstBlock.includes(`${num}. ${rest}`) || firstBlock.includes(rest)) return true
  }

  // Tamamı büyük harf başlıklar (KISALTMALAR)
  const upperTitle = title.trim().toLocaleUpperCase("tr-TR")
  if (upperTitle.length >= 5 && firstBlock.includes(normalizeForMatch(upperTitle))) return true

  // Son çare: sayfa başında değilse kabul etme (halüsinasyonu önler)
  return false
}

function titleMatchesAnywhere(title: string, pageText: string): boolean {
  const normTitle = normalizeForMatch(cleanSectionTitle(title))
  const strippedNum = normTitle.replace(/^\d+\.\s*/, "")
  const fullPage = normalizeForMatch(pageText)
  if (normTitle.length >= 3 && fullPage.includes(normTitle)) return true
  if (strippedNum.length >= 4 && fullPage.includes(strippedNum)) return true
  return false
}

/** Başlıkları fiziksel sayfalara çivile — monoton, TOC sayfaları atlanır */
export function anchorTitlesToPages(
  titles: string[],
  pageTexts: string[],
  tocPages: Set<number>
): Array<{ title: string; pageStart: number }> {
  const anchored: Array<{ title: string; pageStart: number }> = []
  let searchFrom = 0

  for (const rawTitle of titles) {
    const title = rawTitle.trim()
    if (!title || isBibliographyOrSkipTitle(title)) continue

    let foundPage = -1

    for (let p = searchFrom; p < pageTexts.length; p++) {
      if (tocPages.has(p)) continue
      if (titleMatchesAtPage(title, pageTexts[p])) {
        foundPage = p + 1
        searchFrom = p
        break
      }
    }

    if (foundPage === -1) {
      for (let p = searchFrom; p < pageTexts.length; p++) {
        if (tocPages.has(p)) continue
        if (titleMatchesAnywhere(title, pageTexts[p])) {
          foundPage = p + 1
          searchFrom = p
          break
        }
      }
    }

    if (foundPage !== -1) {
      anchored.push({ title: cleanSectionTitle(title), pageStart: foundPage })
    }
  }

  return anchored
}

export function buildSectionRangesFromAnchors(
  anchored: Array<{ title: string; pageStart: number }>,
  totalPages: number,
  bibliographyPageStart: number
): SectionRange[] {
  if (anchored.length === 0) return []

  const sections: SectionRange[] = []
  for (let i = 0; i < anchored.length; i++) {
    const pageStart = Math.max(1, Math.min(anchored[i].pageStart, totalPages))
    let pageEnd: number
    if (i < anchored.length - 1) {
      pageEnd = Math.max(pageStart, anchored[i + 1].pageStart - 1)
    } else {
      pageEnd = Math.max(pageStart, Math.min(bibliographyPageStart - 1, totalPages))
    }
    sections.push({ title: anchored[i].title, pageStart, pageEnd })
  }
  return sections
}

export function validateSectionRanges(
  sections: SectionRange[],
  pageTexts: string[],
  options?: { maxSectionPageRatio?: number; maxSectionCharRatio?: number; minSections?: number }
): SectionValidationResult {
  const errors: string[] = []
  const totalPages = pageTexts.length
  const maxPageRatio = options?.maxSectionPageRatio ?? 0.45
  const maxCharRatio = options?.maxSectionCharRatio ?? 0.55
  const minSections = options?.minSections ?? 2

  if (sections.length < minSections) {
    errors.push(`Yetersiz bölüm sayısı: ${sections.length} (min ${minSections})`)
  }

  let prevStart = 0
  const totalChars = pageTexts.reduce((s, t) => s + t.length, 0) || 1

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]
    const span = sec.pageEnd - sec.pageStart + 1

    if (sec.pageStart < 1 || sec.pageEnd > totalPages) {
      errors.push(`"${sec.title}": sayfa aralığı PDF dışında (${sec.pageStart}-${sec.pageEnd})`)
    }
    if (sec.pageEnd < sec.pageStart) {
      errors.push(`"${sec.title}": pageEnd < pageStart`)
    }
    if (sec.pageStart <= prevStart && i > 0) {
      errors.push(`"${sec.title}": pageStart (${sec.pageStart}) önceki bölümden küçük/eşit`)
    }
    prevStart = sec.pageStart

    if (span / totalPages > maxPageRatio) {
      errors.push(
        `"${sec.title}": tek bölüm çok geniş (${span}/${totalPages} sayfa, max %${Math.round(maxPageRatio * 100)})`
      )
    }

    const content = pageTexts.slice(sec.pageStart - 1, sec.pageEnd).join("\n")
    if (content.length / totalChars > maxCharRatio) {
      errors.push(`"${sec.title}": içerik hacmi şüpheli (toplam metnin %${Math.round((content.length / totalChars) * 100)}'i)`)
    }
    if (content.length < 50 && !/kısaltma|tanım|kavram/i.test(sec.title)) {
      errors.push(`"${sec.title}": içerik çok kısa (${content.length} karakter)`)
    }

    const pageIdx = sec.pageStart - 1
    if (pageIdx >= 0 && pageIdx < pageTexts.length) {
      if (!titleMatchesAtPage(sec.title, pageTexts[pageIdx]) && !titleMatchesAnywhere(sec.title, pageTexts[pageIdx])) {
        errors.push(`"${sec.title}": başlık pageStart (${sec.pageStart}) sayfasında doğrulanamadı`)
      }
    }
  }

  const bibPage = findBibliographyPageStart(pageTexts)
  const last = sections[sections.length - 1]
  if (last && bibPage <= totalPages && last.pageEnd >= bibPage) {
    errors.push(`Son bölüm kaynakça sayfasına taşıyor (pageEnd=${last.pageEnd}, kaynakça=${bibPage})`)
  }

  const score = Math.max(0, 100 - errors.length * 15)
  return { valid: errors.length === 0, score, errors }
}

/** Global Zırh — AI sayfa numaralarını düzeltir, pageEnd yeniden hesaplanır */
export function applyGlobalZirh(
  sections: SectionRange[],
  pageTexts: string[]
): SectionRange[] {
  const result = sections.map((s) => ({ ...s, title: cleanSectionTitle(s.title) }))
  const tocPages = detectTocPages(
    pageTexts,
    result.map((s) => s.title)
  )

  for (let i = 0; i < result.length; i++) {
    const section = result[i]
    const rawTitles = [section.title, `${i + 1}. ${section.title}`]
    let truePage = -1

    for (const tryTitle of rawTitles) {
      for (let p = 0; p < pageTexts.length; p++) {
        if (tocPages.has(p)) continue
        if (titleMatchesAtPage(tryTitle, pageTexts[p])) {
          truePage = p + 1
          break
        }
      }
      if (truePage !== -1) break
    }

    if (truePage !== -1 && truePage !== section.pageStart) {
      section.pageStart = truePage
    }
  }

  const bibliographyPageStart = findBibliographyPageStart(pageTexts)
  for (let i = 0; i < result.length; i++) {
    if (i < result.length - 1) {
      result[i].pageEnd = Math.max(result[i].pageStart, result[i + 1].pageStart - 1)
    } else {
      result[i].pageEnd = Math.max(result[i].pageStart, bibliographyPageStart - 1)
    }
  }

  return result
}

export function sectionsToDetected(
  sections: SectionRange[],
  pageTexts: string[]
): Array<{ title: string; pageStart: number; pageEnd: number; content: string; module: string }> {
  return sections.map((s) => ({
    title: s.title,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
    content: pageTexts.slice(Math.max(0, s.pageStart - 1), s.pageEnd).join("\n\n"),
    module: s.title,
  }))
}

export type TitleSource = "toc-parse" | "body-regex" | "ai-titles" | "ai-multimodal-titles"

export type SystematicDetectionResult = {
  sections: SectionRange[]
  titleSource: TitleSource
  validation: SectionValidationResult
}

/** Tek bir başlık kaynağından bölüm üret ve doğrula */
export function detectFromTitleList(
  titles: string[],
  pageTexts: string[],
  titleSource: TitleSource
): SystematicDetectionResult | null {
  if (titles.length < 2) return null

  const tocPages = detectTocPages(pageTexts, titles)
  const anchored = anchorTitlesToPages(titles, pageTexts, tocPages)
  if (anchored.length < 2) return null

  const bib = findBibliographyPageStart(pageTexts)
  let sections = buildSectionRangesFromAnchors(anchored, pageTexts.length, bib)
  sections = applyGlobalZirh(sections, pageTexts)
  const validation = validateSectionRanges(sections, pageTexts)

  return { sections, titleSource, validation }
}

/** Sıralı başlık kaynaklarını dene; ilk geçerli sonucu döndür */
export function detectSectionsDeterministic(pageTexts: string[]): SystematicDetectionResult | null {
  const sources: Array<{ source: TitleSource; titles: string[] }> = [
    { source: "toc-parse", titles: extractTitlesFromTocPages(pageTexts) },
    { source: "body-regex", titles: extractTitlesFromBodyRegex(pageTexts) },
  ]

  let best: SystematicDetectionResult | null = null

  for (const { source, titles } of sources) {
    const result = detectFromTitleList(titles, pageTexts, source)
    if (!result) continue
    if (result.validation.valid) return result
    if (!best || result.validation.score > best.validation.score) best = result
  }

  if (best && best.validation.score >= 70) return best
  return null
}

export type SystematicDetectionOptions = {
  geminiFileUri?: string | null
  geminiKeys?: string[]
}

/**
 * Tam sistematik pipeline: deterministik → AI (yalnızca başlık) → Global Zırh → doğrulama.
 * Sayfa numarası hiçbir aşamada AI'dan alınmaz.
 */
export async function detectSectionsSystematic(
  pageTexts: string[],
  options: SystematicDetectionOptions = {}
): Promise<SystematicDetectionResult | null> {
  const deterministic = detectSectionsDeterministic(pageTexts)
  if (deterministic?.validation.valid) {
    console.log(`[SECTION_DETECTOR] ✅ Deterministik: ${deterministic.sections.length} bölüm (${deterministic.titleSource})`)
    return deterministic
  }

  const keys = (options.geminiKeys || []).filter((k) => k.trim())
  const attempts: Array<{ source: TitleSource; titles: string[] }> = []

  if (deterministic) {
    console.log(
      `[SECTION_DETECTOR] ⚠️ Deterministik kısmen başarılı (skor ${deterministic.validation.score}): ${deterministic.validation.errors.join("; ")}`
    )
  }

  if (keys.length > 0) {
    const tocSnippet = pageTexts
      .slice(0, Math.min(20, pageTexts.length))
      .map((t, i) => `--- SAYFA ${i + 1} ---\n${t}`)
      .join("\n\n")

    for (const key of keys) {
      try {
        const aiTitles = await detectSectionTitlesOnlyTextAI(tocSnippet, key.trim())
        if (aiTitles.length >= 2) attempts.push({ source: "ai-titles", titles: aiTitles })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[SECTION_DETECTOR] Text AI başlık çıkarma başarısız: ${msg.substring(0, 80)}`)
      }
    }

    if (options.geminiFileUri) {
      for (const key of keys) {
        try {
          const mmTitles = await detectSectionTitlesOnlyMultimodal(options.geminiFileUri, key.trim())
          if (mmTitles.length >= 2) attempts.push({ source: "ai-multimodal-titles", titles: mmTitles })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn(`[SECTION_DETECTOR] Multimodal başlık çıkarma başarısız: ${msg.substring(0, 80)}`)
        }
      }
    }
  }

  let best: SystematicDetectionResult | null = deterministic

  for (const { source, titles } of attempts) {
    const result = detectFromTitleList(titles, pageTexts, source)
    if (!result) continue
    if (result.validation.valid) {
      console.log(`[SECTION_DETECTOR] ✅ ${source}: ${result.sections.length} bölüm doğrulandı`)
      return result
    }
    if (!best || result.validation.score > best.validation.score) best = result
  }

  if (best) {
    console.error(
      `[SECTION_DETECTOR] ❌ Bölüm algılama doğrulamadan geçemedi (skor ${best.validation.score}): ${best.validation.errors.join("; ")}`
    )
  }
  return best
}
