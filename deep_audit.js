const fs = require('fs');

const transcripts = [
  '/Users/selimkaya/.gemini/antigravity-ide/brain/d87558fa-9960-4390-9346-afcd6072496d/.system_generated/logs/transcript.jsonl',
  '/Users/selimkaya/.gemini/antigravity-ide/brain/970578b2-f0f3-4614-8d46-bdc099eb9bd4/.system_generated/logs/transcript.jsonl'
];

let allEdits = [];
let allUserRequests = [];

for (const tPath of transcripts) {
  if (!fs.existsSync(tPath)) continue;
  const lines = fs.readFileSync(tPath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'USER_INPUT') {
        allUserRequests.push(`[${entry.created_at}] USER: ${entry.content}`);
      } else if (entry.type === 'PLANNER_RESPONSE' && entry.tool_calls) {
        for (const call of entry.tool_calls) {
          if (call.name === 'replace_file_content' || call.name === 'multi_replace_file_content' || call.name === 'write_to_file') {
            allEdits.push({
              time: entry.created_at,
              file: call.args.TargetFile,
              desc: call.args.Description || call.args.Instruction,
              content: call.args.ReplacementContent || call.args.CodeContent || JSON.stringify(call.args.ReplacementChunks)
            });
          }
        }
      }
    } catch (e) {}
  }
}

fs.writeFileSync('audit_requests.log', allUserRequests.join('\n\n'));
fs.writeFileSync('audit_edits.log', JSON.stringify(allEdits, null, 2));
console.log("Audit data extracted. Found", allUserRequests.length, "requests and", allEdits.length, "edits.");
