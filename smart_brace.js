const fs = require('fs');

const code = fs.readFileSync('src/app/api/courses/process/route.ts', 'utf8');
let stack = [];
let inString = false;
let stringChar = '';
let inTemplate = false;

const lines = code.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    
    // Ignore strings
    if (!inString && !inTemplate && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      continue;
    }
    if (inString && char === stringChar && line[j-1] !== '\\') {
      inString = false;
      continue;
    }
    
    // Ignore templates
    if (!inString && !inTemplate && char === '`') {
      inTemplate = true;
      continue;
    }
    if (inTemplate && char === '`' && line[j-1] !== '\\') {
      inTemplate = false;
      continue;
    }

    if (!inString && !inTemplate) {
      if (char === '{') {
        stack.push({ line: i + 1, col: j + 1 });
      } else if (char === '}') {
        if (stack.length === 0) {
          console.log(`EXTRA } found at line ${i + 1}`);
        } else {
          stack.pop();
        }
      }
    }
  }
}

if (stack.length > 0) {
  console.log("UNCLOSED { at:");
  stack.forEach(b => console.log(`{ at line ${b.line}, col ${b.col}`));
} else {
  console.log("Braces are PERFECTLY balanced.");
}
