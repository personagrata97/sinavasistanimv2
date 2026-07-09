import { KONTROLOR_ENSEMBLE } from "@/lib/feature-flags"
import { verifyNotesAgainstSource, callAI, extractCleanJson } from "@/lib/ai-service"
import { verifyClaimsInNotes } from "@/lib/claim-ledger"
import { THRESHOLDS, calculateDynamicPenalty } from "@/lib/threshold-calibration"
import type { DocumentType } from "@/lib/document-processing-profile"
import { splitSourceIntoAuditChunks } from "@/lib/mufettis-exhaustive"

export type EnsembleVote = {
  name: string
  pass: boolean
  score: number
  details?: string[]
}

export type KontrolorEnsembleResult = {
  pass: boolean
  score: number
  votes: EnsembleVote[]
  verification: {
    score: number
    missingTopics: string[]
    issues: string[]
    suggestions: string[]
    groundTruthQuestions?: string[]
  }
}

/** Tek bir kaynak parçası için atomik doğrulama çalıştırır */
async function verifyStrictAtomChunk(
  sourceChunk: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string,
): Promise<{ pass: boolean; score: number; issues: string[] }> {
  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
BÖLÜM: "${sectionTitle}"
Sen ATOMİK DOĞRULUK denetçisisin. Yalnızca kanun numarası, madde, tarih, süre ve oran gibi SAYISAL/HUKUKİ iddiaları kaynakla karşılaştır.
Pedagojik kaliteyi DEĞERLENDİRME.

KAYNAK:
${sourceChunk.replace(/"/g, "'")}

NOT:
${generatedNotes.replace(/"/g, "'")}

JSON:
{"score":0-100,"issues":["..."]}`

  try {
    const raw = await callAI(prompt, 1, "kontrolor")
    const result = extractCleanJson(raw) as { score?: number; issues?: string[] }
    const score = result.score ?? 0
    const issues = result.issues ?? []
    const pass = score >= 95 && issues.length === 0
    return { pass, score, issues }
  } catch {
    return { pass: false, score: -1, issues: ["Atomik denetim API hatası"] }
  }
}

/** Uzun kaynak metinleri parçalara bölerek atomik doğrulama yapar ve sonuçları birleştirir */
async function verifyStrictAtomPrompt(
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string,
): Promise<{ pass: boolean; score: number; issues: string[] }> {
  // 8000 karakter altındaki metinler için doğrudan tek çağrı
  if (sourceContent.length <= 8000) {
    return verifyStrictAtomChunk(sourceContent.slice(0, 8000), generatedNotes, sectionTitle, courseName)
  }

  // Uzun metinleri parçala (her parça max 8000 karakter)
  const chunks = splitSourceIntoAuditChunks(sourceContent, 8000)
  console.log(`[KONTROLOR] 📦 Atomik doğrulama: ${sourceContent.length} karakter → ${chunks.length} parçaya bölündü`)

  const results = await Promise.all(
    chunks.map((chunk) => verifyStrictAtomChunk(chunk, generatedNotes, sectionTitle, courseName))
  )

  // Sonuçları birleştir: en düşük skor + tüm issue'lar
  const allIssues = results.flatMap((r) => r.issues)
  const validScores = results.filter((r) => r.score >= 0).map((r) => r.score)
  const minScore = validScores.length > 0 ? Math.min(...validScores) : 0
  const pass = results.every((r) => r.pass)

  return { pass, score: minScore, issues: allIssues }
}

/** Byzantine: 3 oy — standart kontrolör, atomik prompt, claim ledger */
export async function runKontrolorEnsemble(
  sourceContent: string,
  notes: string,
  sectionTitle: string,
  courseName: string,
  sourceMode: "strict" | "enriched" = "strict",
  documentType?: DocumentType,
  attemptNumber: number = 1,
  sectionConfidence?: string,
): Promise<KontrolorEnsembleResult> {
  const primary = await verifyNotesAgainstSource(
    sourceContent,
    notes,
    sectionTitle,
    courseName,
    sourceMode,
    documentType,
    attemptNumber,
    sectionConfidence,
  )

  if (!KONTROLOR_ENSEMBLE()) {
    const pass = primary.score === 100
    return {
      pass,
      score: primary.score,
      votes: [{ name: "kontrolor", pass, score: primary.score }],
      verification: primary,
    }
  }

  const atomPrompt = await verifyStrictAtomPrompt(sourceContent, notes, sectionTitle, courseName)
  const ledger = verifyClaimsInNotes(sourceContent, notes)

  const votes: EnsembleVote[] = [
    {
      name: "kontrolor_primary",
      pass: primary.score === 100 && primary.missingTopics.length === 0 && primary.issues.length === 0,
      score: primary.score,
      details: [...primary.missingTopics, ...primary.issues].slice(0, 5),
    },
    {
      name: "kontrolor_atom_prompt",
      pass: atomPrompt.pass,
      score: atomPrompt.score,
      details: atomPrompt.issues.slice(0, 5),
    },
    {
      name: "claim_ledger",
      pass: ledger.pass,
      score: Math.round(ledger.coverageRatio * 100),
      details: ledger.missing.slice(0, 5).map((a) => `${a.type}: ${a.value}`),
    },
  ]

  const failCount = votes.filter((v) => !v.pass).length
  const pass = failCount < THRESHOLDS.KONTROLOR_ENSEMBLE_FAIL_VOTES

  let score = primary.score
  if (!pass && primary.score === 100) {
    score = Math.min(95, Math.min(...votes.map((v) => (v.score >= 0 ? v.score : 95))))
    primary.score = score
  }

  const hasDissentingVote = votes.some((v) => !v.pass)
  if (hasDissentingVote && score > 98) {
    score = 98
    primary.score = score
  }

  // Dinamik ceza puanı uygulaması
  if (!ledger.pass && ledger.missing.length > 0) {
    const penaltyPerAtom = calculateDynamicPenalty(ledger.atoms.length, notes.length, 5)
    const totalPenalty = ledger.missing.length * penaltyPerAtom
    score = Math.max(70, score - totalPenalty)
    primary.score = score

    primary.missingTopics.push(
      ...ledger.missing.slice(0, 3).map((a) => `[ATOM EKSİK] ${a.type}: ${a.value}`),
    )
  }

  return { pass, score, votes, verification: primary }
}
