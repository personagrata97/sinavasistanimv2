const fs = require('fs');
const filePath = 'src/app/program/[programSlug]/[courseSlug]/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  /const isActionNeeded = course\.sections\?\.some\(\(s: any\) => \{\s*try \{\s*const issues = typeof s\.verificationIssues === "string" \? JSON\.parse\(s\.verificationIssues\) : \(s\.verificationIssues \|\| \{\}\);\s*return issues\.needsUserAction === true;\s*\} catch \{ return false; \}\s*\}\);\s*if \(isActionNeeded\) return "Bir bölüm 5 denemede de %100 alamadı, müdahale bekleniyor\. Arka planda diğer işlemler devam ediyor\.";/g,
  `const sectionWithAction = course.sections?.find((s: any) => {
                        try {
                          const issues = typeof s.verificationIssues === "string" ? JSON.parse(s.verificationIssues) : (s.verificationIssues || {});
                          return issues.needsUserAction === true;
                        } catch { return false; }
                      });
                      
                      if (sectionWithAction) return \`🚨 [\${sectionWithAction.title}] 5 denemede de %100 alamadı, manuel müdahale bekleniyor.\`;`
);

fs.writeFileSync(filePath, content);
console.log("Patched UI!");
