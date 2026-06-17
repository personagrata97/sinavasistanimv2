/**
 * Veritabanı program/ders tohumlaması — "use server" DIŞINDA.
 * Sunucu bileşenlerinden (program sayfası, metadata) güvenle çağrılabilir.
 */
import { prisma } from "./prisma"
import { getProgramSeedRows } from "./program-catalog"
import {
  SPL_LEVEL_3_COURSES,
  MASAK_COURSES,
  SPL_BD_COURSES,
  CIA_COURSES,
  CISA_COURSES,
  SMMM_COURSES,
} from "./course-data"

export async function ensureProgramsSeeded(): Promise<void> {
  for (const p of getProgramSeedRows()) {
    await prisma.program.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        aiMode: p.aiMode,
        description: p.description,
      },
      create: {
        slug: p.slug,
        name: p.name,
        aiMode: p.aiMode,
        description: p.description,
      },
    })
  }

  const splProgram = await prisma.program.findUnique({ where: { slug: "spl-duzey-3" } })
  if (splProgram) {
    for (const course of SPL_LEVEL_3_COURSES) {
      await upsertCourse(course, splProgram.id)
    }
  }

  const masakProgram = await prisma.program.findUnique({ where: { slug: "masak" } })
  if (masakProgram) {
    for (const course of MASAK_COURSES) {
      await upsertCourse(course, masakProgram.id)
    }
  }

  const bdProgram = await prisma.program.findUnique({ where: { slug: "spl-bagimsiz-denetim" } })
  if (bdProgram) {
    for (const course of SPL_BD_COURSES) {
      await upsertCourse(course, bdProgram.id)
    }
  }

  const ciaProgram = await prisma.program.findUnique({ where: { slug: "cia" } })
  if (ciaProgram) {
    for (const course of CIA_COURSES) {
      await upsertCourse(course, ciaProgram.id)
    }
  }

  const cisaProgram = await prisma.program.findUnique({ where: { slug: "cisa" } })
  if (cisaProgram) {
    for (const course of CISA_COURSES) {
      await upsertCourse(course, cisaProgram.id)
    }
  }

  const smmmProgram = await prisma.program.findUnique({ where: { slug: "smmm" } })
  if (smmmProgram) {
    for (const course of SMMM_COURSES) {
      await upsertCourse(course, smmmProgram.id)
    }
  }
}

async function upsertCourse(
  course: { name: string; slug: string; order: number; description: string },
  programId: string,
) {
  const existing = await prisma.course.findUnique({ where: { slug: course.slug } })
  if (!existing) {
    await prisma.course.create({
      data: {
        name: course.name,
        slug: course.slug,
        order: course.order,
        description: course.description,
        programId,
      },
    })
  } else {
    await prisma.course.update({
      where: { id: existing.id },
      data: {
        name: course.name,
        description: course.description,
        order: course.order,
        ...(existing.programId !== programId ? { programId } : {}),
      },
    })
  }
}

/** Geriye dönük uyumluluk — actions.ts'ten çağrılır */
export const initializeCourses = ensureProgramsSeeded
