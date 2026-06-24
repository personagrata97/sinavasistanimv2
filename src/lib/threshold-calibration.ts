/** Merkezi eşik ve sihirli sayılar — atom ölçekli kalibrasyon */

export const THRESHOLDS = {
  /** Karakter dilimi kapsama oranı minimumu (v2) */
  CHAR_SLICE_COVERAGE_MIN: 0.98,
  /** Minimum dilim karakter sayısı */
  CHAR_SLICE_MIN_CHARS: 180,
  /** Minimum alt konu sayısı */
  CHAR_SLICE_MIN_SLICES: 2,
  /** Kontrolör ensemble: kaç oydan 2'si fail ise toplam fail */
  KONTROLOR_ENSEMBLE_FAIL_VOTES: 2,
  KONTROLOR_ENSEMBLE_TOTAL_VOTES: 3,
  /** Claim ledger: notta bulunması gereken atom oranı */
  CLAIM_COVERAGE_MIN: 0.85,
  /** İçerik dedup: normalize hash eşleşmesi */
  DEDUP_ENABLED_DEFAULT: true,
  /** OCR görsel envanter: minimum beklenen görsel bloğu (uyarı) */
  OCR_VISUAL_MIN_ITEMS: 0,
  /** Publish gate: son kapı adı */
  PUBLISH_GATE_STAGE: "publish" as const,
  /** Fuzzy başlık eşleşme benzerlik eşiği (0-1) */
  FUZZY_TITLE_SIMILARITY: 0.72,
} as const

/** Atom sayısına göre ölçeklenmiş eşik — çok atomlu metinlerde tolerans daralır */
export function atomScaledThreshold(
  baseThreshold: number,
  atomCount: number,
  opts?: { min?: number; max?: number },
): number {
  const min = opts?.min ?? baseThreshold * 0.9
  const max = opts?.max ?? baseThreshold
  if (atomCount <= 5) return max
  if (atomCount >= 50) return min
  const t = (atomCount - 5) / 45
  return max - t * (max - min)
}

/** 
 * Bölümün atom yoğunluğuna (atom sayısı / karakter uzunluğu) göre dinamik ceza puanı hesaplar.
 * Yoğunluk arttıkça eksik olan her atom için verilecek ceza puanı düşer.
 * Düşük yoğunlukta ise (her atom kritik) ceza çok daha yüksek olur.
 */
export function calculateDynamicPenalty(
  atomCount: number,
  charCount: number,
  basePenalty = 5
): number {
  if (charCount <= 0 || atomCount <= 0) return basePenalty;
  
  // 1000 karakter başına düşen atom sayısı (atom yoğunluğu)
  const density = (atomCount / charCount) * 1000;
  
  if (density >= 10) {
    return Math.max(2, Math.round(basePenalty * 0.5));
  } else if (density <= 2) {
    return Math.min(15, Math.round(basePenalty * 2));
  } else {
    const t = (density - 2) / 8;
    const multiplier = 2.0 - t * 1.5; // 2.0 down to 0.5
    return Math.round(basePenalty * multiplier);
  }
}

