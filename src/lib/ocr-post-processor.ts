import { OCR_POST_PROCESS } from "@/lib/feature-flags"
import { THRESHOLDS } from "@/lib/threshold-calibration"

export type VisualInventoryItem = {
  id: string
  index: number
  rawBlock: string
  lineCount: number
}

export type OcrPostProcessResult = {
  markdown: string
  visualCount: number
  visualItems: VisualInventoryItem[]
  metrics: {
    visualInventoryCount: number
    assignedVisIds: number
    hasVisualSection: boolean
    charLength: number
  }
}

const VISUAL_SECTION_PATTERNS = [
  /\[GÖRSEL İÇERİKLER\]/i,
  /##?\s*Görsel İçerikler/i,
  /\[GÖRSELLER\]/i
]

const VISUAL_BLOCK_SPLIT = /(?=\n(?:[-*]|\d+\.)\s)/

function findVisualSection(body: string) {
  for (const pattern of VISUAL_SECTION_PATTERNS) {
    if (pattern.test(body)) {
      const match = body.match(new RegExp(`${pattern.source}[\\s\\S]*`, "i"))
      return {
        hasSection: true,
        pattern,
        sectionBody: match ? match[0] : "",
        matchedHeader: pattern.exec(body)?.[0] || ""
      }
    }
  }
  return { hasSection: false, pattern: null, sectionBody: "", matchedHeader: "" }
}

function stripOcrStamps(text: string): string {
  return text
    .replace(/^\[MARKDOWN_OCR_SUCCESS\][^\n]*\n?/m, "")
    .replace(/^\[VISUAL_OCR_COMPLETE\][^\n]*\n?/m, "")
}

/** OCR çıktısını sarar — extractPerfectMarkdownOCR gövdesine dokunmaz */
export function postProcessOcrMarkdown(rawMarkdown: string): OcrPostProcessResult {
  const cleanBody = stripOcrStamps(rawMarkdown)
  const { hasSection, pattern, sectionBody, matchedHeader } = findVisualSection(cleanBody)

  if (!OCR_POST_PROCESS()) {
    return {
      markdown: rawMarkdown,
      visualCount: 0,
      visualItems: [],
      metrics: {
        visualInventoryCount: 0,
        assignedVisIds: 0,
        hasVisualSection: hasSection,
        charLength: rawMarkdown.length,
      },
    }
  }

  let body = cleanBody
  const visualItems: VisualInventoryItem[] = []

  if (hasSection && pattern) {
    const escapedHeader = matchedHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const blocks = sectionBody
      .split(VISUAL_BLOCK_SPLIT)
      .map((b) => b.trim())
      .filter((b) => b.length > 20 && !new RegExp(`^${escapedHeader}`, "i").test(b))

    let idx = 0
    for (const block of blocks) {
      idx++
      const id = `VIS-${String(idx).padStart(3, "0")}`
      visualItems.push({ id, index: idx, rawBlock: block.slice(0, 500), lineCount: block.split("\n").length })
    }

    if (visualItems.length > 0 && !body.includes("VIS-001")) {
      let visCounter = 0
      body = body.replace(
        /(\n(?:[-*]|\d+\.)\s[^\n]+)/g,
        (match, _g1, offset) => {
          const before = body.slice(Math.max(0, offset - 80), offset)
          if (!new RegExp(escapedHeader, "i").test(before) && !pattern.test(before)) return match
          visCounter++
          if (visCounter > visualItems.length) return match
          const id = `VIS-${String(visCounter).padStart(3, "0")}`
          if (match.includes(id)) return match
          return `\n<!-- ${id} -->${match}`
        },
      )
    }
  }

  const stamps = rawMarkdown.match(/^\[MARKDOWN_OCR_SUCCESS\][^\n]*\n\[VISUAL_OCR_COMPLETE\][^\n]*\n*/m)?.[0]
    ?? "[MARKDOWN_OCR_SUCCESS]\n[VISUAL_OCR_COMPLETE]\n\n"

  const markdown = stamps + body.trimStart()

  const visualCount = visualItems.length
  if (visualCount < THRESHOLDS.OCR_VISUAL_MIN_ITEMS && hasSection && visualCount === 0) {
    console.warn("[OCR_POST] Görsel bölüm var ama ayrıştırılmış öğe bulunamadı")
  }

  return {
    markdown,
    visualCount,
    visualItems,
    metrics: {
      visualInventoryCount: visualCount,
      assignedVisIds: visualItems.length,
      hasVisualSection: hasSection,
      charLength: markdown.length,
    },
  }
}
