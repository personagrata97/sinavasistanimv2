import {
  parseQualityChain,
  type QualityChain,
} from "@/lib/quality-contract"
import { QUALITY_CONTRACT_ENABLED } from "@/lib/feature-flags"

export type PublishGateInput = {
  qualityChain?: QualityChain | unknown
  notesAttemptSuccess: boolean
  missingContent?: string[]
  verificationScore?: number
  skipOcr?: boolean
}

export type PublishGateResult = {
  allowPublish: boolean
  reason?: string
}

const PREREQ_STAGES = ["kontrolor", "mufettis"] as const

/** processed=true öncesi ön koşul kontrolü (publish kapısı henüz zincire eklenmemiş olabilir) */
export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  const {
    qualityChain: rawChain,
    notesAttemptSuccess,
    missingContent = [],
    verificationScore = 0,
    skipOcr = false,
  } = input

  if (!notesAttemptSuccess) {
    return { allowPublish: false, reason: "Notlar %100 onay almadı" }
  }

  if (verificationScore < 100) {
    return { allowPublish: false, reason: `Doğrulama skoru yetersiz: %${verificationScore}` }
  }

  if (missingContent.length > 0) {
    return { allowPublish: false, reason: `Eksik içerik: ${missingContent.join(", ")}` }
  }

  if (!QUALITY_CONTRACT_ENABLED()) {
    return { allowPublish: true }
  }

  const chain = parseQualityChain(rawChain)
  if (!skipOcr) {
    const ocrGate = chain.gates.find((g) => g.stage === "ocr_complete")
    if (ocrGate && !ocrGate.pass) {
      return { allowPublish: false, reason: "OCR kalite kapısı geçilmedi" }
    }
  }

  for (const stage of PREREQ_STAGES) {
    const gate = chain.gates.find((g) => g.stage === stage)
    if (!gate?.pass) {
      return { allowPublish: false, reason: `Kalite zinciri "${stage}" kapısı geçilmedi veya eksik` }
    }
  }

  return { allowPublish: true }
}
