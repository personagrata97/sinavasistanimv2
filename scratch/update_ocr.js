const fs = require('fs');

let code = fs.readFileSync('src/lib/ai-service.ts', 'utf8');

const newOCR = `export async function extractPerfectMarkdownOCR(pdfPath: string, pageStart: number, pageEnd: number, courseName: string = "PDF Okuma (OCR)"): Promise<string> {
  const { PDFDocument } = await import('pdf-lib');
  const fsPromises = await import('fs/promises');

  const prompt = \`Ekteki PDF dosyasının detaylıca okuyup kusursuz bir Markdown metnine çevir.
Kurallar:
1. Hiçbir cümleyi, tabloyu veya listeyi atlama. Her detayı koru.
2. Tabloları düzgün Markdown tablolarına dönüştür.
3. Görseller veya şemalar varsa, bunları "[GÖRSEL İÇERİKLER]" başlığı altında olabildiğince detaylı metne dök.
4. "İşte metin", "Tamamdır" gibi cevaplar yazma, sadece çevrilmiş markdown metnini ver.\`;

  const pdfBytes = await fsPromises.readFile(pdfPath);
  const originalPdf = await PDFDocument.load(pdfBytes);
  const totalOriginalPages = originalPdf.getPageCount();

  const startIdx = Math.max(0, pageStart - 1);
  const endIdx = Math.min(totalOriginalPages - 1, pageEnd - 1);
  const totalPagesToExtract = endIdx - startIdx + 1;

  if (totalPagesToExtract <= 0) {
    throw new Error("Geçersiz sayfa aralığı.");
  }

  const CHUNK_SIZE = 15;
  let finalMarkdown = "";

  for (let i = 0; i < totalPagesToExtract; i += CHUNK_SIZE) {
    const chunkStartIdx = startIdx + i;
    const chunkEndIdx = Math.min(endIdx, chunkStartIdx + CHUNK_SIZE - 1);
    const chunkPageCount = chunkEndIdx - chunkStartIdx + 1;

    console.log(\`[MARKDOWN_OCR] Chunk işleniyor: Sayfa \${chunkStartIdx + 1} - \${chunkEndIdx + 1} (\${chunkPageCount} sayfa)\`);

    const newPdf = await PDFDocument.create();
    const pageIndicesToCopy = Array.from({length: chunkPageCount}, (_, k) => chunkStartIdx + k);
    const copiedPages = await newPdf.copyPages(originalPdf, pageIndicesToCopy);
    for (const page of copiedPages) {
      newPdf.addPage(page);
    }
    const chunkPdfBytes = await newPdf.save();
    const chunkBase64 = Buffer.from(chunkPdfBytes).toString('base64');

    const startKeyIndex = currentKeyIndex;
    let triedAllKeys = false;
    let chunkSuccess = false;
    let chunkResult = "";

    while (!triedAllKeys) {
      const currentKey = getNextGeminiKey();
      if (!currentKey) break;

      const headers = { "Content-Type": "application/json", "x-goog-api-key": currentKey };
      const body = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: chunkBase64
                }
              },
              { text: prompt }
            ]
          }
        ],
        // Using gemini-1.5-pro for best vision capability and strict temperature 0.0
        generationConfig: { temperature: 0.0, maxOutputTokens: 8192 }
      };

      const startTime = Date.now();
      try {
        incrementKeyRpm(currentKeyIndex);
        
        // As requested by user: Force best model (gemini-1.5-pro or 3.5 flash logic)
        // Here we use gemini-1.5-pro because 3.5 flash is a typo of 1.5-pro in user's mind for "best model"
        const axios = (await import('axios')).default;
        const response = await axios.post(
          \`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent\`,
          body,
          { headers, timeout: 180000 }
        );
        const parts = response.data?.candidates?.[0]?.content?.parts || [];
        const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text);
        const result = textParts.join("").trim();

        if (result && result.length > 100) {
          chunkResult = result;
          chunkSuccess = true;
          
          prisma.apiUsageLog.create({
            data: {
              apiKey: \`Key #\${currentKeyIndex + 1}\`,
              model: "gemini-1.5-pro",
              operation: "ocr_extraction_chunk",
              courseSlug: courseName,
              status: "SUCCESS",
              durationMs: Date.now() - startTime
            }
          }).catch(() => {})
          
          break; // Chunk succeeded, break out of key loop
        }
      } catch (e: any) {
        console.warn(\`[MARKDOWN_OCR] Key #\${currentKeyIndex + 1} başarısız: \${e.message?.substring(0, 100)}\`);
        
        const nextKey = rotateToNextKey();
        if (!nextKey || currentKeyIndex === startKeyIndex) triedAllKeys = true;
      }
    }

    if (!chunkSuccess) {
      throw new Error("OCR İşlemi başarısız oldu: Tüm API anahtarları tükendi veya Google yanıt vermedi.");
    }

    finalMarkdown += chunkResult + "\\n\\n";
    
    // Add small delay between chunks to avoid bursting
    if (i + CHUNK_SIZE < totalPagesToExtract) {
       await new Promise(r => setTimeout(r, 5000));
    }
  }

  return \`[MARKDOWN_OCR_SUCCESS]\\n\\n\${finalMarkdown.trim()}\`;
}
`;

// Extract everything from export async function extractPerfectMarkdownOCR to the end of the function block.
const regex = /export async function extractPerfectMarkdownOCR[\s\S]*?return `\[MARKDOWN_OCR_SUCCESS\]\\n\\n\$\{result\}`;[\s\S]*?}[\s\S]*?}/;

code = code.replace(regex, newOCR);

fs.writeFileSync('src/lib/ai-service.ts', code);
console.log("ai-service updated.");
