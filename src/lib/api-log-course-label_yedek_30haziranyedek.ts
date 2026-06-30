/** Admin API log tablosu: ham courseSlug → okunabilir ders adı (yanlış eşleştirme yok). */

export type CourseLogRow = {
  slug: string
  name: string
  program?: { name: string } | null
}

function formatFull(c: CourseLogRow): string {
  return c.program?.name ? `${c.program.name} > ${c.name}` : c.name
}

/**
 * ApiUsageLog.courseSlug alanını ekranda gösterilecek derse çevirir.
 * Eski `includes(c.name)` / program adı eşleşmesi KALDIRILDI — Zeliha OCR kayıtları
 * yanlışlıkla «Bankacılık Kanunu»na yazılıyordu.
 */
export function resolveApiLogCourseFullName(
  courseSlug: string | null | undefined,
  courses: CourseLogRow[],
): string | null {
  if (!courseSlug) return null

  const bySlug = courses.find((c) => c.slug === courseSlug)
  if (bySlug) return formatFull(bySlug)

  const parts = courseSlug.split(" > ").map((p) => p.trim())
  if (parts.length >= 2) {
    // İlk parçanın ders adı olup olmadığını kontrol et (Ders > Konu durumu)
    const firstPart = parts[0].replace(/\s*\(OCR\)\s*$/i, "").trim()
    const matchedFirstAsCourse = courses.find(
      (c) =>
        c.name === firstPart ||
        firstPart.startsWith(c.name) ||
        c.name.startsWith(firstPart),
    )
    if (matchedFirstAsCourse) {
      const programPrefix = matchedFirstAsCourse.program?.name ? `${matchedFirstAsCourse.program.name} > ` : ""
      const remainingParts = parts.slice(1).join(" > ")
      return `${programPrefix}${matchedFirstAsCourse.name} > ${remainingParts}`
    }

    // İkinci parçanın ders adı olup olmadığını kontrol et (Program > Ders > Konu durumu)
    const secondPart = parts[1].replace(/\s*\(OCR\)\s*$/i, "").trim()
    const matchedSecondAsCourse = courses.find(
      (c) =>
        c.name === secondPart ||
        secondPart.startsWith(c.name) ||
        c.name.startsWith(secondPart),
    )
    if (matchedSecondAsCourse) {
      const programPrefix = matchedSecondAsCourse.program?.name ? `${matchedSecondAsCourse.program.name} > ` : ""
      const remainingParts = parts.slice(2).join(" > ")
      return `${programPrefix}${matchedSecondAsCourse.name}${remainingParts ? " > " + remainingParts : ""}`
    }

    return courseSlug
  }

  const byExactName = courses.find((c) => c.name === courseSlug)
  if (byExactName) return formatFull(byExactName)

  return courseSlug
}
