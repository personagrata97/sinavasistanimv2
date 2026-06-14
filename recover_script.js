const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('/Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let targetContent = "";
  let found = false;

  for await (const line of rl) {
    const entry = JSON.parse(line);
    if (entry.source === "SYSTEM" && entry.type === "TOOL_RESPONSE" && entry.name === "view_file") {
      if (entry.content && entry.content.includes("start-ai-generation.ts") && entry.content.includes("Showing lines 1 to")) {
        // We found a view_file output for start-ai-generation.ts
        targetContent = entry.content;
        found = true;
      }
    }
  }

  if (found) {
    // Extract the code from the view_file output
    // The format is: <line_number>: <original_line>
    const lines = targetContent.split('\n');
    let codeLines = [];
    for (let l of lines) {
      const match = l.match(/^\d+:\s(.*)$/);
      if (match) {
        codeLines.push(match[1]);
      }
    }
    fs.writeFileSync('recovered_start_ai.ts', codeLines.join('\n'));
    console.log("Successfully recovered to recovered_start_ai.ts");
  } else {
    console.log("Could not find view_file output.");
  }
}

processLineByLine();
