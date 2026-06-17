import { describe, it, expect } from "vitest"
import { needsBilingualStudyItems } from "@/lib/ai-service"

describe("bilingual policy (CISA/CIA)", () => {
  it("international_audit: soru/kart çift dilli, not değil", () => {
    expect(needsBilingualStudyItems("international_audit")).toBe(true)
    expect(needsBilingualStudyItems("finance")).toBe(false)
    expect(needsBilingualStudyItems("law")).toBe(false)
  })
})
