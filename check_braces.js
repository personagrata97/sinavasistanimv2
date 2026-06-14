const fs = require('fs');

const code = fs.readFileSync('src/app/api/courses/process/route.ts', 'utf8');
let stack = [];
const lines = code.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '{') {
      stack.push({ line: i + 1, col: j + 1 });
    } else if (char === '}') {
      if (stack.length === 0) {
        console.log(`Extra } found at line ${i + 1}`);
      } else {
        stack.pop();
      }
    }
  }
}

if (stack.length > 0) {
  console.log("Unclosed braces:");
  stack.forEach(b => console.log(`{ at line ${b.line}, col ${b.col}`));
} else {
  console.log("Braces are balanced.");
}
