import { extractSectionsRegex, detectSectionTitlesOnlyTextAI, detectSectionTitlesOnlyMultimodal, anchorTitlesToPagesWithAI } from "@/lib/pdf-engine"
import { shouldUseSingleSectionModeFromProfile } from "@/lib/document-processing-profile"

/**
 * Sistematik bölüm algılama — sayfa numarası AI'ya bırakılmaz.
 * 1) İçindekilerden başlık listesi (deterministik veya AI yalnızca başlık)
 * 2) Her başlık PDF metninde fiziksel sayfaya çivilenir
 * 3) pageEnd = sonraki bölüm - 1 / kaynakça öncesi
 * 4) Doğrulama kapısı — geçmezse sonraki başlık kaynağı denenir
 */

export type SectionRange = { title: string; pageStart: number; pageEnd: number; confidence?: string }

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

/** OCR hatalarını (I->İ, G->Ğ vb.) ve boşluk/noktalama farklılıklarını yutan bulanıklaştırıcı */
export function deburr(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/i̇/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u")
    .replace(/[^a-z0-9]/g, "") // Sadece harf ve rakamlar kalır
}

function levenshteinDistance(s: string, t: string, maxDist = 2): number {
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    let minVal = currRow[0];

    const minJ = Math.max(1, i - maxDist);
    const maxJ = Math.min(n, i + maxDist);

    for (let j = 1; j < minJ; j++) {
      currRow[j] = maxDist + 1;
    }
    for (let j = maxJ + 1; j <= n; j++) {
      currRow[j] = maxDist + 1;
    }

    for (let j = minJ; j <= maxJ; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + cost
      );
      if (j === minJ || currRow[j] < minVal) {
        minVal = currRow[j];
      }
    }

    if (minVal > maxDist) {
      return maxDist + 1;
    }

    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[n];
}

/** Bulanık Eşleştirme (Fuzzy Match): Boşluklar, noktalamalar ve Türkçe karakter hataları yok sayılır, Levenshtein <= 2 desteği */
export function fuzzyIncludes(text: string, searchPhrase: string): boolean {
  const cleanText = text
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/^\s*(?:sayfa|page|s\.)\s*\d+(?:\s*[\/\-]\s*\d+)?\s*$/gim, "")
    .replace(/\/Type\s*\/Page\b/gi, "")

  const deburredText = deburr(cleanText)
  const deburredSearch = deburr(searchPhrase)
  if (deburredSearch.length < 3) return false
  if (deburredText.includes(deburredSearch)) return true

  const searchLen = deburredSearch.length
  const maxDistance = 2
  for (let i = 0; i <= deburredText.length - searchLen; i++) {
    const windowText = deburredText.substring(i, i + searchLen)
    if (levenshteinDistance(windowText, deburredSearch) <= maxDistance) return true

    if (i <= deburredText.length - searchLen - 1) {
      const windowText2 = deburredText.substring(i, i + searchLen + 1)
      if (levenshteinDistance(windowText2, deburredSearch) <= maxDistance) return true
    }

    if (searchLen > 3) {
      const windowText3 = deburredText.substring(i, i + searchLen - 1)
      if (levenshteinDistance(windowText3, deburredSearch) <= maxDistance) return true
    }
  }

  return false
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
      upper.includes("CONTENTS") ||
      upper.includes("SINAV ALT KONU BAŞLIKLARI") ||
      upper.includes("ALT KONU BAŞLIKLARI") ||
      upper.includes("SINAV KONULARI")
    ) {
      tocPages.add(p)
    }
  }

  if (candidateTitles.length >= 3) {
    for (let p = 0; p < Math.min(20, pageTexts.length); p++) {
      const lines = pageTexts[p].split("\n").map(l => normalizeForMatch(l))
      let matchCount = 0
      const isKnownToc = pageHasTocMarker(pageTexts[p]) || isLikelyTocListingPage(pageTexts[p])

      for (const t of candidateTitles) {
        const key = normalizeForMatch(cleanSectionTitle(t))
        if (key.length >= 4) {
          if (lines.some(l => {
            const hasKey = l.includes(key) && l.length < key.length + 50
            if (isKnownToc) return hasKey
            // TOC pages without explicit markers/dots must end with a page number to be matched
            return hasKey && /\b\d{1,3}\s*$/.test(l)
          })) {
            matchCount++
          }
        }
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
  if (/^(?:önsöz|sunuş)$/i.test(upper)) return true
  return false
}

/** Sayfa üstünde her sayfada tekrarlanan belge başlığı/üst bilgi satırları */
export function detectRepeatedPageHeaders(pageTexts: string[]): Set<string> {
  const counts = new Map<string, number>()
  const threshold = Math.max(3, Math.floor(pageTexts.length * 0.35))

  for (const page of pageTexts) {
    const seenOnPage = new Set<string>()
    for (const rawLine of page.split("\n").slice(0, 6)) {
      const line = rawLine.trim().replace(/\s+/g, " ")
      if (line.length < 10) continue
      const key = normalizeForMatch(line)
      if (seenOnPage.has(key)) continue
      seenOnPage.add(key)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }

  return new Set(
    [...counts.entries()].filter(([, n]) => n >= threshold).map(([k]) => k)
  )
}

function isLikelyTocListingPage(pageText: string): boolean {
  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean)
  const dotted = lines.filter((l) => /\.{3,}/.test(l) && /\d{1,3}\s*$/.test(l)).length
  return dotted >= 3
}

function pageHasTocMarker(pageText: string): boolean {
  const collapsed = pageText.replace(/\s+/g, "").toLocaleUpperCase("tr-TR")
  return (
    collapsed.includes("İÇİNDEKİLER") ||
    collapsed.includes("ICINDEKILER") ||
    collapsed.includes("CONTENTS") ||
    collapsed.includes("SINAVALTKONUBAŞLIKLARI") ||
    collapsed.includes("ALTKONUBAŞLIKLARI") ||
    collapsed.includes("SINAVKONULARI")
  )
}

/** Prosedür içindekiler satırı: "1. AMAÇ VE KAPSAM .... 5" — alt madde (6.1.) değil */
function isMainProcedureSectionTitle(title: string): boolean {
  const t = title.trim()
  if (/^\d+\.\d+/.test(t)) return false
  return /^\d{1,2}\.\s+[A-ZÇĞİÖŞÜ]/.test(t)
}

function parseProcedureTocLine(line: string): string | null {
  const trimmed = line.trim().replace(/\s+/g, " ")
  if (trimmed.length < 6 || trimmed.length > 200) return null
  if (!/\d{1,3}\s*$/.test(trimmed)) return null
  if (!/[\.\…·]{2,}/.test(trimmed)) return null

  const title = trimmed.replace(/(?:[\.\s…·\u2024\u2025\u2026]+)\d{1,3}\s*$/, "").trim()
  if (!isMainProcedureSectionTitle(title)) return null
  return title
}

/** Prosedür içindekilerinden yalnızca ana bölümleri (1.–13.) çıkar */
export function extractProcedureMainTitlesFromToc(pageTexts: string[]): string[] {
  const titles: string[] = []
  const seen = new Set<string>()

  for (let p = 0; p < Math.min(25, pageTexts.length); p++) {
    if (!pageHasTocMarker(pageTexts[p]) && !isLikelyTocListingPage(pageTexts[p])) continue

    for (const rawLine of pageTexts[p].split("\n")) {
      const parsed = parseProcedureTocLine(rawLine.trim())
      if (!parsed || isBibliographyOrSkipTitle(parsed)) continue
      const key = normalizeForMatch(parsed)
      if (seen.has(key)) continue
      seen.add(key)
      titles.push(parsed)
    }
  }

  titles.sort((a, b) => {
    const na = parseInt(a.match(/^(\d+)/)?.[1] || "0", 10)
    const nb = parseInt(b.match(/^(\d+)/)?.[1] || "0", 10)
    return na - nb
  })

  return titles
}

/** İçindekiler sayfalarından satır satır başlık çıkar (matbaa numarası yok sayılır) */
export function extractTitlesFromTocPages(pageTexts: string[]): string[] {
  const titles: string[] = []
  const seen = new Set<string>()

  const tocLinePatterns = [
    /^(\d+\.\s+[A-ZÇĞİÖŞÜ].+?)\s+(?:[\.…·\u2024\u2025\u2026]\s*){2,}(\d{1,3})\s*$/,
    /^(.{3,90}?)\s+(?:[\.…·\u2024\u2025\u2026]{2,})\s*(\d{1,3})\s*$/,
    /^(\d+\.\s+.{3,80}?)\s+(\d{1,3})\s*$/,
    /^((?:İçindekiler|Önsöz|Kısaltmalar|Tanımlar|Kavramlar|Giriş)[^\d]{0,40})\s+(\d{1,3})\s*$/i,
    // Sayfa numarası OLMAYAN ama bariz liste elemanı olan başlıklar için otonom fallback:
    /^(\d+\.\s+[A-ZÇĞİÖŞÜ][^\n]{3,80})$/,
    /^((?:BÖLÜM|MODÜL|ÜNİTE)\s+\d+\s*:\s*[A-ZÇĞİÖŞÜ][^\n]{3,80})$/i
  ]

  const tocPageIndices = new Set<number>()
  for (let p = 0; p < Math.min(25, pageTexts.length); p++) {
    const upper = pageTexts[p].toLocaleUpperCase("tr-TR")
    if (
      upper.includes("İÇİNDEKİLER") ||
      upper.includes("ICINDEKILER") ||
      upper.includes("CONTENTS") ||
      upper.includes("SINAV ALT KONU BAŞLIKLARI")
    ) {
      tocPageIndices.add(p)
      if (p + 1 < pageTexts.length) tocPageIndices.add(p + 1)
    }
  }

  for (let p = 0; p < Math.min(25, pageTexts.length); p++) {
    // Otonom TOC Tespiti: Eğer sayfada en az 3 satır başlık desenine uyuyorsa, burası bir TOC bölgesidir!
    let titleMatchCount = 0
    for (const rawLine of pageTexts[p].split("\n")) {
      const line = rawLine.trim()
      if (line.length >= 4 && line.length <= 120) {
        for (const pattern of tocLinePatterns) {
          if (pattern.test(line)) {
            titleMatchCount++
            break
          }
        }
      }
    }

    const isTocRegion = tocPageIndices.has(p) || (p <= 8 && isLikelyTocListingPage(pageTexts[p])) || titleMatchCount >= 3

    if (!isTocRegion) continue

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

/** Prosedür/mevzuat: "1. AMAÇ VE KAPSAM" ana bölümleri (6.1. alt başlık değil) */
export function extractTitlesFromProcedureBody(pageTexts: string[]): string[] {
  const MAIN_HEADING = /^(\d{1,2})\.\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü\s,;/\-]{3,100})$/
  const repeatedHeaders = detectRepeatedPageHeaders(pageTexts)
  const titles: string[] = []
  const seenNums = new Set<number>()

  for (let p = 0; p < pageTexts.length; p++) {
    if (pageHasTocMarker(pageTexts[p]) || isLikelyTocListingPage(pageTexts[p])) continue

    for (const rawLine of pageTexts[p].split("\n")) {
      const line = rawLine.trim().replace(/\s+/g, " ")
      if (line.length < 6 || line.length > 100) continue
      if (/^\d+\.\d+/.test(line)) continue

      const m = line.match(MAIN_HEADING)
      if (!m) continue

      const num = parseInt(m[1], 10)
      const title = `${m[1]}. ${m[2].trim()}`
      if (isBibliographyOrSkipTitle(title)) continue
      if (repeatedHeaders.has(normalizeForMatch(title))) continue
      if (repeatedHeaders.has(normalizeForMatch(m[2]))) continue
      if (seenNums.has(num)) continue

      seenNums.add(num)
      titles.push(title)
    }
  }

  titles.sort((a, b) => {
    const na = parseInt(a.match(/^(\d+)/)?.[1] || "0", 10)
    const nb = parseInt(b.match(/^(\d+)/)?.[1] || "0", 10)
    return na - nb
  })

  return titles
}

function titleMatchesAtPage(title: string, pageText: string, headerLines = 15): boolean {
  const cleanTitleStr = cleanSectionTitle(title)
  const strippedNum = cleanTitleStr.replace(/^\d+\.\s*/, "")
  
  const lines = pageText.split("\n").slice(0, headerLines)
  const filteredLines = lines.filter(line => {
    const wordCount = line.trim().split(/\s+/).filter(w => w.length > 0).length
    return wordCount > 0 && wordCount <= 15
  })
  const firstBlock = filteredLines.join("\n")

  if (fuzzyIncludes(firstBlock, cleanTitleStr)) return true
  if (strippedNum.length >= 4 && fuzzyIncludes(firstBlock, strippedNum)) return true

  // Numaralı başlık: "1. Bilgi Güvenliği"
  const numMatch = title.match(/^(\d+)\.\s*(.+)/)
  if (numMatch) {
    const num = numMatch[1]
    const rest = numMatch[2]
    if (fuzzyIncludes(firstBlock, `${num}${rest}`) || fuzzyIncludes(firstBlock, rest)) return true
  }

  // Tamamı büyük harf başlıklar (KISALTMALAR)
  const upperTitle = title.trim().toLocaleUpperCase("tr-TR")
  if (upperTitle.length >= 5 && fuzzyIncludes(firstBlock, upperTitle)) return true

  return false
}

function titleMatchesAnywhere(title: string, pageText: string): boolean {
  const cleanTitleStr = cleanSectionTitle(title)
  const strippedNum = cleanTitleStr.replace(/^\d+\.\s*/, "")
  const lines = pageText.split('\n')
  for (const line of lines) {
    if (line.length > title.length + 45) continue
    if (fuzzyIncludes(line, cleanTitleStr)) return true
    if (strippedNum.length >= 4 && fuzzyIncludes(line, strippedNum)) return true
  }
  return false
}

function procedureTitleLineMatches(title: string, line: string): boolean {
  const numMatch = title.match(/^(\d+)\.\s*(.+)/)
  if (!numMatch) return fuzzyIncludes(line, cleanSectionTitle(title))

  const rest = numMatch[2]
  return fuzzyIncludes(line, title) || fuzzyIncludes(line, rest)
}

/** Prosedür başlıklarını tam satır eşleşmesiyle çivile — TOC ve paragraf içi yanlış eşleşmeyi önler */
export function anchorProcedureTitlesToPages(
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
      if (isLikelyTocListingPage(pageTexts[p])) continue

      for (const rawLine of pageTexts[p].split("\n")) {
        const line = rawLine.trim().replace(/\s+/g, " ")
        if (line.length < 4) continue
        if (/^\d+\.\d+/.test(line)) continue
        if (!procedureTitleLineMatches(title, line)) continue
        foundPage = p + 1
        break
      }

      if (foundPage !== -1) {
        searchFrom = p
        break
      }
    }

    if (foundPage !== -1) {
      anchored.push({ title: cleanSectionTitle(title), pageStart: foundPage })
    }
  }

  return anchored
}

/** Başlıkları fiziksel sayfalara çivile — monoton, TOC sayfaları atlanır */
export function anchorTitlesToPages(
  titles: string[],
  pageTexts: string[],
  tocPages: Set<number>
): Array<{ title: string; pageStart: number; confidence?: string }> {
  const anchored: Array<{ title: string; pageStart: number; confidence?: string }> = []
  let searchFrom = 0

  for (const rawTitle of titles) {
    const title = rawTitle.trim()
    if (!title || isBibliographyOrSkipTitle(title)) continue

    let foundPage = -1
    let confidence: string | undefined = undefined

    for (let p = searchFrom; p < pageTexts.length; p++) {
      if (tocPages.has(p)) continue
      // İlk 8 satırda bulunursa -> high
      if (titleMatchesAtPage(title, pageTexts[p], 8)) {
        foundPage = p + 1
        searchFrom = p
        confidence = "high"
        break
      }
      // 9-15 satırda bulunursa -> medium
      if (titleMatchesAtPage(title, pageTexts[p], 15)) {
        foundPage = p + 1
        searchFrom = p
        confidence = "medium"
        break
      }
    }

    if (foundPage === -1) {
      for (let p = searchFrom; p < pageTexts.length; p++) {
        if (tocPages.has(p)) continue
        if (titleMatchesAnywhere(title, pageTexts[p])) {
          foundPage = p + 1
          searchFrom = p
          confidence = "low"
          break
        }
      }
    }

    if (foundPage !== -1) {
      anchored.push({ title: cleanSectionTitle(title), pageStart: foundPage, confidence })
    }
  }

  return anchored
}

/** Ardışık bölümlerde sayfa örtüşmesini giderir (pageEnd = sonraki.pageStart - 1) */
export function assertNoOverlapSections<T extends { pageStart: number; pageEnd: number }>(
  sections: T[],
): T[] {
  for (let i = 0; i < sections.length - 1; i++) {
    const nextStart = sections[i + 1].pageStart
    if (sections[i].pageEnd >= nextStart) {
      sections[i].pageEnd = Math.max(sections[i].pageStart, nextStart - 1)
    }
  }
  return sections
}

export function buildSectionRangesFromAnchors(
  anchored: Array<{ title: string; pageStart: number; confidence?: string }>,
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
    sections.push({ title: anchored[i].title, pageStart, pageEnd, confidence: anchored[i].confidence })
  }
  return sections
}

/** SPL sınav kitapları için bölüm genişlik sınırları — gevşetme yok */
export function resolveSectionValidationLimits(
  _totalPages: number,
  overrides?: { maxSectionPageRatio?: number; maxSectionCharRatio?: number }
): { maxSectionPageRatio: number; maxSectionCharRatio: number } {
  return {
    maxSectionPageRatio: overrides?.maxSectionPageRatio ?? 0.60,
    maxSectionCharRatio: overrides?.maxSectionCharRatio ?? 0.65,
  }
}

/** Kısa belgeler: bölüm ayırma yerine tek parça not üretimi */
export {
  SINGLE_SECTION_MAX_PAGES,
  MEVZUAT_SINGLE_SECTION_MAX_PAGES,
} from "./document-processing-profile"

export function shouldUseSingleSectionMode(options: {
  totalPages: number
  programSlug?: string | null
  aiMode?: string | null
  courseSlug?: string | null
  courseName?: string | null
  sourceKind?: string | null
  sourceKindLabel?: string | null
  gridGroup?: string | null
}): boolean {
  return shouldUseSingleSectionModeFromProfile({
    slug: options.courseSlug,
    name: options.courseName,
    sourceKind: options.sourceKind,
    sourceKindLabel: options.sourceKindLabel,
    gridGroup: options.gridGroup,
    programSlug: options.programSlug,
    aiMode: options.aiMode,
    totalPages: options.totalPages,
  })
}

/** Tüm PDF'i tek bölüm/not birimi olarak döndür — bölüm algılama atlanır */
export function buildSingleSectionFromPages(
  pageTexts: string[],
  title?: string
): Array<{ title: string; pageStart: number; pageEnd: number; content: string; module: string }> {
  const totalPages = pageTexts.length
  const sectionTitle = title?.trim() || "Tam Metin"
  return [
    {
      title: sectionTitle,
      pageStart: 1,
      pageEnd: totalPages,
      content: pageTexts.join("\n\n"),
      module: sectionTitle,
    },
  ]
}

export function validateSectionRanges(
  sections: SectionRange[],
  pageTexts: string[],
  options?: { maxSectionPageRatio?: number; maxSectionCharRatio?: number; minSections?: number }
): SectionValidationResult {
  const errors: string[] = []
  const totalPages = pageTexts.length
  const { maxSectionPageRatio: maxPageRatio, maxSectionCharRatio: maxCharRatio } =
    resolveSectionValidationLimits(totalPages, options)
  const minSections = options?.minSections ?? (totalPages <= 60 ? 1 : 2)

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
    if (sec.pageStart < prevStart && i > 0) {
      errors.push(`"${sec.title}": pageStart (${sec.pageStart}) önceki bölümden küçük`)
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

  let searchFrom = 0;
  for (let i = 0; i < result.length; i++) {
    const section = result[i]
    const rawTitles = [section.title, `${i + 1}. ${section.title}`]
    let truePage = -1

    for (const tryTitle of rawTitles) {
      for (let p = searchFrom; p < pageTexts.length; p++) {
        if (tocPages.has(p)) continue
        if (titleMatchesAtPage(tryTitle, pageTexts[p])) {
          truePage = p + 1
          break
        }
      }
      if (truePage !== -1) break
    }

    if (truePage !== -1 && truePage !== section.pageStart && truePage >= searchFrom) {
      section.pageStart = truePage
      searchFrom = truePage - 1
    } else {
      searchFrom = Math.max(searchFrom, section.pageStart - 1)
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
): Array<{ title: string; pageStart: number; pageEnd: number; content: string; module: string; confidence?: string }> {
  return sections.map((s) => ({
    title: s.title,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
    content: pageTexts.slice(Math.max(0, s.pageStart - 1), s.pageEnd).join("\n\n"),
    module: s.title,
    confidence: s.confidence,
  }))
}

export type TitleSource =
  | "procedure-body"
  | "procedure-toc"
  | "toc-parse"
  | "body-regex"
  | "ai-titles"
  | "ai-multimodal-titles"

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
  const anchored =
    titleSource === "procedure-body" || titleSource === "procedure-toc"
      ? anchorProcedureTitlesToPages(titles, pageTexts, tocPages)
      : anchorTitlesToPages(titles, pageTexts, tocPages)
  if (anchored.length < 2) return null

  const bib = findBibliographyPageStart(pageTexts)
  let sections = buildSectionRangesFromAnchors(anchored, pageTexts.length, bib)
  sections = applyGlobalZirh(sections, pageTexts)
  const validation = validateSectionRanges(sections, pageTexts)

  return { sections, titleSource, validation }
}

export async function detectFromTitleListWithAI(
  titles: string[],
  pageTexts: string[],
  titleSource: TitleSource,
  apiKey: string,
  logCourseSlug?: string | null
): Promise<SystematicDetectionResult | null> {
  if (titles.length < 2) return null

  // Semantik çivileme ile AI üzerinden pageStart listesi alınır
  console.log(`[SECTION_DETECTOR] 🧠 ${titleSource} başlıkları için LLM Destekli Çivileme başlatılıyor...`)
  const anchored = await anchorTitlesToPagesWithAI(titles, pageTexts, apiKey, { courseSlug: logCourseSlug })
  
  if (anchored.length < 2) return null

  const bib = findBibliographyPageStart(pageTexts)
  let sections = buildSectionRangesFromAnchors(anchored, pageTexts.length, bib)
  // AI zaten monotonik döndürüyor ancak Global Zırhın düzeltme algoritmalarından geçmesi güvenlidir
  sections = applyGlobalZirh(sections, pageTexts)
  const validation = validateSectionRanges(sections, pageTexts)

  return { sections, titleSource, validation }
}

/** Sıralı başlık kaynaklarını dene; ilk geçerli sonucu döndür */
export function detectSectionsDeterministic(pageTexts: string[]): SystematicDetectionResult | null {
  const sources: Array<{ source: TitleSource; titles: string[] }> = []

  if (pageTexts.length <= 30) {
    const procedureBody = extractTitlesFromProcedureBody(pageTexts)
    if (procedureBody.length >= 2) {
      sources.push({ source: "procedure-body", titles: procedureBody })
    }
  }

  const procedureToc = extractProcedureMainTitlesFromToc(pageTexts)
  if (pageTexts.length <= 30 && procedureToc.length >= 2) {
    sources.push({ source: "procedure-toc", titles: procedureToc })
  }

  const tocTitles = extractTitlesFromTocPages(pageTexts)
  sources.push({ source: "toc-parse", titles: tocTitles })
  sources.push({ source: "body-regex", titles: extractTitlesFromBodyRegex(pageTexts) })

  let best: SystematicDetectionResult | null = null

  for (const { source, titles } of sources) {
    const result = detectFromTitleList(titles, pageTexts, source)
    if (!result) continue
    if (result.validation.valid) return result
    if (!best || result.validation.score > best.validation.score) best = result
  }

  return best
}

export type SystematicDetectionOptions = {
  geminiFileUri?: string | null
  geminiKeys?: string[]
  /** ApiUsageLog courseSlug — genelde ders slug */
  logCourseSlug?: string | null
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
    const primaryKey = keys[0].trim()

    if (options.geminiFileUri) {
      try {
        const mmTitles = await detectSectionTitlesOnlyMultimodal(options.geminiFileUri, primaryKey, { courseSlug: options.logCourseSlug ?? null })
        if (mmTitles.length >= 2) attempts.push({ source: "ai-multimodal-titles", titles: mmTitles })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[SECTION_DETECTOR] Multimodal başlık çıkarma başarısız: ${msg.substring(0, 80)}`)
      }
    } else {
      console.warn("[SECTION_DETECTOR] geminiFileUri eksik, Multimodal AI çalıştırılamıyor.")
    }
  }

  let best: SystematicDetectionResult | null = deterministic

  for (const { source, titles } of attempts) {
    let result: SystematicDetectionResult | null = null

    if (keys.length > 0) {
      // Önce AI destekli semantik çivilemeyi dene
      result = await detectFromTitleListWithAI(titles, pageTexts, source, keys[0].trim(), options.logCourseSlug)
    }

    // AI başarısız olursa veya API hatası verirse, deterministik string çivilemeye dön (Fallback)
    if (!result || !result.validation.valid) {
      const fallbackResult = detectFromTitleList(titles, pageTexts, source)
      if (fallbackResult && (!result || fallbackResult.validation.score > result.validation.score)) {
        if (result) console.log(`[SECTION_DETECTOR] ⚠️ AI Çivileme doğrulanamadı (skor ${result.validation.score}), klasik metoda dönüldü.`)
        result = fallbackResult
      }
    }

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
