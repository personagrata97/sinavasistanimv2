import { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import CourseGrid from "@/components/CourseGrid"
import { getUserStats, getUserProgramAccess } from "@/lib/actions"
import { ALL_COURSES, ZELIHA_KVKK_UMBRELLA, getZelihaKvkkChildCourses } from "@/lib/course-data"
import { ensureProgramsSeeded } from "@/lib/course-seed"
import { getProgramBySlug, isProfessionalProgram } from "@/lib/program-catalog"
import { canAccessProgram } from "@/lib/program-access"

const ZELIHA_PROGRAM_SLUG = "zeliha-mevzuat"

export async function generateMetadata({ params }: { params: Promise<{ programSlug: string }> }): Promise<Metadata> {
  const { programSlug } = await params
  if (programSlug !== ZELIHA_PROGRAM_SLUG) return { title: "Program Bulunamadı" }
  return {
    title: `${ZELIHA_KVKK_UMBRELLA.name} | Sınav Asistanım`,
    description: ZELIHA_KVKK_UMBRELLA.description,
  }
}

export default async function ZelihaKvkkPage({ params }: { params: Promise<{ programSlug: string }> }) {
  const { programSlug } = await params

  if (programSlug !== ZELIHA_PROGRAM_SLUG) {
    notFound()
  }

  await ensureProgramsSeeded()

  const catalog = getProgramBySlug(programSlug)
  if (!catalog?.ready) {
    notFound()
  }

  const access = await getUserProgramAccess()
  if (!canAccessProgram(programSlug, access)) {
    redirect("/dashboard")
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
  const childSlugs = new Set(getZelihaKvkkChildCourses().map(c => c.slug))

  const courses = program.courses
    .filter(c => childSlugs.has(c.slug))
    .map(c => {
      const staticInfo = ALL_COURSES.find(sc => sc.slug === c.slug)
      return {
        ...c,
        sectionCount: c._count.sections,
        flashcardCount: c._count.flashcards,
        questionCount: c._count.questions,
        icon: staticInfo?.icon || "BookOpen",
        color: staticInfo?.color || "from-fuchsia-600 to-rose-700",
        sortOrder: staticInfo?.order ?? c.order,
        gridGroup: staticInfo?.gridGroup,
        sourceKindLabel: staticInfo?.sourceKindLabel,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-fuchsia-900/20 blur-[180px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-slate-800/30 blur-[160px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <CourseGrid
          courses={courses}
          stats={stats}
          programName={ZELIHA_KVKK_UMBRELLA.name}
          programSubtitle="Dış ve iç mevzuat alt modülleri"
          programSlug={programSlug}
          gridCountLabel="8 KVKK Modülü"
          isProfessional={isProfessionalProgram(programSlug)}
          backHref={`/program/${programSlug}`}
        />
      </div>
    </div>
  )
}
