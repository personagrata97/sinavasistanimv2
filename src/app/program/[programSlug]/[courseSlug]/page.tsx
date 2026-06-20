import { redirect } from "next/navigation"
import { ZELIHA_KVKK_GROUP_SLUG, ZELIHA_KVKK_UMBRELLA } from "@/lib/course-data"
import { ensureProgramsSeeded } from "@/lib/course-seed"
import CourseDetailClient from "./CourseDetailClient"

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ programSlug: string; courseSlug: string }>
}) {
  const { programSlug, courseSlug } = await params

  await ensureProgramsSeeded()

  if (courseSlug === ZELIHA_KVKK_GROUP_SLUG) {
    redirect(`/program/${programSlug}/${ZELIHA_KVKK_UMBRELLA.groupPath}`)
  }

  return <CourseDetailClient params={params} />
}
