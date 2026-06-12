async function main() {
  const fs = require('fs');
  const envContent = fs.readFileSync('.env', 'utf-8');
  const geminiKeysMatch = envContent.match(/GEMINI_API_KEYS=(.+)/);
  if (!geminiKeysMatch) return;
  
  const keys = geminiKeysMatch[1].split(',').map((k: string) => k.trim()).filter((k: string) => k);
  console.log(`Testing ${keys.length} keys on Gemini API...`);
  
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
      });
      const data = await response.json();
      if (response.ok) {
        console.log(`Key #${i + 1}: ✅ VALID`);
      } else {
        const errMsg = data.error?.message || "Unknown";
        if (errMsg.includes("leaked") || response.status === 403) {
          console.log(`Key #${i + 1}: ❌ LEAKED (403) - ${errMsg.substring(0, 50)}`);
        } else if (errMsg.includes("quota") || response.status === 429) {
          console.log(`Key #${i + 1}: ⚠️ QUOTA EXCEEDED (429)`);
        } else {
          console.log(`Key #${i + 1}: ❓ ERROR: ${errMsg.substring(0, 50)}`);
        }
      }
    } catch (e: any) {
      console.log(`Key #${i + 1}: ❓ CRASH - ${e.message.substring(0, 50)}`);
    }
  }
}
main();
