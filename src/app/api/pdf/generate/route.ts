import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';

export async function POST(req: Request) {
  try {
    const { html, courseName } = await req.json();

    if (!html) {
      return NextResponse.json({ error: 'HTML content is required' }, { status: 400 });
    }

    console.log(`[PDF] Generating PDF for: ${courseName || 'Course'}...`);

    // Puppeteer'ı başlat
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    
    // Tabloların ve Mermaid şemalarının sağdan kesilmemesi için geniş viewport
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
    
    // HTML'i yükle ve ağ isteklerinin tamamen durmasını bekle (Mermaid JS'in çalışması için)
    await page.setContent(html, { waitUntil: 'load' });
    
    // Mermaid diagramlarının çizilmesi için fazladan bekleme payı
    await new Promise(r => setTimeout(r, 3000));

    // PDF oluştur (Sağ altta sayfa numarasıyla)
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>', // Üst bilgiyi boş bırak
      footerTemplate: `
        <div style="width: 100%; font-size: 10px; padding-right: 15mm; color: #64748b; font-family: 'Inter', sans-serif; text-align: right;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `,
      margin: {
        top: '18mm',
        bottom: '22mm', // Footer'a yer açmak için alt marjı genişlettik
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
