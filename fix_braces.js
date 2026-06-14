const fs = require('fs');

let code = fs.readFileSync('src/app/api/courses/process/route.ts', 'utf8');

// The block before `} else {` at line 894
code = code.replace(
  `                        // sistem eksikleri Smart Inject ile kapatmaya çalışacaktır.\n                      }\n                    } else {`,
  `                        // sistem eksikleri Smart Inject ile kapatmaya çalışacaktır.\n                      }\n                    }\n                  } else {`
);

fs.writeFileSync('src/app/api/courses/process/route.ts', code);
console.log("Brace added.");
