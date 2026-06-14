import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import { refineSectionNotesAction } from "./src/lib/actions";

async function main() {
  console.log(">>> [REFINEMENT RUNNER] Starting batch refinement for sections under 100...");

  // Find all sections under 100
  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      verificationScore: { lt: 100 }
    },
    orderBy: { order: "asc" }
  });

  console.log(`Found ${sections.length} sections to refine.`);

  for (const sec of sections) {
    console.log(`\n----------------------------------------`);
    console.log(`🚀 Refining Section #${sec.order}: "${sec.title}"`);
    console.log(`   Current Score: ${sec.verificationScore}%`);

    let currentScore = sec.verificationScore ?? 0;
    let attempt = 1;
    const maxAttempts = 10;

    while (currentScore < 100 && attempt <= maxAttempts) {
      console.log(`   👉 Attempt #${attempt}/${maxAttempts}...`);
      
      const start = Date.now();
      const res = await refineSectionNotesAction(sec.id);
      const elapsed = Math.round((Date.now() - start) / 1000);

      if ('error' in res && res.error) {
        console.error(`   ❌ Error refining section: ${res.error}`);
        break;
      }

      // Re-fetch score
      const updated = await prisma.section.findUnique({
        where: { id: sec.id }
      });

      if (!updated) {
        console.error(`   ❌ Section not found after update!`);
        break;
      }

      currentScore = updated.verificationScore ?? 0;
      console.log(`   ✅ Attempt #${attempt} completed in ${elapsed}s. New Score: ${currentScore}%`);

      if (currentScore >= 100) {
        console.log(`   ✨ Section #${sec.order} successfully reached target quality threshold (>=100%)!`);
        break;
      }

      attempt++;
    }
  }

  console.log("\n>>> [REFINEMENT RUNNER] Batch refinement completed successfully!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
