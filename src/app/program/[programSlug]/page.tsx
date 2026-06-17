import { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import CourseGrid from "@/components/CourseGrid"
import { getUserStats } from "@/lib/actions"
import { ALL_COURSES } from "@/lib/course-data"
import { ensureProgramsSeeded } from "@/lib/course-seed"
import { getProgramBySlug, getProgramGridLabel } from "@/lib/program-catalog"
import { getExamPartCourseSlugs } from "@/lib/course-data"

export async function generateMetadata({ params }: { params: Promise<{ programSlug: string }> }): Promise<Metadata> {
  const { programSlug } = await params
  await ensureProgramsSeeded()
  const catalog = getProgramBySlug(programSlug)
  const program = await prisma.program.findUnique({ where: { slug: programSlug } })
  const title = catalog?.displayName ?? program?.name ?? "Program Bulunamadı"
  if (!program && !catalog) return { title: "Program Bulunamadı" }
  return {
    title: `${title} | Sınav Asistanım`,
    description: catalog?.dbDescription ?? program?.description ?? `${title} sınavına hazırlık materyalleri.`,
  }
}

export default async function ProgramCoursesPage({ params }: { params: Promise<{ programSlug: string }> }) {
  const { programSlug } = await params

  await ensureProgramsSeeded()

  const catalog = getProgramBySlug(programSlug)
  if (!catalog?.ready) {
    notFound()
  }

  const program = await prisma.program.findUnique({
    where: { slug: programSlug },
    include: {
      courses: {
        orderBy: { order: "asc" },
        include: {
          _count: {
            select: { sections: true, flashcards: true, questions: true },
          },
        },
      },
    },
  })

  if (!program) notFound()

  const stats = await getUserStats()
  const displayName = catalog.displayName

  const allowedSlugs = new Set(getExamPartCourseSlugs(programSlug))

  const courses = program.courses
    .filter(c => allowedSlugs.has(c.slug))
    .map(c => {
    const staticInfo = ALL_COURSES.find(sc => sc.slug === c.slug)
    return {
      ...c,
      sectionCount: c._count.sections,
      flashcardCount: c._count.flashcards,
      questionCount: c._count.questions,
      icon: staticInfo?.icon || "BookOpen",
      color: staticInfo?.color || "from-indigo-600 to-violet-700",
      sortOrder: staticInfo?.order ?? c.order,
    }
  })
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-sky-900/20 blur-[180px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-slate-800/30 blur-[160px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <CourseGrid
          courses={courses}
          stats={stats}
          programName={displayName}
          programSubtitle={catalog.subtitle}
          programSlug={programSlug}
          gridCountLabel={getProgramGridLabel(programSlug)}
        />
      </div>
    </div>
  )
}
