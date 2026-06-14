import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  console.log("🔍 [BOLD AUDIT] Inspecting Sections 1, 2, 3, 4 notes for excessive bolding...");

  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: { in: [1, 2, 3, 4] }
    },
    orderBy: { order: "asc" }
  });

  for (const s of sections) {
    if (!s.notes) continue;
    
    console.log(`\n📄 --- Section ${s.order}: "${s.title}" ---`);
    const lines = s.notes.split("\n");
    let foundSuspicious = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if a significant portion of a line is bolded or if the line starts and ends with **
      // e.g. **This is a whole bolded sentence.**
      const startsAndEndsBold = line.startsWith("**") && line.endsWith("**") && line.length > 30;
      
      // Or check if there are large chunks like **text** that are longer than 50 characters
      const boldRegex = /\*\*([^*]{50,})\*\*/g;
      const matches = line.match(boldRegex);

      if (startsAndEndsBold || matches) {
        console.log(`[Line ${i}]:`, JSON.stringify(line));
        foundSuspicious = true;
      }
    }

    if (!foundSuspicious) {
      console.log("  ✅ No excessively bolded sentences found in this section.");
    }
  }

  process.exit(0);
}

main().catch(console.error).finally(() => prisma.$disconnect());
