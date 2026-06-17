import { describe, it, expect } from "vitest"
import { isGlossarySectionTitle, resolveRequiresQuestions } from "@/lib/glossary-utils"

describe("glossary-utils", () => {
  it("Kısaltmalar başlığını tanır", () => {
    expect(isGlossarySectionTitle("Kısaltmalar")).toBe(true)
    expect(isGlossarySectionTitle("KISALTMALAR")).toBe(true)
  })

  it("normal bölüm sözlük değildir", () => {
    expect(isGlossarySectionTitle("Bilgi Güvenliği Yönetimi")).toBe(false)
  })

  it("sözlük bölümünde soru varsayılan kapalı", () => {
    expect(resolveRequiresQuestions("Kısaltmalar", undefined)).toBe(false)
    expect(resolveRequiresQuestions("Kısaltmalar", false)).toBe(false)
    expect(resolveRequiresQuestions("Kısaltmalar", true)).toBe(true)
  })

  it("normal bölümde soru varsayılan açık", () => {
    expect(resolveRequiresQuestions("Risk Yönetimi", undefined)).toBe(true)
    expect(resolveRequiresQuestions("Risk Yönetimi", false)).toBe(false)
  })
})
