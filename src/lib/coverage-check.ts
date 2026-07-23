import { normalizeForComparison } from "./ai-service"

export function checkConceptCoverage(
  concepts: string[],
  notes: string,
  questionsText: string,
  flashcardsText: string
): { covered: string[]; missingInNotes: string[]; missingInQA: string[] } {
  const missingInNotes: string[] = []
  const missingInQA: string[] = []
  const covered: string[] = []

  for (const concept of concepts) {
    const parts = concept.split(":")
    const value = parts[1] ? parts.slice(1).join(":").trim() : parts[0].trim()
    const key = parts[0].trim()
    const needle = normalizeForComparison(value || key)
    if (!needle) continue
    
    const inNotes = normalizeForComparison(notes).includes(needle)
    const inQA = normalizeForComparison(questionsText + flashcardsText).includes(needle)

    if (!inNotes) {
      missingInNotes.push(concept)
    }
    if (inNotes && !inQA) {
      missingInQA.push(concept)
    }
    if (inNotes && inQA) {
      covered.push(concept)
    }
  }

  return { covered, missingInNotes, missingInQA }
}

export type ExamInventoryItemInput = { cat: string; text: string; key: string }

export function checkExamInventoryCoverage(
  inventory: ExamInventoryItemInput[],
  notes: string,
  questionsText: string,
  flashcardsText: string
): {
  totalCount: number
  coveredInNotes: number
  coveredInQA: number
  missingInNotes: ExamInventoryItemInput[]
  missingInQA: ExamInventoryItemInput[]
  statsFormatted: string
} {
  const missingInNotes: ExamInventoryItemInput[] = []
  const missingInQA: ExamInventoryItemInput[] = []
  let coveredInNotes = 0
  let coveredInQA = 0

  const normalizedNotes = normalizeForComparison(notes)
  const normalizedQA = normalizeForComparison(questionsText + " " + flashcardsText)

  for (const item of inventory) {
    const keyNeedle = normalizeForComparison(item.key || item.text)
    if (!keyNeedle) continue

    const inNotes = normalizedNotes.includes(keyNeedle)
    const inQA = normalizedQA.includes(keyNeedle)

    if (inNotes) coveredInNotes++
    else missingInNotes.push(item)

    if (inQA) coveredInQA++
    else missingInQA.push(item)
  }

  const totalCount = inventory.length
  const statsFormatted = `Envanter: ${coveredInNotes}/${totalCount} · Sorularda: ${coveredInQA}/${totalCount}`

  return {
    totalCount,
    coveredInNotes,
    coveredInQA,
    missingInNotes,
    missingInQA,
    statsFormatted
  }
}
