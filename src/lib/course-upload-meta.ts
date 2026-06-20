import type { CourseInfo } from "./course-data"

/** PDF yüklü mü — totalPages, pdfPath veya uploaded durumundan herhangi biri yeterli */
export function courseHasUploadedPdf(course: {
  totalPages?: number | null
  pdfPath?: string | null
  status?: string | null
}): boolean {
  return (
    (course.totalPages ?? 0) > 0 ||
    Boolean(course.pdfPath) ||
    course.status === "uploaded"
  )
}

/** PDF yükleme rehberi — yalnızca sunucu bileşenlerinden çağrılır (course-data istemciyle paylaşıldığı için ayrı modül). */
export function mergeCourseUploadMeta(
  dbCourses: Array<{ slug: string; name: string; order: number; status?: string }>,
  staticCourses: CourseInfo[],
) {
  return dbCourses.map(c => {
    const meta = staticCourses.find(s => s.slug === c.slug)
    return {
      ...c,
      uploadFileName: meta?.uploadFileName,
      uploadGuide: meta?.uploadGuide,
    }
  })
}
