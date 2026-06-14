import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import { refineSectionNotesAction } from "./src/lib/actions";

async function main() {
  const targetOrders = [6];
  console.log(`>>> Starting targeted refinement for sections: ${targetOrders.join(", ")}`);

  for (const order of targetOrders) {
    const sec = await prisma.section.findFirst({
      where: {
        course: { slug: "masak-uyum-gorevlisi" },
        order: order
      }
    });

    if (!sec) {
      console.log(`❌ Section #${order} not found!`);
      continue;
    }

    console.log(`\n--------------------------------------------------`);
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
        console.error(`   ❌ Error: ${res.error}`);
        break;
      }

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
        console.log(`   ✨ Section #${sec.order} successfully reached target quality threshold (100%)!`);
        break;
      }

      attempt++;
    }
  }

  console.log("\n>>> Targeted refinement completed!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
