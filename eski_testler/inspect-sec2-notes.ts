import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  const section = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 2
    }
  });

  if (!section || !section.notes) {
    console.log("Section 2 notes not found!");
    process.exit(1);
  }

  const lines = section.notes.split("\n");
  for (let i = 110; i < Math.min(lines.length, 125); i++) {
    console.log(`Line ${i}:`, JSON.stringify(lines[i]));
  }
  process.exit(0);
}

main().catch(console.error).finally(() => prisma.$disconnect());
