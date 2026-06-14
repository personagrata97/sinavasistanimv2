const { execSync } = require('child_process');
const fs = require('fs');

try {
  // Extract the file content from git at HEAD
  const content = execSync('git show HEAD:start-ai-generation.ts').toString();
  
  // Write it back to the file
  fs.writeFileSync('start-ai-generation.ts', content);
  console.log("Successfully restored start-ai-generation.ts from git HEAD!");
} catch (e) {
  console.error("Error:", e.message);
}
