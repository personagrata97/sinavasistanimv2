import { stripOcrPrefixes } from "@/lib/effective-raw-content"

export type CharSliceAnchor = {
  level: number
  title: string
  charStart: number
  heading: string
}

export type CharSlice = {
  title: string
  charStart: number
  charEnd: number
  anchorHeading: string
  anchorLevel: number
}

export type CharSliceValidationResult = {
  valid: boolean
  score: number
  errors: string[]
}

export type CharSliceResolutionResult = {
  slices: CharSlice[]
  validation: CharSliceValidationResult
  detectionSource: string
}

const MIN_SLICE_CHARS = 180
const MIN_SLICES = 2

/** Markdown ## / ### ve numaralı alt başlıkları karakter ofsetiyle bulur */
export function parseMarkdownHeadingAnchors(rawContent: string): CharSliceAnchor[] {
  const body = stripOcrPrefixes(rawContent)
  const prefixLen = rawContent.length - body.length
  const anchors: CharSliceAnchor[] = []
  const lines = body.split("\n")
  let offset = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      let match: RegExpMatchArray | null = null
      let level = 0

      const h3 = trimmed.match(/^#{3}\s+(.+)$/)
      const h2 = trimmed.match(/^#{2}\s+(.+)$/)
      const numbered = trimmed.match(/^(\d+(?:\.\d+)+)\s+(.+)$/)
      const topNumbered = trimmed.match(/^(\d+)\.\s+([A-ZÇĞİÖŞÜ][^\n]{4,100})$/)

      if (h3) {
        match = h3
        level = 3
      } else if (h2) {
        match = h2
        level = 2
      } else if (numbered) {
        match = numbered
        level = numbered[1].split(".").length + 1
      } else if (topNumbered) {
        match = topNumbered
        level = 2
      }

      if (match) {
        const title = (match[2] ?? match[1]).trim().replace(/\*+/g, "").trim()
        if (title.length >= 3 && title.length <= 120) {
          anchors.push({
            level,
            title,
            charStart: prefixLen + offset + line.indexOf(trimmed),
            heading: trimmed,
          })
        }
      }
    }
    offset += line.length + 1
  }

  return anchors
}

export function buildCharSlicesFromAnchors(
  anchors: CharSliceAnchor[],
  contentLength: number,
  options?: { minSliceChars?: number },
): CharSlice[] {
  const minChars = options?.minSliceChars ?? MIN_SLICE_CHARS
  if (anchors.length < MIN_SLICES) return []

  const slices: CharSlice[] = []
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].charStart
    const end = i < anchors.length - 1 ? anchors[i + 1].charStart : contentLength
    if (end - start < minChars) continue
    slices.push({
      title: anchors[i].title,
      charStart: start,
      charEnd: end,
      anchorHeading: anchors[i].heading,
      anchorLevel: anchors[i].level,
    })
  }
  return slices
}

/** Karakter dilimleri için doğrulama — örtüşme ve sınır kontrolü */
export function validateCharSliceRanges(
  slices: CharSlice[],
  contentLength: number,
): CharSliceValidationResult {
  const errors: string[] = []

  if (slices.length < MIN_SLICES) {
    errors.push(`Yetersiz alt konu sayısı: ${slices.length} (min ${MIN_SLICES})`)
  }

  let prevEnd = 0
  for (const sl of slices) {
    if (sl.charStart < 0 || sl.charEnd > contentLength) {
      errors.push(`"${sl.title}": karakter aralığı metin dışında (${sl.charStart}-${sl.charEnd})`)
    }
    if (sl.charEnd <= sl.charStart) {
      errors.push(`"${sl.title}": charEnd <= charStart`)
    }
    if (sl.charStart < prevEnd) {
      errors.push(`"${sl.title}": önceki dilimle örtüşüyor`)
    }
    prevEnd = sl.charEnd
    if (sl.charEnd - sl.charStart < MIN_SLICE_CHARS) {
      errors.push(`"${sl.title}": dilim çok kısa (${sl.charEnd - sl.charStart} karakter)`)
    }
  }

  const score = Math.max(0, 100 - errors.length * 20)
  return { valid: errors.length === 0, score, errors }
}

export function resolveCharSlicesForSection(
  rawContent: string,
  _sectionMeta?: { title?: string; pageStart?: number; pageEnd?: number },
): CharSliceResolutionResult {
  const anchors = parseMarkdownHeadingAnchors(rawContent)
  const slices = buildCharSlicesFromAnchors(anchors, rawContent.length)
  const validation = validateCharSliceRanges(slices, rawContent.length)

  let detectionSource = "markdown-headings"
  if (anchors.some((a) => a.level === 3)) detectionSource = "markdown-h3"
  else if (anchors.some((a) => a.level === 2)) detectionSource = "markdown-h2"
  else if (anchors.length > 0) detectionSource = "numbered-headings"

  return { slices, validation, detectionSource }
}

export function sliceContent(rawContent: string, charStart: number, charEnd: number): string {
  return rawContent.slice(charStart, charEnd)
}
