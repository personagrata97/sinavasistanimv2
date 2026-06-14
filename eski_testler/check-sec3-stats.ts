import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  console.log("🚀 [SEC 3 STATS] Querying Section 3 details from database...");

  const section = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 3
    }
  });

  if (!section) {
    console.error("❌ Section 3 not found in database!");
    process.exit(1);
  }

  console.log("=== SECTION 3 DETAILED STATS ===");
  console.log("Title:", section.title);
  console.log("Page Start:", section.pageStart);
  console.log("Page End:", section.pageEnd);
  console.log("Raw Source Text Length (chars):", section.rawContent ? section.rawContent.length : 0);
  console.log("Generated Notes Length (chars):", section.notes ? section.notes.length : 0);
  console.log("Verification Score:", section.verificationScore);

  process.exit(0);
}

main().catch(console.error).finally(() => prisma.$disconnect());
