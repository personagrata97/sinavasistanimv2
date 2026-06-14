import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import { generateQuestions } from "./src/lib/ai-service";

async function main() {
  console.log(">>> [QUESTION REGENERATOR] Checking for sections with 0 questions...");

  const sections = await prisma.section.findMany({
    where: {
      course: { slug: "masak-uyum-gorevlisi" }
    },
    include: {
      course: {
        include: { program: true }
      },
      _count: {
        select: { questions: true }
      }
    },
    orderBy: { order: "asc" }
  });

  const missingSections = sections.filter(s => s._count.questions === 0);
  console.log(`Found ${missingSections.length} sections with 0 questions:`, missingSections.map(s => `#${s.order} ${s.title}`));

  for (const sec of missingSections) {
    console.log(`\n--------------------------------------------------`);
    console.log(`🚀 Generating questions for Section #${sec.order}: "${sec.title}"...`);

    const course = sec.course;
    const aiMode = course.program?.aiMode || "law";

    const fullContent = `${sec.rawContent}\n\n--- DERS NOTLARI ---\n${sec.notes || ""}`;

    try {
      console.log(`   👉 Requesting AI to generate questions (PDF page ${sec.pageStart}-${sec.pageEnd})...`);
      let questions = await generateQuestions(
        fullContent,
        sec.title,
        course.name,
        course.userLevel,
        aiMode,
        undefined, // bypass PDF to prevent key-specific 403 errors
        sec.pageStart,
        sec.pageEnd
      );

      console.log(`   ✅ AI generated ${questions.length} questions.`);

      if (questions.length === 0) {
        console.log(`   ⚠️ Attempting secondary generation because 0 questions were returned...`);
        questions = await generateQuestions(
          fullContent,
          sec.title,
          course.name,
          course.userLevel,
          aiMode,
          undefined, // fallback without PDF attachment to prevent 429 or parse errors
          sec.pageStart,
          sec.pageEnd
        );
      }

      if (questions.length > 0) {
        // Clear any orphaned questions (just in case)
        await prisma.question.deleteMany({ where: { sectionId: sec.id } });

        // Save newly generated questions
        let savedCount = 0;
        for (const q of questions) {
          try {
            await prisma.question.create({
              data: {
                courseId: course.id,
                sectionId: sec.id,
                text: q.text,
                options: JSON.stringify(q.options),
                correct: q.correct,
                explanation: q.explanation,
                difficulty: q.difficulty || "medium",
                module: sec.module
              }
            });
            savedCount++;
          } catch (dbErr: any) {
            console.error(`      ❌ DB Insert error: ${dbErr.message}`);
          }
        }
        console.log(`   🎉 Successfully saved ${savedCount}/${questions.length} questions in database for Section #${sec.order}!`);
      } else {
        console.log(`   ❌ Failed to generate any valid questions for Section #${sec.order}`);
      }
    } catch (err: any) {
      console.error(`   ❌ Error during question generation for Section #${sec.order}:`, err.message);
    }

    // Rate limit cooldown between sections to allow API key quotas to reset
    await new Promise(r => setTimeout(r, 35000));
  }

  console.log("\n>>> [QUESTION REGENERATOR] Process completed!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
