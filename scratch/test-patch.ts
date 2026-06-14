import { generateAndInjectPatch } from '../src/lib/patch-engine';

const md = `
## 📌 Varlık Yönetimi

### 🎯 Bu Bölüm Ne Anlatıyor?
Varlık yönetimi giriş cümlesi.

### 🏢 Konu 1: Kurallar
Portföy yönetim şirketleri portföy işletir.

### 🏢 Konu 2: İstisnalar
- Bir istisna
- İki istisna
`;

const facts = ["Eksik Detay (Ground Truth Testi Başarısız): Asgari sermaye 5 milyon TL olmalıdır.", "Kolektif yatırım kuruluşlarına hizmet verirler."];

async function run() {
  const res = await generateAndInjectPatch(md, facts, "Varlık Yönetimi", "RAW");
  console.log("Success:", res.success);
  console.log("Failed Facts:", res.failedFacts);
  console.log("New MD:\n", res.newMarkdown);
}

run();
