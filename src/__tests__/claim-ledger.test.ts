import { describe, it, expect } from "vitest"
import { extractClaimAtoms, verifyClaimsInNotes } from "@/lib/claim-ledger"

describe("claim-ledger", () => {
  it("kanun, madde, süre ve oran atomlarını çıkarır", () => {
    const source = `
      6362 sayılı Sermaye Piyasası Kanunu madde 15 uyarınca
      30 iş günü içinde bildirim yapılmalıdır. Oran %25 oran ile belirlenmiştir.
      Tarih: 15.03.2024
    `
    const atoms = extractClaimAtoms(source)
    expect(atoms.some((a) => a.type === "kanun")).toBe(true)
    expect(atoms.some((a) => a.type === "madde")).toBe(true)
    expect(atoms.some((a) => a.type === "sure")).toBe(true)
    expect(atoms.some((a) => a.type === "oran")).toBe(true)
  })

  it("notlarda atom kapsamını doğrular", () => {
    const source = "6362 sayılı Kanun madde 15 — 30 iş günü — %25 oran"
    const notesGood = "6362 sayılı Kanun kapsamında madde 15, 30 iş günü ve %25 oran geçerlidir."
    const notesBad = "Genel bilgi paragrafı, sayısal detay yok."

    const good = verifyClaimsInNotes(source, notesGood, { minCoverage: 0.5 })
    const bad = verifyClaimsInNotes(source, notesBad, { minCoverage: 0.85 })

    expect(good.coverageRatio).toBeGreaterThan(0.5)
    expect(bad.pass).toBe(false)
  })
})
