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
    const programName = parts[0]
    let coursePart = parts[1].replace(/\s*\(OCR\)\s*$/i, "").trim()
    const matched = courses.find(
      (c) =>
        c.name === coursePart ||
        coursePart.startsWith(c.name) ||
        c.name.startsWith(coursePart),
    )
    if (matched && (!matched.program?.name || matched.program.name === programName)) {
      return formatFull(matched)
    }
    return `${programName} > ${coursePart}`
  }

  const byExactName = courses.find((c) => c.name === courseSlug)
  if (byExactName) return formatFull(byExactName)

  return courseSlug
}
