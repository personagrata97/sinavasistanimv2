import {
  resolveCharSlicesForSection,
  type CharSliceResolutionResult,
  type CharSlice,
  buildCharSlicesFromAnchors,
  parseMarkdownHeadingAnchors,
  validateCharSliceRanges,
} from "@/lib/char-slice-resolver"
import { CHAR_SLICE_V2 } from "@/lib/feature-flags"
import { THRESHOLDS } from "@/lib/threshold-calibration"
import { callAI, extractCleanJson } from "@/lib/ai-service"

function levenshteinRatio(a: string, b: string): number {
  const s = a.toLocaleLowerCase("tr-TR")
  const t = b.toLocaleLowerCase("tr-TR")
  if (s === t) return 1
  const m = s.length
  const n = t.length
  if (m === 0 || n === 0) return 0
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return 1 - dp[m][n] / Math.max(m, n)
}

function fuzzyMergeAnchors(
  anchors: ReturnType<typeof parseMarkdownHeadingAnchors>,
  sectionTitle?: string,
): ReturnType<typeof parseMarkdownHeadingAnchors> {
  if (!sectionTitle || anchors.length === 0) return anchors
  const threshold = THRESHOLDS.FUZZY_TITLE_SIMILARITY
  return anchors.map((a) => {
    const ratio = levenshteinRatio(a.title, sectionTitle)
    if (ratio >= threshold && ratio < 1) {
      return { ...a, title: sectionTitle }
    }
    return a
  })
}

function computeCoverageRatio(slices: CharSlice[], contentLength: number): number {
  if (contentLength <= 0 || slices.length === 0) return 0
  let covered = 0
  for (const sl of slices) covered += sl.charEnd - sl.charStart
  return Math.min(1, covered / contentLength)
}

async function aiOffsetAnchoringFallback(
  rawContent: string,
  sectionTitle: string,
  courseLabel: string,
): Promise<CharSlice[] | null> {
  const excerpt = rawContent.slice(0, 12000)
  const prompt = `[LOG_CONTEXT: ${courseLabel}]
BÖLÜM: "${sectionTitle}"
Sen bir metin yapılandırma yardımcısısın. Aşağıdaki markdown metindeki ## veya ### başlıklarının karakter ofsetlerini (charStart) bul.
Sadece JSON döndür:
{"anchors":[{"title":"...","charStart":123,"level":2}]}

METİN:
${excerpt.replace(/"/g, "'")}`

  try {
    const raw = await callAI(prompt, 1, "kontrolor")
    const parsed = extractCleanJson(raw) as { anchors?: Array<{ title: string; charStart: number; level?: number }> }
    if (!parsed?.anchors?.length) return null

    const anchorObjs = parsed.anchors.map((a) => ({
      level: a.level ?? 2,
      title: a.title,
      charStart: a.charStart,
      heading: a.title,
    }))
    return buildCharSlicesFromAnchors(anchorObjs, rawContent.length)
  } catch {
    return null
  }
}

export type CharSliceV2Result = CharSliceResolutionResult & {
  coverageRatio: number
  usedAiFallback: boolean
}

/** v2: fuzzy başlık, AI ofset yedek, kapsama ≥0.98 */
export async function resolveCharSlicesV2(
  rawContent: string,
  sectionMeta?: { title?: string; pageStart?: number; pageEnd?: number },
  courseLabel?: string,
): Promise<CharSliceV2Result> {
  if (!CHAR_SLICE_V2()) {
    const base = resolveCharSlicesForSection(rawContent, sectionMeta)
    return {
      ...base,
      coverageRatio: computeCoverageRatio(base.slices, rawContent.length),
      usedAiFallback: false,
    }
  }

  let anchors = parseMarkdownHeadingAnchors(rawContent)
  anchors = fuzzyMergeAnchors(anchors, sectionMeta?.title)

  let slices = buildCharSlicesFromAnchors(anchors, rawContent.length)
  let validation = validateCharSliceRanges(slices, rawContent.length)
  let coverageRatio = computeCoverageRatio(slices, rawContent.length)
  let usedAiFallback = false
  let detectionSource = "markdown-headings-v2"

  const minCoverage = THRESHOLDS.CHAR_SLICE_COVERAGE_MIN

  if (
    (!validation.valid || coverageRatio < minCoverage) &&
    courseLabel &&
    sectionMeta?.title
  ) {
    const aiSlices = await aiOffsetAnchoringFallback(rawContent, sectionMeta.title, courseLabel)
    if (aiSlices && aiSlices.length >= THRESHOLDS.CHAR_SLICE_MIN_SLICES) {
      slices = aiSlices
      validation = validateCharSliceRanges(slices, rawContent.length)
      coverageRatio = computeCoverageRatio(slices, rawContent.length)
      usedAiFallback = true
      detectionSource = "ai-offset-fallback"
    }
  }

  if (coverageRatio < minCoverage) {
    validation = {
      ...validation,
      valid: false,
      errors: [...validation.errors, `Kapsama oranı düşük: %${(coverageRatio * 100).toFixed(1)} (min %${minCoverage * 100})`],
      score: Math.min(validation.score, 40),
    }
  }

  return { slices, validation, detectionSource, coverageRatio, usedAiFallback }
}
