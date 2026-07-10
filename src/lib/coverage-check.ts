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
