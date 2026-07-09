import { createHash } from "crypto"
import { CONTENT_DEDUP } from "@/lib/feature-flags"

function normalizeForDedup(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function contentFingerprint(text: string): string {
  return createHash("sha256").update(normalizeForDedup(text), "utf8").digest("hex").slice(0, 20)
}

export function dedupFlashcards<T extends { front: string; back?: string }>(cards: T[]): T[] {
  if (!CONTENT_DEDUP() || cards.length === 0) return cards
  const seen = new Set<string>()
  const out: T[] = []
  for (const card of cards) {
    const key = contentFingerprint(`${card.front}|${card.back ?? ""}`)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(card)
  }
  if (out.length < cards.length) {
    console.log(`[CONTENT_DEDUP] Flashcard: ${cards.length - out.length} tekrar elendi`)
  }
  return out
}

export function dedupQuestions<T extends { text: string; options?: string[] }>(questions: T[]): T[] {
  if (!CONTENT_DEDUP() || questions.length === 0) return questions
  const seen = new Set<string>()
  const out: T[] = []
  for (const q of questions) {
    const opts = (q.options ?? []).join("|")
    const key = contentFingerprint(`${q.text}|${opts}`)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  if (out.length < questions.length) {
    console.log(`[CONTENT_DEDUP] Soru: ${questions.length - out.length} tekrar elendi`)
  }
  return out
}

/** Bir metnin trigram setini (3'lü karakter dizileri) çıkarır */
export function getTrigrams(text: string): Set<string> {
  const normalized = normalizeForDedup(text);
  const trigrams = new Set<string>();
  if (normalized.length < 3) {
    if (normalized.length > 0) trigrams.add(normalized);
    return trigrams;
  }
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

/** İki trigram seti arasındaki Jaccard benzerlik oranını hesaplar */
export function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionCount++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionCount;
  return unionSize === 0 ? 0 : intersectionCount / unionSize;
}

/** 
 * Metin içindeki paragrafları ayrıştırır, benzerlik eşiğini (varsayılan 0.70)
 * aşan mükerrer paragrafları temizler.
 */
export function dedupParagraphs(notesContent: string, similarityThreshold = 0.70): string {
  if (!CONTENT_DEDUP() || !notesContent) return notesContent;
  
  // Paragrafları satır bazında böl
  const paragraphs = notesContent.split(/\n\s*\n/);
  const seenParagraphsTrigrams: Set<string>[] = [];
  const uniqueParagraphs: string[] = [];
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // Eğer çok kısaysa (başlıklar, listeler vs.), doğrudan ekle
    if (trimmed.length < 15) {
      uniqueParagraphs.push(trimmed);
      continue;
    }
    
    const paraTrigrams = getTrigrams(trimmed);
    let isDuplicate = false;
    
    for (const existingTrigrams of seenParagraphsTrigrams) {
      const similarity = calculateJaccardSimilarity(paraTrigrams, existingTrigrams);
      if (similarity >= similarityThreshold) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seenParagraphsTrigrams.push(paraTrigrams);
      uniqueParagraphs.push(trimmed);
    } else {
      console.log(`[CONTENT_DEDUP] Benzerliği yüksek olan paragraf elendi (benzerlik >= ${similarityThreshold}): "${trimmed.slice(0, 60)}..."`);
    }
  }
  
  return uniqueParagraphs.join("\n\n");
}

export { normalizeForDedup }

