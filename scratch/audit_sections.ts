import { prisma } from '../src/lib/prisma';

async function main() {
  const sections = await prisma.section.findMany({
    where: { course: { slug: 'bd-bilgi-sistemleri-guvenligi' }, order: { in: [1, 2, 3] } },
    select: { title: true, order: true, processed: true, verificationScore: true, verificationIssues: true, notes: true,
      _count: { select: { questions: true, flashcards: true } }
    },
    orderBy: { order: 'asc' }
  });
  
  for (const s of sections) {
    let issues: any = {};
    try { issues = s.verificationIssues ? JSON.parse(s.verificationIssues as string) : {}; } catch {}
    const history = issues.attemptHistory || [];
    
    console.log(`\n${"=".repeat(80)}`);
    console.log(`BÖLÜM ${s.order}: ${s.title}`);
    console.log(`${"=".repeat(80)}`);
    console.log(`Processed: ${s.processed} | Final Score: ${s.verificationScore}`);
    console.log(`Not Uzunluğu: ${s.notes?.length || 0} karakter`);
    console.log(`Sorular: ${s._count.questions} | Flashcards: ${s._count.flashcards}`);
    console.log(`Toplam Deneme Sayısı: ${history.length}`);
    
    console.log(`\n--- TÜM DENEME GEÇMİŞİ ---`);
    for (const h of history) {
      console.log(`  Deneme #${h.attempt}:`);
      console.log(`    Skor: ${h.score}/100`);
      console.log(`    Eksik Konular (${(h.missingTopics||[]).length}): ${(h.missingTopics||[]).join(' | ') || 'YOK'}`);
      console.log(`    Hatalar (${(h.issues||[]).length}): ${(h.issues||[]).join(' | ') || 'YOK'}`);
      console.log(`    Öneriler (${(h.suggestions||[]).length}): ${(h.suggestions||[]).join(' | ') || 'YOK'}`);
    }
    
    if (issues.currentMicroPhase) {
      console.log(`\n  ⚠️ Mikro Aşama: ${issues.currentMicroPhase}`);
    }
    if (issues.currentAttempt !== undefined) {
      console.log(`  ⚠️ Kaldığı Deneme: ${issues.currentAttempt}`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
