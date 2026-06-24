import * as fs from "fs";
import { extractAllText } from "./src/lib/pdf-engine";

async function run() {
  const buf = fs.readFileSync("/Users/selimkaya/.gemini/antigravity/scratch/spl-study-assistant-v2/uploads/bd-bilgi-sistemleri-guvenligi-1781698194056.pdf");
  const texts = await extractAllText(buf);
  for (let i = 10; i < 20; i++) {
    console.log(`\n=== PAGE ${i + 1} ===\n`);
    console.log(texts[i]?.substring(0, 500));
  }
}
run().catch(console.error);
