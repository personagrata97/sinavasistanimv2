import fs from "fs";
import { prisma } from "../src/lib/prisma";
import { extractAllText } from "../src/lib/pdf-engine";

async function run() {
  console.log("Analyzing...");
  const pdfBuffer = fs.readFileSync("./uploads/bd-bilgi-sistemleri-guvenligi-1780685931397.pdf");
  const pages = await extractAllText(pdfBuffer);
  
  const rawPdfText = pages.join("\n").replace(/\s+/g, ' ').trim();
  const rawPdfLength = rawPdfText.length;
  
  const course = await prisma.course.findUnique({where: {slug: 'bd-bilgi-sistemleri-guvenligi'}});
  const sections = await prisma.section.findMany({where: {courseId: course?.id}, orderBy: {order: 'asc'}});
  
  let totalRawContent = "";
  sections.forEach(s => {
    let content = s.rawContent || "";
    // Remove Markdown OCR tag
    content = content.replace(/\[MARKDOWN_OCR_SUCCESS\]/g, "");
    
    // Remove Visual Blocks
    // Visual block starts with **[GÖRSEL İÇERİKLER]** or similar
    // We can do a naive regex or split
    const visualParts = content.split(/\*\*\[GÖRSEL İÇERİKLER\]\*\*/g);
    let cleanedContent = visualParts[0];
    for (let i = 1; i < visualParts.length; i++) {
        // Assume visual block ends at the next heading (starting with #) or end of section
        const endOfVisualIdx = visualParts[i].search(/\n#{1,3} /);
        if (endOfVisualIdx !== -1) {
            cleanedContent += visualParts[i].substring(endOfVisualIdx);
        }
    }
    
    totalRawContent += cleanedContent + "\n";
  });
  
  const rawContentText = totalRawContent.replace(/\s+/g, ' ').trim();
  const rawContentLength = rawContentText.length;
  
  console.log("Native PDF (pdf2json) Character Count:", rawPdfLength);
  console.log("Gemini OCR (Cleaned) Character Count:", rawContentLength);
  console.log("Fark (Gemini OCR - Native):", rawContentLength - rawPdfLength);
}

run();
