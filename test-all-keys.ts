import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const geminiKeys = (process.env.GEMINI_API_KEYS || '').split(',').filter(k => k.trim());
console.log(`Loaded ${geminiKeys.length} keys from environment.\n`);

async function testAll() {
  let workingCount = 0;
  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[i].trim();
    const headers = { "Content-Type": "application/json" };
    const body = {
      contents: [{ parts: [{ text: "Hello" }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 10 }
    };
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`,
        body,
        { headers, timeout: 10000 }
      );
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No text";
      console.log(`🔑 Key #${i + 1}: SUCCESS ✅ -> "${text.trim()}"`);
      workingCount++;
    } catch (e: any) {
      console.log(`🔑 Key #${i + 1}: FAILED ❌ -> Status: ${e.response?.status || e.code || 'unknown'}, Msg: ${e.response?.data?.error?.message || e.message}`);
    }
  }
  console.log(`\nSummary: ${workingCount}/${geminiKeys.length} keys are working.`);
}

testAll().catch(console.error);
