const fs = require('fs');
const PDFParser = require('pdf2json');

const pdfParser = new PDFParser(this, 1);
pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
  const text = pdfParser.getRawTextContent();
  const pages = text.split(/----------------Page \(\d+\)----------------/);
  console.log("Pages array length:", pages.length);
  for (let i = 1; i <= 17; i++) {
    console.log(`\n\n=== PAGE ${i} ===\n`);
    console.log(pages[i]?.substring(0, 500));
  }
});

const buf = fs.readFileSync('/Users/selimkaya/.gemini/antigravity/scratch/spl-study-assistant-v2/uploads/bd-bilgi-sistemleri-guvenligi-1781698194056.pdf');
pdfParser.parseBuffer(buf);
