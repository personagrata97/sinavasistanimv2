/**
 * Bağımsız doğrulama: zeliha-kvkk-prosedur notlarındaki tüm ```mermaid blokları
 * normalizeMermaidChart sonrası gerçek tarayıcıda mermaid.render dener (Puppeteer).
 * Kullanım: npx tsx scratch/verify-mermaid-render.ts
 */
import { readFileSync } from "fs"
import { resolve } from "path"
import puppeteer from "puppeteer"
import { prisma } from "../src/lib/prisma"
import { normalizeMermaidChart } from "../src/lib/mermaid-normalize"

const SLUG = "zeliha-kvkk-prosedur"

function extractMermaidBlocks(notes: string): string[] {
  const blocks: string[] = []
  const re = /```mermaid\s*\n?([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(notes)) !== null) {
    blocks.push(m[1].trim())
  }
  return blocks
}

/** MermaidDiagram.tsx ile aynı temizleme */
function prepareForRender(raw: string): string {
  let cleanChart = normalizeMermaidChart(raw)
  if (!cleanChart.toLowerCase().includes("subgraph")) {
    cleanChart = cleanChart.replace(/^\s*end\s*$/gim, "")
  }
  return cleanChart
}

async function renderInBrowser(
  charts: string[],
  mermaidPath: string
): Promise<{ ok: boolean; svgLen: number; error?: string }[]> {
  const chromePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  try {
    const page = await browser.newPage()
    const mermaidSrc = readFileSync(mermaidPath, "utf8")

    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>`,
      { waitUntil: "domcontentloaded" }
    )

    await page.addScriptTag({ content: mermaidSrc })

    await page.evaluate(() => {
      const m = (window as unknown as { mermaid: { initialize: (c: object) => void } }).mermaid
      m.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        flowchart: { htmlLabels: true, curve: "basis" },
      })
    })

    const results: { ok: boolean; svgLen: number; error?: string }[] = []

    for (let i = 0; i < charts.length; i++) {
      const result = await page.evaluate(
        async (chart: string, id: string) => {
          const m = (window as unknown as {
            mermaid: { render: (id: string, chart: string) => Promise<{ svg: string }> }
          }).mermaid
          try {
            const { svg } = await m.render(id, chart)
            return { ok: true, svgLen: svg?.length ?? 0, error: undefined as string | undefined }
          } catch (e) {
            return {
              ok: false,
              svgLen: 0,
              error: e instanceof Error ? e.message : String(e),
            }
          }
        },
        charts[i],
        `verify-mermaid-${i + 1}`
      )
      results.push(result)
    }

    return results
  } finally {
    await browser.close()
  }
}

async function main() {
  const mermaidPath = resolve(process.cwd(), "node_modules/mermaid/dist/mermaid.min.js")

  const course = await prisma.course.findUnique({
    where: { slug: SLUG },
    include: { sections: { orderBy: { order: "asc" } } },
  })

  if (!course) {
    console.error(`Kurs bulunamadı: ${SLUG}`)
    process.exit(1)
  }

  const allNotes = course.sections.map((s) => s.notes || "").join("\n\n")
  const rawBlocks = extractMermaidBlocks(allNotes)
  const normalizedBlocks = rawBlocks.map(prepareForRender)

  console.log(`\n=== MERMAID RENDER DOĞRULAMA: ${SLUG} ===`)
  console.log(`Motor: Puppeteer + mermaid@11 (mermaid.min.js, tarayıcı ortamı)`)
  console.log(`Bölüm sayısı: ${course.sections.length}`)
  console.log(`Bulunan mermaid bloğu: ${rawBlocks.length}\n`)

  if (rawBlocks.length === 0) {
    console.log("Hiç mermaid bloğu yok.")
    await prisma.$disconnect()
    return
  }

  const renderResults = await renderInBrowser(normalizedBlocks, mermaidPath)

  let ok = 0
  let fail = 0

  for (let i = 0; i < rawBlocks.length; i++) {
    const raw = rawBlocks[i]
    const normalized = normalizedBlocks[i]
    const r = renderResults[i]

    console.log(`--- Şema ${i + 1}/${rawBlocks.length} ---`)
    console.log(`Ham ilk satır: ${raw.split("\n")[0]?.slice(0, 80)}`)

    const hadBadLabels = /--\s*["']?[^"'\-|][^"'\n]*["']?\s*-->/.test(raw)
    const stillBad = /--\s*["']?[^"'\-|][^"'\n]*["']?\s*-->/.test(normalized)
    if (hadBadLabels) {
      console.log(
        `  normalize düzeltmesi: ${stillBad ? "UYGULANMADI / YETERSİZ" : "uygulandı (-- X --> → -->|X|)"}`
      )
    }

    if (r.ok && r.svgLen > 100) {
      console.log(`  SONUÇ: ✅ BAŞARILI (SVG ${r.svgLen} karakter)`)
      ok++
    } else if (r.ok) {
      console.log(`  SONUÇ: ⚠️ ŞÜPHELİ — SVG çok kısa (${r.svgLen} karakter)`)
      fail++
    } else {
      console.log(`  SONUÇ: ❌ BAŞARISIZ`)
      console.log(`  Hata: ${r.error}`)
      console.log(`  Normalize edilmiş kod (ilk 500 karakter):\n${normalized.slice(0, 500)}`)
      fail++
    }
    console.log("")
  }

  console.log("=== ÖZET ===")
  console.log(`Toplam: ${rawBlocks.length} | Başarılı: ${ok} | Başarısız: ${fail}`)

  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
