import { createHash } from "crypto"
import { QUALITY_CONTRACT_ENABLED } from "@/lib/feature-flags"

export type QualityStage =
  | "upload"
  | "section_detect"
  | "ocr_complete"
  | "notes"
  | "kontrolor"
  | "mufettis"
  | "flashcards"
  | "questions"
  | "publish"

export type QualityGateResult = {
  stage: QualityStage
  pass: boolean
  score?: number
  contentHash?: string
  prevHash?: string
  metrics?: Record<string, unknown>
  errors?: string[]
  timestamp: string
}

export type QualityChain = {
  version: 1
  gates: QualityGateResult[]
  lastHash?: string
}

export type StageRunOutcome<T> = {
  pass: boolean
  data?: T
  metrics?: Record<string, unknown>
  contentForHash?: string
  score?: number
  errors?: string[]
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16)
}

export function emptyQualityChain(): QualityChain {
  return { version: 1, gates: [] }
}

export function parseQualityChain(raw: unknown): QualityChain {
  if (!raw || typeof raw !== "object") return emptyQualityChain()
  const obj = raw as Partial<QualityChain>
  if (!Array.isArray(obj.gates)) return emptyQualityChain()
  return {
    version: 1,
    gates: obj.gates as QualityGateResult[],
    lastHash: typeof obj.lastHash === "string" ? obj.lastHash : undefined,
  }
}

/** Zincir bütünlüğü: her kapının prevHash'i bir önceki contentHash ile uyumlu olmalı */
export function validateQualityChain(chain: QualityChain): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  let expectedPrev: string | undefined

  for (let i = 0; i < chain.gates.length; i++) {
    const gate = chain.gates[i]
    if (!gate.stage || typeof gate.pass !== "boolean") {
      errors.push(`Kapı #${i + 1}: geçersiz yapı`)
      continue
    }
    if (i > 0 && gate.prevHash && expectedPrev && gate.prevHash !== expectedPrev) {
      errors.push(`Kapı "${gate.stage}": zincir kırık (prevHash uyuşmuyor)`)
    }
    if (gate.contentHash) {
      expectedPrev = gate.contentHash
    }
  }

  return { valid: errors.length === 0, errors }
}

export function getLastGate(chain: QualityChain): QualityGateResult | undefined {
  return chain.gates.length > 0 ? chain.gates[chain.gates.length - 1] : undefined
}

export function isPublishGatePassed(chain: QualityChain): boolean {
  const last = getLastGate(chain)
  return last?.stage === "publish" && last.pass === true
}

export async function runStageWithContract<T>(
  chain: QualityChain,
  stage: QualityStage,
  fn: () => Promise<StageRunOutcome<T>>,
): Promise<{ result: T | undefined; chain: QualityChain; gate: QualityGateResult }> {
  const prevHash = chain.lastHash
  const outcome = await fn()

  const contentHash = outcome.contentForHash
    ? hashContent(outcome.contentForHash)
    : prevHash

  const gate: QualityGateResult = {
    stage,
    pass: outcome.pass,
    score: outcome.score,
    contentHash,
    prevHash,
    metrics: outcome.metrics,
    errors: outcome.errors,
    timestamp: new Date().toISOString(),
  }

  const nextChain: QualityChain = {
    version: 1,
    gates: [...chain.gates, gate],
    lastHash: contentHash,
  }

  if (QUALITY_CONTRACT_ENABLED()) {
    const validation = validateQualityChain(nextChain)
    if (!validation.valid) {
      gate.pass = false
      gate.errors = [...(gate.errors ?? []), ...validation.errors]
      nextChain.gates[nextChain.gates.length - 1] = gate
    }
  }

  return { result: outcome.data, chain: nextChain, gate }
}
