/** Bölüm başlığı kısaltmalar / tanımlar / sözlük sayfası mı? */
export function isGlossarySectionTitle(title: string): boolean {
  const t = title.toLocaleLowerCase("tr-TR")
  return (
    t.includes("kısaltma") ||
    t.includes("kisaltma") ||
    t.includes("tanım") ||
    t.includes("tanim") ||
    t.includes("terimler") ||
    t.includes("terim") ||
    t.includes("sözlük") ||
    t.includes("sozluk") ||
    t.includes("glossary") ||
    t.includes("abbreviations") ||
    t.includes("definitions") ||
    t.includes("kavramlar") ||
    t.includes("kavram dizini") ||
    t.includes("terim dizini")
  )
}

/**
 * Sözlük bölümlerinde soru üretimi: yalnızca bilişsel analiz açıkça true derse.
 * Diğer bölümlerde: analiz false demedikçe soru üret.
 */
export function resolveRequiresQuestions(
  sectionTitle: string,
  analysisRequiresQuestions: boolean | undefined | null,
): boolean {
  if (isGlossarySectionTitle(sectionTitle)) {
    return analysisRequiresQuestions === true
  }
  return analysisRequiresQuestions !== false
}
