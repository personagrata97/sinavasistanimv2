import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import axios from "axios";

const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const geminiKeys = (process.env.GEMINI_API_KEYS || geminiKey || "").split(",").filter(k => k.trim());
let currentKeyIndex = 2; // Let's start from index 2 (Key #3) which we know has quota!

async function callGeminiWithRotation(prompt: string): Promise<string> {
  if (geminiKeys.length === 0) throw new Error("No Gemini API keys found!");
  
  const startIndex = currentKeyIndex;
  let triedAll = false;

  while (!triedAll) {
    const activeKey = geminiKeys[currentKeyIndex % geminiKeys.length].trim();
    const headers = { "Content-Type": "application/json", "x-goog-api-key": activeKey };

    try {
      console.log(`  🔑 [ROTATION] Attempting with Key #${(currentKeyIndex % geminiKeys.length) + 1}...`);
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 16384 }
        },
        { headers, timeout: 120000 }
      );

      const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (result) return result;
    } catch (e: any) {
      console.warn(`  ⚠️ Key #${(currentKeyIndex % geminiKeys.length) + 1} failed: ${e.message?.substring(0, 100)}`);
      if (e.message.includes("429") || e.response?.data?.error?.message?.includes("429")) {
        currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;
        if (currentKeyIndex === startIndex) {
          triedAll = true;
        } else {
          console.log("  ⏱️ Waiting 2s before switching key...");
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        throw e;
      }
    }
  }

  throw new Error("All Gemini API keys exhausted with 429!");
}

async function main() {
  console.log("🚀 [LAYOUT REFACTOR] Starting notes layout refactoring for Section 1 and Section 2...");

  const sectionsToRefactor = [1, 2];

  for (const order of sectionsToRefactor) {
    console.log(`\n🔎 Fetching Section with order ${order}...`);
    const section = await prisma.section.findFirst({
      where: {
        course: { slug: "masak-uyum-gorevlisi" },
        order: order
      }
    });

    if (!section || !section.notes) {
      console.log(`⚠️ Section with order ${order} or its notes not found!`);
      continue;
    }

    console.log(`📄 Found: "${section.title}" (Notes length: ${section.notes.length} chars)`);
    console.log("  -> Asking Gemini to refactor layouts (nesting stories under concepts)...");

    const prompt = `
Aşağıdaki ders notlarını yapısal olarak yeniden düzenle.

⚠️⚠️⚠️ KESİN KURALLAR:
1. Ders notundaki hiçbir resmi tanımı, yasal süreyi, idari para cezasını, Mermaid akış şemalarını veya tabloları KESİNLİKLE değiştirme, ekleme yapma, çıkarma yapma! Bilgi doğruluğunu ve içeriği %100 aynen koru.
2. SADECE notun en altında yer alan "Hafıza Teknikleri" veya "Hikayeler" başlığı altındaki uzun senaryoları/hikayeleri (Ahmet Bey, Ayşe Hanım vb. hikayeleri) al ve üst taraftaki İLGİLİ kavramın veya başlığın hemen altına alt madde/alt paragraf olarak yerleştir.
3. Örneğin: "Yerleştirme Aşaması" tanımının hemen altına "🎬 Senaryo / Hikaye: Ahmet Bey..." şeklinde o aşamaya ait hikayeyi ekle.
4. Hikayeleri taşıdıktan sonra en altta boş kalan "Hafıza Teknikleri" veya "Hikayeler" başlığını tamamen sil.
5. Çıktı olarak sadece ve sadece yeniden yapılandırılmış Markdown formatındaki ders notlarını döndür. Ek açıklama yazma, "İşte yeni notlar:" deme, doğrudan notun kendisiyle başla.

DERS NOTLARI:
${section.notes}
`;

    try {
      const refactoredNotes = await callGeminiWithRotation(prompt);
      const cleanRefactored = refactoredNotes.replace(/```markdown\s*/i, "").replace(/```\s*$/, "").trim();

      if (cleanRefactored && cleanRefactored.length > 500) {
        console.log(`  ✅ Layout refactored successfully! New length: ${cleanRefactored.length} chars`);
        
        await prisma.section.update({
          where: { id: section.id },
          data: { notes: cleanRefactored }
        });
        
        console.log(`  💾 Saved refactored Section ${order} notes back to database!`);
      } else {
        console.log("  ❌ AI response was empty or too short!");
      }
    } catch (err: any) {
      console.error(`  ❌ Failed to refactor Section ${order}:`, err.message);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n🎉 [LAYOUT REFACTOR] Layout refactoring successfully completed!");
  process.exit(0);
}

main().catch(console.error).finally(() => prisma.$disconnect());
