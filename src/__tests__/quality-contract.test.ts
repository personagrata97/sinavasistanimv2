import { describe, it, expect } from "vitest"
import {
  hashContent,
  emptyQualityChain,
  runStageWithContract,
  validateQualityChain,
  isPublishGatePassed,
} from "@/lib/quality-contract"

describe("quality-contract", () => {
  it("hashContent deterministik 16 hex üretir", () => {
    const h1 = hashContent("test içerik")
    const h2 = hashContent("test içerik")
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{16}$/)
  })

  it("runStageWithContract zincire kapı ekler", async () => {
    const chain = emptyQualityChain()
    const { chain: next, gate } = await runStageWithContract(chain, "ocr_complete", async () => ({
      pass: true,
      contentForHash: "ocr markdown",
      metrics: { visualCount: 2 },
    }))
    expect(next.gates).toHaveLength(1)
    expect(gate.stage).toBe("ocr_complete")
    expect(gate.pass).toBe(true)
    expect(gate.contentHash).toBe(hashContent("ocr markdown"))
  })

  it("validateQualityChain prevHash zincirini doğrular", () => {
    const h1 = hashContent("a")
    const h2 = hashContent("b")
    const valid = validateQualityChain({
      version: 1,
      gates: [
        { stage: "ocr_complete", pass: true, contentHash: h1, timestamp: "" },
        { stage: "notes", pass: true, contentHash: h2, prevHash: h1, timestamp: "" },
      ],
    })
    expect(valid.valid).toBe(true)

    const broken = validateQualityChain({
      version: 1,
      gates: [
        { stage: "ocr_complete", pass: true, contentHash: h1, timestamp: "" },
        { stage: "notes", pass: true, contentHash: h2, prevHash: "wrong", timestamp: "" },
      ],
    })
    expect(broken.valid).toBe(false)
  })

  it("isPublishGatePassed son kapı publish ve pass olmalı", async () => {
    let chain = emptyQualityChain()
    const stages = ["ocr_complete", "notes", "kontrolor", "mufettis", "flashcards", "questions", "publish"] as const
    for (const stage of stages) {
      const r = await runStageWithContract(chain, stage, async () => ({
        pass: true,
        contentForHash: stage,
      }))
      chain = r.chain
    }
    expect(isPublishGatePassed(chain)).toBe(true)
  })
})
