/** Bölüm başlığı kısaltmalar / tanımlar / sözlük sayfası mı? */
export function isGlossarySectionTitle(title: string): boolean {
  const t = title.toLocaleLowerCase("tr-TR")
  return (
    t.includes("kısaltma") ||
    t.includes("tanım") ||
    t.includes("terimler") ||
    t.includes("sözlük") ||
    t.includes("glossary") ||
    t.includes("kavramlar")
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
