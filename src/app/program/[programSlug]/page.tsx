import { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import CourseGrid from "@/components/CourseGrid"
import { getUserStats, getUserProgramAccess } from "@/lib/actions"
import { ALL_COURSES, ZELIHA_KVKK_GROUP_SLUG, ZELIHA_KVKK_UMBRELLA, getExamPartCourseSlugs } from "@/lib/course-data"
import { ensureProgramsSeeded } from "@/lib/course-seed"
import { getProgramBySlug, getProgramGridLabel, isProfessionalProgram } from "@/lib/program-catalog"
import { canAccessProgram } from "@/lib/program-access"

type GridCourse = {
  id: string
  slug: string
  name: string
  description: string
  order: number
  status: string
  sectionCount: number
  flashcardCount: number
  questionCount: number
  icon: string
  color: string
  sortOrder: number
  gridGroup?: string
  sourceKindLabel?: string
  isGroupLanding?: boolean
  groupPath?: string
}

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
  const displayName = catalog.displayName

  const allowedSlugs = new Set(getExamPartCourseSlugs(programSlug))

  const courses: GridCourse[] = program.courses
    .filter(c => allowedSlugs.has(c.slug))
    .filter(c => c.slug !== ZELIHA_KVKK_GROUP_SLUG)
    .map(c => {
      const staticInfo = ALL_COURSES.find(sc => sc.slug === c.slug)
      const isKvkkUmbrella =
        programSlug === "zeliha-mevzuat" && c.slug === ZELIHA_KVKK_UMBRELLA.slug
      return {
        id: c.id,
        slug: c.slug,
        name: isKvkkUmbrella ? ZELIHA_KVKK_UMBRELLA.name : c.name,
        description: isKvkkUmbrella
          ? ZELIHA_KVKK_UMBRELLA.description
          : (c.description ?? ""),
        order: c.order,
        status: c.status,
        sectionCount: c._count.sections,
        flashcardCount: c._count.flashcards,
        questionCount: c._count.questions,
        icon: isKvkkUmbrella
          ? ZELIHA_KVKK_UMBRELLA.icon
          : (staticInfo?.icon || "BookOpen"),
        color: isKvkkUmbrella
          ? ZELIHA_KVKK_UMBRELLA.color
          : (staticInfo?.color || "from-indigo-600 to-violet-700"),
        sortOrder: isKvkkUmbrella
          ? ZELIHA_KVKK_UMBRELLA.order
          : (staticInfo?.order ?? c.order),
        gridGroup: staticInfo?.gridGroup,
        sourceKindLabel: staticInfo?.sourceKindLabel,
        isGroupLanding: isKvkkUmbrella ? true : undefined,
        groupPath: isKvkkUmbrella ? ZELIHA_KVKK_UMBRELLA.groupPath : undefined,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (programSlug === "zeliha-mevzuat" && allowedSlugs.has(ZELIHA_KVKK_GROUP_SLUG)) {
    courses.push({
      id: "zeliha-kvkk-umbrella",
      slug: ZELIHA_KVKK_GROUP_SLUG,
      name: ZELIHA_KVKK_UMBRELLA.name,
      description: ZELIHA_KVKK_UMBRELLA.description,
      order: ZELIHA_KVKK_UMBRELLA.order,
      status: "not_started",
      sectionCount: 0,
      flashcardCount: 0,
      questionCount: 0,
      icon: ZELIHA_KVKK_UMBRELLA.icon,
      color: ZELIHA_KVKK_UMBRELLA.color,
      sortOrder: ZELIHA_KVKK_UMBRELLA.order,
      isGroupLanding: true,
      groupPath: ZELIHA_KVKK_UMBRELLA.groupPath,
    })
    courses.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const isProfessional = isProfessionalProgram(programSlug)

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
          isProfessional={isProfessional}
        />
      </div>
    </div>
  )
}
