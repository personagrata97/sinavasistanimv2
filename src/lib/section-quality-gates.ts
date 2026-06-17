export type QualityStageFlags = {
  notesGenerated: boolean
  kontrolorGroundTruth: boolean
  mufettis: boolean
  cerrahiYama: boolean
  flashcards: boolean
  questions: boolean
  published: boolean
}

export type ParsedQualityIssues = {
  missingTopics?: string[]
  issues?: string[]
  suggestions?: string[]
  attemptHistory?: AttemptHistoryEntry[]
  currentAttempt?: number
  currentMicroPhase?: string | null
  stages?: Partial<QualityStageFlags>
  auditResult?: { passed?: boolean | string; missingDetails?: string[]; contradictions?: string[] }
  inspectorFailed?: boolean
  message?: string
  [key: string]: unknown
}

export type AttemptHistoryEntry = {
  attempt: number
  score: number
  missingTopics?: string[]
  issues?: string[]
  suggestions?: string[]
  kontrolorGroundTruth?: boolean
  mufettis?: boolean
  fullyApproved?: boolean
  isSmartInject?: boolean
}

export const STAGE_LABELS = {
  notesGenerated: "Not üretildi",
  kontrolorGroundTruth: "Kontrolör onayı",
  mufettis: "Müfettiş onayı",
  cerrahiYama: "Cerrahi yama",
  flashcards: "Bilgi kartları",
  questions: "Soru havuzu",
  published: "Yayında",
} as const

export const STATUS_LABELS = {
  fullyApproved: "ONAYLANDI",
  kontrolorOnly: "KONTROLÖR ONAYI",
  awaitingMufettis: "MÜFETTİŞ DENETİMİ BEKLİYOR",
  inspectorFailed: "ONAYDAN GEÇMEDİ (EKSİKLER VAR)",
  inProgress: "KALİTE DÖNGÜSÜ DEVAM EDİYOR",
  processing: "YAPAY ZEKA MOTORU ÇALIŞIYOR",
  skipped: "DOĞRULAMA BYPASS EDİLDİ",
} as const

const EMPTY_STAGES: QualityStageFlags = {
  notesGenerated: false,
  kontrolorGroundTruth: false,
  mufettis: false,
  cerrahiYama: false,
  flashcards: false,
  questions: false,
  published: false,
}

export function parseQualityIssues(verificationIssues: string | null): ParsedQualityIssues {
  if (!verificationIssues) return {}
  try {
    const parsed = JSON.parse(verificationIssues)
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function auditPassed(issuesObj: ParsedQualityIssues): boolean {
  const passed = issuesObj.auditResult?.passed
  return passed === true || passed === "true"
}

export function deriveQualityStages(
  issuesObj: ParsedQualityIssues,
  verificationScore: number,
  processed: boolean
): QualityStageFlags {
  const score = verificationScore ?? -1
  const inspectorFailed = issuesObj.inspectorFailed === true
  const explicit = issuesObj.stages

  const notesGenerated = explicit?.notesGenerated === true || score !== -1

  let kontrolorGroundTruth = explicit?.kontrolorGroundTruth === true
  if (!kontrolorGroundTruth) {
    if (inspectorFailed) {
      kontrolorGroundTruth = true
    } else {
      kontrolorGroundTruth = score === 100
    }
  }

  let mufettis = explicit?.mufettis === true
  if (!mufettis) {
    if (auditPassed(issuesObj)) {
      mufettis = true
    } else if (processed && score === 100 && !inspectorFailed) {
      mufettis = true
    }
  }

  let published = explicit?.published === true
  if (!published) {
    published = processed && score === 100 && mufettis
  }

  return {
    notesGenerated,
    kontrolorGroundTruth,
    mufettis,
    cerrahiYama: explicit?.cerrahiYama === true,
    flashcards: explicit?.flashcards === true,
    questions: explicit?.questions === true,
    published,
  }
}

export type QualityBadgeState = {
  tone: "green" | "amber" | "red" | "slate" | "blue"
  badgeClass: string
  scoreLabel: string
  hint: string | null
  isFullyApproved: boolean
}

export function getQualityBadgeState(
  score: number | null,
  processed: boolean,
  stages: QualityStageFlags,
  currentMicroPhase?: string | null
): QualityBadgeState {
  const s = score ?? -1

  if (s === -1) {
    return {
      tone: "slate",
      badgeClass: "bg-slate-500/10 text-slate-400 border border-slate-500/20",
      scoreLabel: "Atlandı",
      hint: null,
      isFullyApproved: false,
    }
  }

  if (stages.published || (processed && s === 100 && stages.mufettis)) {
    return {
      tone: "green",
      badgeClass: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-md shadow-emerald-950/20 hover:bg-emerald-500/20",
      scoreLabel: `Skor: %${s}`,
      hint: null,
      isFullyApproved: true,
    }
  }

  if (!processed && currentMicroPhase) {
    return {
      tone: "blue",
      badgeClass: "bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20",
      scoreLabel: `Skor: %${s}`,
      hint: currentMicroPhase,
      isFullyApproved: false,
    }
  }

  if (stages.kontrolorGroundTruth && !stages.mufettis) {
    return {
      tone: "amber",
      badgeClass: "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20",
      scoreLabel: `Skor: %${s}`,
      hint: "Kontrolör OK — Müfettiş sırada",
      isFullyApproved: false,
    }
  }

  if (s >= 70) {
    return {
      tone: "amber",
      badgeClass: "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20",
      scoreLabel: `Skor: %${s}`,
      hint: null,
      isFullyApproved: false,
    }
  }

  return {
    tone: "red",
    badgeClass: "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20",
    scoreLabel: `Skor: %${s}`,
    hint: null,
    isFullyApproved: false,
  }
}

export function isAttemptFullyApproved(
  historyEntry: AttemptHistoryEntry,
  sectionProcessed?: boolean
): boolean {
  if (historyEntry.fullyApproved === true) return true
  if (historyEntry.fullyApproved === false) return false
  if (historyEntry.mufettis === true && sectionProcessed) return true
  return false
}

export function getAttemptDisplayLabel(
  historyEntry: AttemptHistoryEntry,
  sectionProcessed?: boolean
): { headline: string; isFullyApproved: boolean; isKontrolorOnly: boolean } {
  if (isAttemptFullyApproved(historyEntry, sectionProcessed)) {
    return { headline: STATUS_LABELS.fullyApproved, isFullyApproved: true, isKontrolorOnly: false }
  }

  const kontrolorOnly =
    historyEntry.kontrolorGroundTruth === true &&
    historyEntry.mufettis !== true &&
    historyEntry.score === 100

  if (kontrolorOnly) {
    return {
      headline: `${STATUS_LABELS.kontrolorOnly} (%100)`,
      isFullyApproved: false,
      isKontrolorOnly: true,
    }
  }

  return { headline: "", isFullyApproved: false, isKontrolorOnly: false }
}

export function getModalStatusLabel(
  stages: QualityStageFlags,
  processed: boolean,
  isProcessing: boolean,
  isSkipped: boolean,
  hasMufettisIssues: boolean,
  actualAttempt: number,
  currentMicroPhase?: string | null
): string {
  if (isProcessing) {
    return currentMicroPhase || STATUS_LABELS.processing
  }
  if (isSkipped) return STATUS_LABELS.skipped
  if (stages.published || (processed && stages.mufettis)) {
    return actualAttempt === 1
      ? `${STATUS_LABELS.fullyApproved} (1. TUR)`
      : `${STATUS_LABELS.fullyApproved} (${actualAttempt}. TUR)`
  }
  if (hasMufettisIssues) return STATUS_LABELS.inspectorFailed
  if (stages.kontrolorGroundTruth && !stages.mufettis) return STATUS_LABELS.awaitingMufettis
  return `${actualAttempt}. ${STATUS_LABELS.inProgress}`
}

export function getScoreRingTone(
  score: number,
  stages: QualityStageFlags,
  processed: boolean,
  isSkipped: boolean
): "green" | "amber" | "red" | "slate" {
  if (isSkipped) return "slate"
  if (processed && score === 100 && stages.mufettis) return "green"
  if (score >= 70) return "amber"
  return "red"
}

const RING_COLORS: Record<string, string> = {
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  slate: "#64748b",
}

export function getRingColor(tone: ReturnType<typeof getScoreRingTone>): string {
  return RING_COLORS[tone] ?? RING_COLORS.slate
}

export function defaultStages(partial: Partial<QualityStageFlags> = {}): QualityStageFlags {
  return { ...EMPTY_STAGES, ...partial }
}
