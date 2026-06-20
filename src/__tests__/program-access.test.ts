import { describe, it, expect } from "vitest"
import { filterProgramsForUser, parseAllowedProgramSlugs, canAccessProgram } from "@/lib/program-access"

describe("program-access", () => {
  it("admin tüm hazır programları görür", () => {
    const list = filterProgramsForUser({ role: "admin", allowedProgramSlugs: null })
    expect(list.some(p => p.slug === "zeliha-mevzuat")).toBe(true)
    expect(list.some(p => p.slug === "spl-duzey-3")).toBe(true)
  })

  it("Zeliha kullanıcısı yalnızca zeliha-mevzuat görür", () => {
    const list = filterProgramsForUser({
      role: "student",
      allowedProgramSlugs: ["zeliha-mevzuat"],
    })
    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe("zeliha-mevzuat")
  })

  it("varsayılan öğrenci restricted programları görmez", () => {
    const list = filterProgramsForUser({ role: "student", allowedProgramSlugs: null })
    expect(list.some(p => p.slug === "zeliha-mevzuat")).toBe(false)
    expect(list.some(p => p.slug === "spl-duzey-3")).toBe(true)
  })

  it("parseAllowedProgramSlugs JSON dizisini okur", () => {
    expect(parseAllowedProgramSlugs('["zeliha-mevzuat"]')).toEqual(["zeliha-mevzuat"])
    expect(parseAllowedProgramSlugs(null)).toBeNull()
  })

  it("canAccessProgram doğru çalışır", () => {
    expect(canAccessProgram("zeliha-mevzuat", { role: "admin", allowedProgramSlugs: null })).toBe(true)
    expect(canAccessProgram("spl-duzey-3", { role: "student", allowedProgramSlugs: ["zeliha-mevzuat"] })).toBe(false)
  })
})
