import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  console.log("🚀 [STORY FIX] Locating and fixing Section 2 scenario title concatenation in dev.db...");

  const section = await prisma.section.findFirst({
    where: {
      course: { slug: "masak-uyum-gorevlisi" },
      order: 2
    }
  });

  if (!section || !section.notes) {
    console.log("❌ Section 2 or its notes not found in database!");
    process.exit(1);
  }

  // Look for the exact italics and single newline pattern in Section 2 notes
  const targetPattern = "🎬 **Senaryo / Hikaye:** *Ayşe Hanım'ın Acil Durum Hesabı ve 24 Saat Yarışı*\nAyşe Hanım, terörün";
  const replacementPattern = "🎬 **Senaryo / Hikaye - Ayşe Hanım'ın Acil Durum Hesabı ve 24 Saat Yarışı:**\n\nAyşe Hanım, terörün";

  if (section.notes.includes(targetPattern)) {
    console.log("🎯 Found the exact italicized concatenated string!");
    const updatedNotes = section.notes.replace(targetPattern, replacementPattern);

    await prisma.section.update({
      where: { id: section.id },
      data: { notes: updatedNotes }
    });

    console.log("✅ Successfully formatted the Section 2 story header in the database!");
  } else {
    // Try a broad regex fallback to handle minor variations
    const regex = /🎬 \*\*Senaryo \/ Hikaye:\*\* \*Ayşe Hanım'ın Acil Durum Hesabı ve 24 Saat Yarışı\*\s*\n\s*Ayşe Hanım, terörün/;
    if (regex.test(section.notes)) {
      const updatedNotes = section.notes.replace(regex, "🎬 **Senaryo / Hikaye - Ayşe Hanım'ın Acil Durum Hesabı ve 24 Saat Yarışı:**\n\nAyşe Hanım, terörün");
      await prisma.section.update({
        where: { id: section.id },
        data: { notes: updatedNotes }
      });
      console.log("✅ Successfully formatted the Section 2 story header using regex!");
    } else {
      console.log("❌ Could not find the concatenated string in the database notes. Please inspect manually.");
    }
  }

  process.exit(0);
}

main().catch(console.error).finally(() => prisma.$disconnect());
