import { describe, it, expect } from "vitest"
import { getCourseBySlug } from "@/lib/course-data"
import {
  detectDocumentType,
  formatProcessingProfileLog,
  getDocumentProcessingProfile,
  shouldUseSingleSectionModeFromProfile,
} from "@/lib/document-processing-profile"
import { shouldUseSingleSectionMode } from "@/lib/section-detector"

describe("getDocumentProcessingProfile", () => {
  it("zeliha-kvkk-prosedur slug → tek parça (bölüm ayırma yok)", () => {
    const meta = getCourseBySlug("zeliha-kvkk-prosedur")!
    const profile = getDocumentProcessingProfile({
      slug: meta.slug,
      name: meta.name,
      sourceKind: meta.sourceKind,
      sourceKindLabel: meta.sourceKindLabel,
      gridGroup: meta.gridGroup,
      programSlug: "zeliha-mevzuat",
      aiMode: "mevzuat",
      totalPages: 90,
    })
    expect(profile.mode).toBe("single")
    expect(profile.documentType).toBe("prosedür")
    expect(profile.preserveHeadings).toBe(true)
    expect(formatProcessingProfileLog(profile, meta.slug)).toBe(
      "Prosedür modu: tek parça işlenecek (slug=zeliha-kvkk-prosedur)",
    )
  })

  it("adında Prosedürü geçen belge türü prosedür olarak algılanır", () => {
    expect(
      detectDocumentType({
        name: "Kişisel Verilerin Korunması Prosedürü",
        slug: "ozel-belge",
      }),
    ).toBe("prosedür")
  })

  it("zeliha-kvkk-politika slug → tek parça", () => {
    const meta = getCourseBySlug("zeliha-kvkk-politika")!
    const profile = getDocumentProcessingProfile({
      slug: meta.slug,
      name: meta.name,
      sourceKind: meta.sourceKind,
      sourceKindLabel: meta.sourceKindLabel,
      programSlug: "zeliha-mevzuat",
      totalPages: 80,
    })
    expect(profile.mode).toBe("single")
    expect(profile.documentType).toBe("politika")
    expect(formatProcessingProfileLog(profile, meta.slug)).toBe(
      "Politika modu: tek parça işlenecek (slug=zeliha-kvkk-politika)",
    )
  })

  it("iç mevzuat rozeti olan belge → tek parça", () => {
    expect(
      getDocumentProcessingProfile({
        slug: "ozel-ic-belge",
        name: "Veri Saklama Talimatı",
        sourceKindLabel: "İç mevzuat",
        programSlug: "zeliha-mevzuat",
        totalPages: 120,
      }).mode,
    ).toBe("single")
  })

  it("kısa kanun metni → tek parça (sayfa sınırı)", () => {
    const profile = getDocumentProcessingProfile({
      slug: "zeliha-kvkk-kanun",
      name: "Kişisel Verilerin Korunması Kanunu",
      sourceKindLabel: "Dış mevzuat",
      programSlug: "zeliha-mevzuat",
      totalPages: 45,
    })
    expect(profile.mode).toBe("single")
    expect(profile.documentType).toBe("kanun")
    expect(profile.reason).toContain("kısa dış mevzuat")
  })

  it("uzun kanun metni → çoklu bölüm", () => {
    expect(
      getDocumentProcessingProfile({
        slug: "zeliha-kvkk-kanun",
        name: "Kişisel Verilerin Korunması Kanunu",
        sourceKindLabel: "Dış mevzuat",
        programSlug: "zeliha-mevzuat",
        totalPages: 95,
      }).mode,
    ).toBe("multi")
  })

  it("121 sayfalık SPL kitabı → çoklu bölüm", () => {
    expect(
      getDocumentProcessingProfile({
        slug: "bd-bilgi-sistemleri-yonetimi",
        name: "Bilgi Sistemleri Yönetimi ve Denetimi",
        programSlug: "spl-bagimsiz-denetim",
        aiMode: "finance",
        totalPages: 121,
      }).mode,
    ).toBe("multi")
  })

  it("shouldUseSingleSectionMode slug ile prosedürü tek parça sayar", () => {
    expect(
      shouldUseSingleSectionMode({
        totalPages: 100,
        programSlug: "zeliha-mevzuat",
        courseSlug: "zeliha-kvkk-prosedur",
        courseName: "Kişisel Verilerin Korunması Prosedürü",
        sourceKind: "internal-procedure",
      }),
    ).toBe(true)
  })

  it("shouldUseSingleSectionModeFromProfile ile uyumlu", () => {
    const input = {
      slug: "zeliha-kvkk-prosedur",
      name: "Kişisel Verilerin Korunması Prosedürü",
      programSlug: "zeliha-mevzuat",
      totalPages: 16,
    }
    expect(shouldUseSingleSectionModeFromProfile(input)).toBe(true)
    expect(shouldUseSingleSectionMode({ ...input, courseSlug: input.slug, courseName: input.name })).toBe(true)
  })
})
