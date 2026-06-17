import fs from 'fs';
import path from 'path';

let envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) envPath = path.join(process.cwd(), '.env.local');

const envContent = fs.readFileSync(envPath, 'utf-8');
let keysStr = "";
envContent.split('\n').forEach(line => {
  if (line.startsWith('GEMINI_API_KEYS=')) {
    keysStr = line.split('GEMINI_API_KEYS=')[1]?.trim() || "";
  }
});

// clean quotes
keysStr = keysStr.replace(/^["']/, '').replace(/["']$/, '');
const keys = keysStr.split(',').map(k => k.trim()).filter(Boolean);

if (keys.length === 0) {
  console.error("Hiç API anahtarı bulunamadı.");
  process.exit(1);
}

console.log(`Toplam ${keys.length} adet API anahtarı bulundu. Limit testi (Burst) başlatılıyor...`);

async function testKeyLimit(key: string, index: number) {
  console.log(`\n--- Anahtar #${index + 1} Hız Testi (Aynı Anda 20 İstek) ---`);
  
  const reqs = 20; 
  let success = 0;
  let failed = 0;
  let rateLimitHits = 0;
  let firstErrorMsg = "";

  const promises = [];
  
  for (let i = 0; i < reqs; i++) {
    promises.push(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Kısa bir test." }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }).then(res => res.json()).then(data => {
        if (data.error) {
          failed++;
          if (data.error.code === 429) rateLimitHits++;
          if (!firstErrorMsg) firstErrorMsg = data.error.message;
        } else {
          success++;
        }
      }).catch(err => {
        failed++;
        if (!firstErrorMsg) firstErrorMsg = err.message;
      })
    );
  }

  await Promise.all(promises);
  
  console.log(`\nSonuçlar (Key #${index + 1}):`);
  console.log(`✅ Başarılı Yanıtlar: ${success}`);
  console.log(`❌ Başarısız Yanıtlar: ${failed} (Bunun ${rateLimitHits} tanesi 429 Quota/Limit Hatası)`);
  if (failed > 0) {
    console.log(`⚠️ Google'dan Gelen Limit Uyarı Mesajı: "${firstErrorMsg.substring(0, 150)}..."`);
  }
}

async function run() {
  const keysToTest = keys.slice(0, 2);
  for (let i = 0; i < keysToTest.length; i++) {
    await testKeyLimit(keysToTest[i], i);
  }
}

run();
