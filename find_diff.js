const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('/Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let viewOutputs = [];
  for await (const line of rl) {
    const entry = JSON.parse(line);
    if (entry.source === "SYSTEM" && entry.type === "TOOL_RESPONSE") {
      if (entry.content.includes("route.ts") && entry.content.includes("Showing lines")) {
        // Find the lines
        const lines = entry.content.split('\n');
        for (let l of lines) {
          const match = l.match(/^(\d+):\s(.*)$/);
          if (match) {
            viewOutputs[parseInt(match[1])] = match[2];
          }
        }
      }
    }
  }

  const currentFile = fs.readFileSync('src/app/api/courses/process/route.ts', 'utf8').split('\n');
  
  console.log("Differences found in the lines I viewed before the checkout:");
  let foundDiff = false;
  for (let i = 1; i < viewOutputs.length; i++) {
    if (viewOutputs[i] !== undefined) {
      const oldLine = viewOutputs[i];
      const newLine = currentFile[i-1] || "";
      if (oldLine !== newLine) {
        console.log(`Line ${i}:`);
        console.log(`  OLD (What I saw before git checkout) : ${oldLine}`);
        console.log(`  NEW (What is in the file right now)  : ${newLine}`);
        foundDiff = true;
      }
    }
  }
  if (!foundDiff) console.log("No differences found in the lines I viewed.");
}
processLineByLine();
