import { describe, it, expect } from "vitest"
import {
  deriveQualityStages,
  isAttemptFullyApproved,
  getAttemptDisplayLabel,
  getQualityBadgeState,
} from "@/lib/section-quality-gates"

describe("section-quality-gates", () => {
  it("score 100, !processed, no stages → mufettis false", () => {
    const stages = deriveQualityStages({}, 100, false)
    expect(stages.kontrolorGroundTruth).toBe(true)
    expect(stages.mufettis).toBe(false)
    expect(stages.published).toBe(false)
  })

  it("score 100, processed, no inspectorFailed → mufettis true (legacy)", () => {
    const stages = deriveQualityStages({}, 100, true)
    expect(stages.mufettis).toBe(true)
    expect(stages.published).toBe(true)
  })

  it("explicit stages.mufettis true → mufettis true", () => {
    const stages = deriveQualityStages(
      { stages: { mufettis: true, kontrolorGroundTruth: true } },
      85,
      false
    )
    expect(stages.mufettis).toBe(true)
  })

  it("inspectorFailed → mufettis false even if score was 100 before", () => {
    const stages = deriveQualityStages({ inspectorFailed: true }, 70, false)
    expect(stages.kontrolorGroundTruth).toBe(true)
    expect(stages.mufettis).toBe(false)
  })

  it("attempt history entry score 100 kontrolor only → not fully approved", () => {
    const entry = {
      attempt: 1,
      score: 100,
      kontrolorGroundTruth: true,
      mufettis: false,
      fullyApproved: false,
    }
    expect(isAttemptFullyApproved(entry, false)).toBe(false)
    const label = getAttemptDisplayLabel(entry, false)
    expect(label.isFullyApproved).toBe(false)
    expect(label.isKontrolorOnly).toBe(true)
    expect(label.headline).toContain("KONTROLÖR ONAYI")
  })

  it("fully approved attempt when mufettis and fullyApproved flags set", () => {
    const entry = {
      attempt: 1,
      score: 100,
      kontrolorGroundTruth: true,
      mufettis: true,
      fullyApproved: true,
    }
    expect(isAttemptFullyApproved(entry, false)).toBe(true)
    const label = getAttemptDisplayLabel(entry, false)
    expect(label.headline).toBe("ONAYLANDI")
  })

  it("badge green only when fully approved", () => {
    const wipStages = deriveQualityStages(
      { stages: { kontrolorGroundTruth: true, mufettis: false } },
      100,
      false
    )
    const wipBadge = getQualityBadgeState(100, false, wipStages, null)
    expect(wipBadge.isFullyApproved).toBe(false)
    expect(wipBadge.tone).toBe("amber")

    const doneStages = deriveQualityStages(
      { stages: { kontrolorGroundTruth: true, mufettis: true, published: true } },
      100,
      true
    )
    const doneBadge = getQualityBadgeState(100, true, doneStages, null)
    expect(doneBadge.isFullyApproved).toBe(true)
    expect(doneBadge.tone).toBe("green")
  })
})
