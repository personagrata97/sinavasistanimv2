import { describe, it, expect, beforeEach } from "vitest"
import { activeProcesses, tryClaimProcessing, releaseProcessing } from "@/lib/process-registry"

describe("process-startup guards", () => {
  beforeEach(() => {
    activeProcesses.clear()
  })

  it("tek global iş kilidi korunur", () => {
    expect(tryClaimProcessing("zeliha-kvkk-prosedur")).toEqual({ ok: true })
    expect(tryClaimProcessing("bd-bilgi-sistemleri-guvenligi")).toEqual({
      ok: false,
      blockedBy: "zeliha-kvkk-prosedur",
    })
    releaseProcessing("zeliha-kvkk-prosedur")
  })
})
