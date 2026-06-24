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

const VISUAL_SECTION_RE = /\[GÖRSEL İÇERİKLER\]/i
const VISUAL_BLOCK_SPLIT = /(?=\n(?:[-*]|\d+\.)\s)/

function stripOcrStamps(text: string): string {
  return text
    .replace(/^\[MARKDOWN_OCR_SUCCESS\][^\n]*\n?/m, "")
    .replace(/^\[VISUAL_OCR_COMPLETE\][^\n]*\n?/m, "")
}

/** OCR çıktısını sarar — extractPerfectMarkdownOCR gövdesine dokunmaz */
export function postProcessOcrMarkdown(rawMarkdown: string): OcrPostProcessResult {
  if (!OCR_POST_PROCESS()) {
    const body = stripOcrStamps(rawMarkdown)
    return {
      markdown: rawMarkdown,
      visualCount: 0,
      visualItems: [],
      metrics: {
        visualInventoryCount: 0,
        assignedVisIds: 0,
        hasVisualSection: VISUAL_SECTION_RE.test(body),
        charLength: rawMarkdown.length,
      },
    }
  }

  let body = stripOcrStamps(rawMarkdown)
  const hasVisualSection = VISUAL_SECTION_RE.test(body)
  const visualItems: VisualInventoryItem[] = []

  if (hasVisualSection) {
    const sectionMatch = body.match(/\[GÖRSEL İÇERİKLER\][\s\S]*/i)
    const sectionBody = sectionMatch ? sectionMatch[0] : ""
    const blocks = sectionBody
      .split(VISUAL_BLOCK_SPLIT)
      .map((b) => b.trim())
      .filter((b) => b.length > 20 && !/^\[GÖRSEL İÇERİKLER\]/i.test(b))

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
          if (!/\[GÖRSEL İÇERİKLER\]/i.test(before) && !VISUAL_SECTION_RE.test(before)) return match
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
  if (visualCount < THRESHOLDS.OCR_VISUAL_MIN_ITEMS && hasVisualSection && visualCount === 0) {
    console.warn("[OCR_POST] Görsel bölüm var ama ayrıştırılmış öğe bulunamadı")
  }

  return {
    markdown,
    visualCount,
    visualItems,
    metrics: {
      visualInventoryCount: visualCount,
      assignedVisIds: visualItems.length,
      hasVisualSection,
      charLength: markdown.length,
    },
  }
}
