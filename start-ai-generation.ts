import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import { generateCourseNotes, generateFlashcards, generateQuestions, analyzeSectionContent, verifyNotesAgainstSource, auditNotesAgainstSourceSpecific, setFileUrisMap } from "./src/lib/ai-service";
import { ensureGeminiFileUris } from "./src/lib/gemini-file-helper";
import * as fs from "fs";

async function main() {
  const slug = "bd-bilgi-sistemleri-guvenligi";
  const course = await prisma.course.findUnique({
    where: { slug },
    include: { program: true }
  });

  if (!course) {
    console.error("Course not found!");
    process.exit(1);
  }

  const sections = await prisma.section.findMany({
    where: { courseId: course.id, processed: false },
    orderBy: { order: "asc" }
  });

  console.log(`[AI_PROCESS] Found ${sections.length} unprocessed sections for BİLGİ SİSTEMLERİ GÜVENLİĞİ.`);
  
  const aiMode = course.program?.aiMode || "law";

  let activeFileUri: string | undefined = undefined;
  if (course.pdfPath) {
    console.log("[AI_PROCESS] Ensuring PDF is uploaded to Gemini File API for image parsing...");
    const { uriMap, updated } = await ensureGeminiFileUris(course.pdfPath, course.geminiFileUris, course.slug);
    if (updated) {
      await prisma.course.update({
        where: { id: course.id },
        data: { geminiFileUris: JSON.stringify(uriMap) }
      });
    }
    setFileUrisMap(uriMap);
    activeFileUri = uriMap["0"] || undefined;
    console.log(`[AI_PROCESS] Gemini File API mapping ready. Base URI: ${activeFileUri || "None"}`);
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    console.log(`\n[AI_PROCESS] [${i + 1}/${sections.length}] Processing "${section.title}" (Page ${section.pageStart}-${section.pageEnd})...`);

    try {
      // 1. Generate Notes
      console.log("  -> Generating Course Notes...");
      let notes = await generateCourseNotes(
        section.rawContent,
        section.title,
        course.name,
        course.userLevel,
        aiMode,
        activeFileUri,
        section.pageStart,
        section.pageEnd
      );
      console.log(`  -> Initial Generated Notes: ${notes.length} chars`);

      // 2. Validate Notes
      console.log("  -> Validating Notes against source...");
      let verification = await verifyNotesAgainstSource(
        section.rawContent,
        notes,
        section.title,
        activeFileUri,
        section.pageStart,
        section.pageEnd
      );
      console.log(`  -> Initial Verification Score: ${verification.score}/100`);

      const attemptHistory: any[] = [];
      attemptHistory.push({
        attempt: 0,
        score: verification.score,
        missingTopics: [...(verification.missingTopics || [])],
        issues: [...(verification.issues || [])],
        suggestions: [...(verification.suggestions || [])]
      });

      // 🔄 AUTOMATIC REFINEMENT LOOP UNTIL 100 SCORE AND 0 ISSUES/SUGGESTIONS REACHED (MAX 5 ATTEMPTS)
      let currentScore = verification.score || 0;
      let attempt = 1;
      const maxAttempts = 10;
      let allIssues = [...(verification.missingTopics || []), ...(verification.issues || []), ...(verification.suggestions || [])];

      while ((currentScore < 100 || allIssues.length > 0) && attempt <= maxAttempts) {
        console.log(`  🔄 [TELAFİ DÖNGÜSÜ] Kalite kriterleri tam karşılanmadı (Skor: ${currentScore}%, Kalan Eksik/Öneri: ${allIssues.length}). İyileştirme denemesi #${attempt}/${maxAttempts} yapılıyor...`);
        
        // Kotaların kilitlenmesini önlemek için istek öncesi nefes payı
        await new Promise(r => setTimeout(r, 8000));

        const missingList = allIssues.join("\n- ");
        const enrichedContent = `⚠️⚠️⚠️ ÖNCEKİ DENEMEDE ATLANAN VEYA İYİLEŞTİRİLMESİ ÖNERİLEN KONULAR — BU SEFER KESİNLİKLE DERS NOTUNUN İÇİNE DOĞAL BİR AKIŞLA EKLE VE DETAYLANDIR:
- ${missingList}

Yukarıdaki eksik konuları aşağıdaki mevcut ders notunun ilgili paragraflarına ekleyerek notu geliştir ve baştan yaz. Bilgi kaybını önlemek için mevcut notun içindeki hiçbir kritik tanımı, başlığı, tabloyu veya şemayı KESİNLİKLE SİLME, sadece zenginleştir! Tam bir akış oluştur, sonuna yama gibi ekleme!

--- MEVCUT DERS NOTLARI ---
${notes}

--- ASIL KAYNAK METİN ---
${section.rawContent}`;
        
        notes = await generateCourseNotes(
          enrichedContent,
          section.title,
          course.name,
          course.userLevel,
          aiMode,
          activeFileUri,
          section.pageStart,
          section.pageEnd
        );

        // Doğrulama API çağrısı öncesi nefes payı
        await new Promise(r => setTimeout(r, 5000));

        verification = await verifyNotesAgainstSource(
          section.rawContent,
          notes,
          section.title,
          activeFileUri,
          section.pageStart,
          section.pageEnd
        );

        currentScore = verification.score || 0;
        allIssues = [...(verification.missingTopics || []), ...(verification.issues || []), ...(verification.suggestions || [])];
        console.log(`  ✅ İyileştirme #${attempt} tamamlandı. Yeni Skor: ${currentScore}%, Kalan Eksik/Öneri: ${allIssues.length}`);
        
        attemptHistory.push({
          attempt: attempt,
          score: currentScore,
          missingTopics: [...(verification.missingTopics || [])],
          issues: [...(verification.issues || [])],
          suggestions: [...(verification.suggestions || [])]
        });

        attempt++;
      }

      // 4. Katman: Rastgele 3 Konu Seçimli Bağımsız Çapraz Denetim (Deep Audit)
      console.log("  -> Analyzing Section Content to extract topics for Deep Audit...");
      const analysisForAudit = await analyzeSectionContent(section.rawContent, section.title, aiMode, undefined);
      const sectionTopics = analysisForAudit.topics || [];
      
      if (sectionTopics.length > 0) {
        const shuffled = [...sectionTopics].sort(() => 0.5 - Math.random());
        const selectedTopics = shuffled.slice(0, 3);
        
        console.log(`  🔍 [DERİN DENETİM] Seçilen ${selectedTopics.length} rastgele konu denetleniyor: ${selectedTopics.join(", ")}...`);
        const auditResult = await auditNotesAgainstSourceSpecific(
          section.rawContent,
          notes,
          section.title,
          selectedTopics,
          activeFileUri,
          section.pageStart,
          section.pageEnd
        );
        
        if (!auditResult.passed) {
          const auditIssues = [
            ...(auditResult.missingDetails || []).map(d => `[DENETİM EKSİĞİ] ${d}`),
            ...(auditResult.contradictions || []).map(c => `[DENETİM HATASI] ${c}`)
          ];
          
          console.warn(`  ❌ [DERİN DENETİM BAŞARISIZ] Hatalar/Eksikler tespit edildi:\n  - ${auditIssues.join("\n  - ")}`);
          console.log(`  🔄 [TELAFİ EK ADIM] Denetçi bulguları nota eklenmek üzere telafi döngüsüne aktarılıyor...`);
          
          await new Promise(r => setTimeout(r, 8000));
          
          const missingList = auditIssues.join("\n- ");
          const enrichedContent = `⚠️⚠️⚠️ BAĞIMSIZ DENETÇİNİN (AUDIT AGENT) TESPİT ETTİĞİ EKSİK VEYA HATALAR — BU DETAYLARI DERS NOTUNUN İÇİNE KUSURSUZ ŞEKİLDE EKLE VE DÜZELT:
- ${missingList}

Mevcut şemaları, Mermaid diyagramlarını ve tabloları KESİNLİKLE silmeden notu zenginleştir!

--- MEVCUT DERS NOTLARI ---
${notes}

--- ASIL KAYNAK METİN ---
${section.rawContent}`;
          
          notes = await generateCourseNotes(
            enrichedContent,
            section.title,
            course.name,
            course.userLevel,
            aiMode,
            activeFileUri,
            section.pageStart,
            section.pageEnd
          );
          
          await new Promise(r => setTimeout(r, 5000));
          verification = await verifyNotesAgainstSource(
            section.rawContent,
            notes,
            section.title,
            activeFileUri,
            section.pageStart,
            section.pageEnd
          );
          
          attemptHistory.push({
            attempt: attempt,
            score: verification.score,
            missingTopics: [...(verification.missingTopics || [])],
            issues: [`[Denetim Sonrası] ${auditIssues.join(", ")}`, ...(verification.issues || [])],
            suggestions: [...(verification.suggestions || [])]
          });
          
          console.log(`  ✅ Denetim sonrası iyileştirme tamamlandı. Yeni Skor: ${verification.score || 0}%`);
        } else {
          console.log(`  ✅ [DERİN DENETİM BAŞARILI] Hedeflenen ${selectedTopics.length} konuda en ufak bir açık veya mevzuat hatası bulunamadı!`);
        }
      }

      // 3. Generate Flashcards
      console.log("  -> Generating Flashcards...");
      const flashcards = await generateFlashcards(
        section.rawContent + "\n\n" + notes,
        section.title,
        course.name,
        course.userLevel,
        aiMode,
        activeFileUri,
        section.pageStart,
        section.pageEnd
      );
      console.log(`  -> Generated ${flashcards.length} Flashcards`);

      // 4. Generate Questions
      console.log("  -> Generating Questions...");
      let questions = await generateQuestions(
        section.rawContent + "\n\n" + notes,
        section.title,
        course.name,
        course.userLevel,
        aiMode,
        activeFileUri,
        section.pageStart,
        section.pageEnd,
        section.importance || undefined
      );
      console.log(`  -> Generated Questions: ${questions.length}`);

      // 5. Analyze Section Content
      console.log("  -> Analyzing Section Content...");
      const analysis = await analyzeSectionContent(section.rawContent, section.title, aiMode, undefined);

      // Save to database
      console.log("  -> Saving everything to database...");
      await prisma.section.update({
        where: { id: section.id },
        data: {
          notes: notes,
          summary: analysis.summary || "",
          importance: analysis.importance || "Medium",
          topics: JSON.stringify(analysis.topics || []),
          module: (analysis as any).module || null,
          processed: true,
          verificationScore: verification.score,
          verificationIssues: JSON.stringify({
            missingTopics: verification.missingTopics || [],
            issues: verification.issues || [],
            suggestions: verification.suggestions || [],
            attemptHistory: attemptHistory
          })
        }
      });

      // Save flashcards
      for (const card of flashcards) {
        try {
          await prisma.flashcard.create({
            data: {
              courseId: course.id,
              sectionId: section.id,
              front: card.front,
              back: card.back,
              difficulty: card.difficulty || "medium"
            }
          });
        } catch {}
      }

      // Save questions
      for (const q of questions) {
        try {
          await prisma.question.create({
            data: {
              courseId: course.id,
              sectionId: section.id,
              text: q.text,
              options: JSON.stringify(q.options),
              correct: q.correct,
              explanation: q.explanation,
              difficulty: q.difficulty || "medium",
              module: (analysis as any).module || null
            }
          });
        } catch {}
      }

      console.log(`  ✅ Section "${section.title}" fully processed and saved!`);
      // Update updatedAt on course to trigger UI refresh
      await prisma.course.update({
        where: { id: course.id },
        data: { updatedAt: new Date() }
      });

    } catch (err: any) {
      console.error(`  ❌ Failed to process section "${section.title}":`, err.message);
      console.log("  ⏱️ [TELAFİ MODU] Kota sınırı veya bağlantı hatası oluştu. API kotalarının temizlenmesi için 60 saniye bekleniyor ve ardından bu bölüm TEKRAR DENENECEK...");
      await new Promise(r => setTimeout(r, 60000));
      i--; // Decrement to retry this section
      continue;
    }

    // Rate limiting safeguard
    await new Promise(r => setTimeout(r, 2000));
  }

  // Set course status to ready
  await prisma.course.update({
    where: { id: course.id },
    data: { status: "ready" }
  });

  console.log("\n[AI_PROCESS] 🎉 All 18 sections successfully processed and generated!");
  process.exit(0);
}

main().catch(console.error).finally(() => prisma.$disconnect());
