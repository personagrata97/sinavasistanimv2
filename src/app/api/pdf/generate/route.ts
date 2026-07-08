import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

// Mermaid.js'i yerel dosyadan bir kez oku ve bellekte tut (CDN bağımlılığını kaldırır)
let _mermaidScript: string | null = null;
function getMermaidScript(): string {
  if (!_mermaidScript) {
    try {
      const mermaidPath = join(process.cwd(), 'public', 'js', 'mermaid.min.js');
      _mermaidScript = readFileSync(mermaidPath, 'utf-8');
      console.log(`[PDF] ✅ Mermaid.js yerel dosyadan yüklendi (${(_mermaidScript.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error('[PDF] ⚠️ Yerel mermaid.min.js bulunamadı, boş script kullanılacak:', err);
      _mermaidScript = ''; // Graceful fallback
    }
  }
  return _mermaidScript;
}

async function renderMermaidBlocksInHtml(browser: any, html: string): Promise<string> {
  const mermaidRegex = /<div class="mermaid">([\s\S]*?)<\/div>/g;
  let match;
  const matches: Array<{ fullMatch: string; code: string }> = [];
  
  mermaidRegex.lastIndex = 0;
  while ((match = mermaidRegex.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      code: match[1].trim()
    });
  }

  if (matches.length === 0) return html;

  const page = await browser.newPage();
  const rendererHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <script>${getMermaidScript()}</script>
      <script>
        mermaid.initialize({ startOnLoad: false, theme: 'default' });
      </script>
    </head>
    <body>
      <div id="graph"></div>
    </body>
    </html>
  `;
  await page.setContent(rendererHtml);

  let renderedHtml = html;

  for (const item of matches) {
    try {
      const decodedCode = item.code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");

      const svg = await page.evaluate(async (code: string) => {
        const uniqueId = 'm_' + Math.random().toString(36).substring(2, 9);
        try {
          const { svg } = await (window as any).mermaid.render(uniqueId, code);
          return svg;
        } catch (e: any) {
          return `<pre class="mermaid-error" style="color:red;border:1px solid red;padding:8px;">Akış şeması gösterilemiyor (Hata: ${e.message})</pre>`;
        }
      }, decodedCode);

      renderedHtml = renderedHtml.replace(item.fullMatch, `<div class="mermaid-svg-rendered">${svg}</div>`);
    } catch (err: any) {
      console.error("[MERMAID_RENDER] Failed to render block:", err);
      const userFriendlyFallback = `
        <div class="mermaid-error-container" style="border: 1px solid #fca5a5; background-color: #fef2f2; border-radius: 6px; padding: 12px; margin: 12px 0; page-break-inside: avoid; break-inside: avoid;">
          <strong style="color: #b91c1c; font-size: 13px;">⚠️ Akış şeması gösterilemiyor</strong>
          <details style="margin-top: 6px; font-size: 11px; color: #7f1d1d; cursor: pointer;">
            <summary style="outline: none;">Detayları Göster</summary>
            <pre style="background: #fee2e2; padding: 8px; border-radius: 4px; overflow-x: auto; margin-top: 4px;">${err.message || 'Bilinmeyen Mermaid hatası'}</pre>
          </details>
        </div>
      `;
      renderedHtml = renderedHtml.replace(item.fullMatch, userFriendlyFallback);
    }
  }

  await page.close();
  return renderedHtml;
}

export async function POST(req: Request) {
  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`pdf:${clientIp}`, 10, 60_000);
    if (!rl.success) {
      console.warn(`[PDF] 🚫 Rate limit aşıldı: ${clientIp} (resetIn: ${rl.resetIn}ms)`);
      return NextResponse.json(
        { error: "Çok fazla istek gönderdiniz. Lütfen bir dakika bekleyin." },
        { status: 429, headers: getRateLimitHeaders(rl.remaining, rl.resetIn, 10) } as any,
      );
    }

    const { html, courseName } = await req.json();

    if (!html) {
      return NextResponse.json({ error: 'HTML content is required' }, { status: 400 });
    }

    console.log(`[PDF] Generating PDF for: ${courseName || 'Course'}...`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // Render Mermaid server-side inside Puppeteer browser context
    let processedHtml = html;
    try {
      processedHtml = await renderMermaidBlocksInHtml(browser, html);
    } catch (e) {
      console.error('[PDF] Failed to pre-render Mermaid blocks:', e);
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
    
    // Set html content, we don't need networkidle0 anymore because mermaid is pre-rendered static SVG
    await page.setContent(processedHtml, { waitUntil: 'load', timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width: 100%; font-size: 10px; padding-right: 15mm; color: #64748b; font-family: 'Inter', sans-serif; text-align: right;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `,
      margin: {
        top: '18mm',
        bottom: '22mm',
        left: '15mm',
        right: '15mm'
      }
    });

    await browser.close();
    console.log(`[PDF] PDF successfully generated (${pdfBuffer.length} bytes).`);

    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${courseName ? courseName.replace(/[^a-z0-9]/gi, '_') : 'Ders_Notlari'}.pdf"`,
      },
    });

  } catch (error) {
    console.error('[PDF] Generation Error:', error);
    return NextResponse.json({ error: 'PDF oluşturulurken bir hata oluştu' }, { status: 500 });
  }
}
