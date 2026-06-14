import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import { verifyNotesAgainstSource } from "./src/lib/ai-service";

async function main() {
  console.log(">>> Running isolated verification test for Section 6...");

  const sec6 = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 6
    }
  });

  if (!sec6) {
    console.error("❌ Section 6 not found!");
    return;
  }

  console.log(`Section 6 Title: "${sec6.title}"`);
  console.log(`Verification Score in DB: ${sec6.verificationScore}%`);

  console.log("🚀 Running verifyNotesAgainstSource with fileUri = undefined...");
  const start = Date.now();
  const verification = await verifyNotesAgainstSource(
    sec6.rawContent,
    sec6.notes || "",
    sec6.title,
    undefined, // bypass PDF to isolate verification strictly to rawContent
    sec6.pageStart,
    sec6.pageEnd
  );
  const elapsed = Math.round((Date.now() - start) / 1000);

  console.log(`\n=================== VERIFICATION RESULTS (${elapsed}s) ===================`);
  console.log(`New Verification Score: ${verification.score}%`);
  console.log("Missing Topics:", verification.missingTopics);
  console.log("Issues:", verification.issues);
  console.log("Suggestions:", verification.suggestions);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
