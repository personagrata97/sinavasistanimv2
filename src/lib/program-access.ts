import {
  getReadyPrograms,
  type ProgramCatalogEntry,
} from "./program-catalog"

export type ProgramAccessContext = {
  role: string
  allowedProgramSlugs: string[] | null
}

export function parseAllowedProgramSlugs(raw: string | null | undefined): string[] | null {
  if (!raw || raw.trim() === "") return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((s): s is string => typeof s === "string" && s.length > 0)
  } catch {
    return null
  }
}

/** Kullanıcının görebileceği hazır program kartları */
export function filterProgramsForUser(ctx: ProgramAccessContext): ProgramCatalogEntry[] {
  const ready = getReadyPrograms()

  if (ctx.role === "admin") {
    return ready
  }

  if (ctx.allowedProgramSlugs && ctx.allowedProgramSlugs.length > 0) {
    const allowed = new Set(ctx.allowedProgramSlugs)
    return ready.filter(p => allowed.has(p.slug))
  }

  return ready.filter(p => p.audience !== "restricted")
}

export function canAccessProgram(programSlug: string, ctx: ProgramAccessContext): boolean {
  return filterProgramsForUser(ctx).some(p => p.slug === programSlug)
}

export async function getProgramAccessFromSession(
  session: { user?: { id?: string; role?: string } } | null,
  prismaUserLookup: (userId: string) => Promise<{ role: string; allowedProgramSlugs: string | null } | null>,
): Promise<ProgramAccessContext> {
  if (!session?.user?.id) {
    return { role: "student", allowedProgramSlugs: null }
  }

  const dbUser = await prismaUserLookup(session.user.id)
  const role = dbUser?.role ?? (session.user as { role?: string }).role ?? "student"
  const allowedProgramSlugs = parseAllowedProgramSlugs(dbUser?.allowedProgramSlugs)

  return { role, allowedProgramSlugs }
}
