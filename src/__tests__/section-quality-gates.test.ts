import { describe, it, expect } from "vitest"
import {
  deriveQualityStages,
  isAttemptFullyApproved,
  getAttemptDisplayLabel,
  getQualityBadgeState,
  mergeVerificationIssues,
  stringifyMergedVerificationIssues,
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

  it("mergeVerificationIssues preserves findings when updating currentMicroPhase", () => {
    const existing = {
      missingTopics: ["Konu A"],
      issues: ["Hata B"],
      attemptHistory: [{ attempt: 1, score: 85, missingTopics: ["Konu A"], issues: [] }],
      inspectorFailed: true,
      inspectorFindings: [{ description: "Eksik detay", severity: "CRITICAL", type: "missing" }],
      auditResult: { passed: false, missingDetails: ["Detay 1"] },
      currentAttempt: 1,
      stages: { notesGenerated: true, kontrolorGroundTruth: true, mufettis: false },
    }

    const merged = mergeVerificationIssues(existing, {
      currentMicroPhase: "2/5. Aşama 4: Başmüfettiş Çapraz Denetimi...",
    })

    expect(merged.currentMicroPhase).toContain("Başmüfettiş")
    expect(merged.missingTopics).toEqual(["Konu A"])
    expect(merged.issues).toEqual(["Hata B"])
    expect(merged.attemptHistory).toHaveLength(1)
    expect(merged.inspectorFailed).toBe(true)
    expect(merged.inspectorFindings).toHaveLength(1)
    expect(merged.auditResult?.missingDetails).toEqual(["Detay 1"])
    expect(merged.stages?.kontrolorGroundTruth).toBe(true)
  })

  it("stringifyMergedVerificationIssues parses JSON string existing", () => {
    const existingJson = JSON.stringify({
      missingTopics: ["X"],
      attemptHistory: [{ attempt: 2, score: 70 }],
    })
    const out = stringifyMergedVerificationIssues(existingJson, {
      currentMicroPhase: "Kontrolör inceliyor",
    })
    const parsed = JSON.parse(out)
    expect(parsed.missingTopics).toEqual(["X"])
    expect(parsed.attemptHistory).toHaveLength(1)
    expect(parsed.currentMicroPhase).toBe("Kontrolör inceliyor")
  })
})
