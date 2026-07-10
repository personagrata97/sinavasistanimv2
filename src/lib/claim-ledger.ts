import { THRESHOLDS, atomScaledThreshold } from "@/lib/threshold-calibration"

export type ClaimAtomType = "kanun" | "madde" | "tarih" | "sure" | "oran"

export type ClaimAtom = {
  type: ClaimAtomType
  value: string
  normalized: string
  context: string
}

export type ClaimLedgerResult = {
  atoms: ClaimAtom[]
  verified: ClaimAtom[]
  missing: ClaimAtom[]
  coverageRatio: number
  pass: boolean
}

const PATTERNS: Array<{ type: ClaimAtomType; re: RegExp }> = [
  { type: "kanun", re: /\b(\d{3,5})\s*sayılı\s+(?:Kanun[a-z]*)?\b/gi },
  { type: "madde", re: /\b(?:madde|m\.)\s*(\d+[a-zA-Z]?(?:\s*[-–]\s*\d+[a-zA-Z]?)?)\b/gi },
  { type: "tarih", re: /\b(?<!(?:iso|iec|ts|en|bs|standart|standard|no|nolu|№)\s*)(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\b(?:19|20)\d{2}\b)(?!\s*(?:sayılı|nolu|madde|m\.))\b/gi },
  { type: "sure", re: /\b(\d+)\s*(?:iş\s*)?(?:gün|ay|yıl|saat|hafta)\b/gi },
  { type: "oran", re: /\b(?:%\s*)?(\d+(?:[.,]\d+)?)\s*(?:%|oran|yüzde)\b/gi },
]

export function parseTurkishNumber(words: string[]): number {
  let total = 0
  let current = 0

  const values: Record<string, number> = {
    bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9,
    on: 10, yirmi: 20, otuz: 30, kırk: 40, elli: 50, altmış: 60, yetmiş: 70, seksen: 80, doksan: 90,
    yüz: 100, bin: 1000
  }

  for (const w of words) {
    const val = values[w]
    if (val === undefined) return 0

    if (val === 1000) {
      if (current === 0) current = 1
      total += current * 1000
      current = 0
    } else if (val === 100) {
      if (current === 0) current = 1
      current = current * 100
    } else {
      current += val
    }
  }
  return total + current
}

export function normalizeTextualNumbers(text: string): string {
  const values: Record<string, number> = {
    bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9,
    on: 10, yirmi: 20, otuz: 30, kırk: 40, elli: 50, altmış: 60, yetmiş: 70, seksen: 80, doksan: 90,
    yüz: 100, bin: 1000
  }

  const wordsWithPunc = text.split(/(\s+|[.,;!?()[\]{}'"`\-–—])/)
  const result: string[] = []

  let i = 0
  while (i < wordsWithPunc.length) {
    const token = wordsWithPunc[i]
    const tokenLower = token.toLocaleLowerCase("tr-TR")

    if (values[tokenLower] !== undefined) {
      const run: string[] = [tokenLower]
      let j = i + 1
      while (j < wordsWithPunc.length) {
        const nextToken = wordsWithPunc[j]
        if (/^\s+$/.test(nextToken)) {
          j++
          continue
        }
        const nextTokenLower = nextToken.toLocaleLowerCase("tr-TR")
        if (values[nextTokenLower] !== undefined) {
          run.push(nextTokenLower)
          j++
        } else {
          break
        }
      }
      const parsedValue = parseTurkishNumber(run)
      result.push(parsedValue.toString())
      i = j
    } else {
      result.push(token)
      i++
    }
  }

  return result.join("")
}

function normalizeAtomValue(type: ClaimAtomType, value: string): string {
  const v = value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ")
  if (type === "oran") return v.replace(",", ".").replace(/%/g, "").trim()
  if (type === "kanun") return v.replace(/\D/g, "")
  return v
}

function extractContext(text: string, index: number, radius = 40): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + radius)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

/** Kaynak metinden olgusal atomları çıkarır */
export function extractClaimAtoms(sourceContent: string): ClaimAtom[] {
  const normalizedSource = normalizeTextualNumbers(sourceContent)
  const atoms: ClaimAtom[] = []
  const seen = new Set<string>()

  for (const { type, re } of PATTERNS) {
    const regex = new RegExp(re.source, re.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(normalizedSource)) !== null) {
      const raw = match[0]
      const normalized = normalizeAtomValue(type, match[1] ?? raw)
      const key = `${type}:${normalized}`
      if (seen.has(key) || normalized.length < 2) continue
      seen.add(key)
      atoms.push({
        type,
        value: raw.trim(),
        normalized,
        context: extractContext(normalizedSource, match.index),
      })
    }
  }

  return atoms
}

function atomInNotes(atom: ClaimAtom, notesLower: string): boolean {
  const n = atom.normalized
  const escapedN = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  if (atom.type === "oran") {
    const re = new RegExp(`(?:%\\s*${escapedN}\\b|yüzde\\s*${escapedN}\\b|${escapedN}\\s*%|${escapedN}\\s*oran)`, "i")
    return re.test(notesLower)
  }
  if (atom.type === "sure") {
    const re = new RegExp(`\\b${escapedN}\\s*(?:iş\\s*)?(?:gün|ay|yıl|saat|hafta)`, "i")
    return re.test(notesLower)
  }
  if (atom.type === "kanun") {
    const re = new RegExp(`\\b${escapedN}\\s*sayılı`, "i")
    return re.test(notesLower)
  }
  if (atom.type === "madde") {
    const re = new RegExp(`\\b(?:madde|m\\.)\\s*${escapedN}\\b`, "i")
    return re.test(notesLower)
  }
  if (atom.type === "tarih") {
    const re = new RegExp(`\\b${escapedN}\\b`, "i")
    return re.test(notesLower)
  }

  return notesLower.includes(n)
}

/** Notlarda kaynak atomlarının ne kadarının geçtiğini doğrular */
export function verifyClaimsInNotes(
  sourceContent: string,
  notes: string,
  opts?: { minCoverage?: number },
): ClaimLedgerResult {
  const atoms = extractClaimAtoms(sourceContent)
  const normalizedNotes = normalizeTextualNumbers(notes)
  const notesLower = normalizedNotes.toLocaleLowerCase("tr-TR")
  const verified: ClaimAtom[] = []
  const missing: ClaimAtom[] = []

  for (const atom of atoms) {
    if (atomInNotes(atom, notesLower)) verified.push(atom)
    else missing.push(atom)
  }

  const coverageRatio = atoms.length === 0 ? 1 : verified.length / atoms.length
  const minCoverage =
    opts?.minCoverage ??
    atomScaledThreshold(THRESHOLDS.CLAIM_COVERAGE_MIN, atoms.length)

  return {
    atoms,
    verified,
    missing,
    coverageRatio,
    pass: coverageRatio >= minCoverage,
  }
}
