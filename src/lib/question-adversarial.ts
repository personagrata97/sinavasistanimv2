import { ADVERSARIAL_QUESTIONS } from "@/lib/feature-flags"
import { validateQuestionsWithSolver, validateFlashcardsWithSolver } from "@/lib/ai-service"

export type AdversarialResult = {
  questions: any[]
  pass: boolean
  removedCount: number
  metrics: { pass1: number; pass2: number; final: number }
}

/** İki bağımsız solver turu — her ikisinde de geçen sorular kalır */
export async function validateQuestionsAdversarial(
  notesContent: string,
  questions: any[],
): Promise<AdversarialResult> {
  if (!ADVERSARIAL_QUESTIONS() || questions.length === 0) {
    return {
      questions,
      pass: true,
      removedCount: 0,
      metrics: { pass1: questions.length, pass2: questions.length, final: questions.length },
    }
  }

  const pass1 = await validateQuestionsWithSolver(notesContent, questions)
  const pass2 = await validateQuestionsWithSolver(notesContent, [...questions])

  const pass2Set = new Set(
    pass2.map((q) => `${q.text?.slice(0, 80)}|${q.correct ?? q.correctOption ?? ""}`),
  )
  const final = pass1.filter((q) =>
    pass2Set.has(`${q.text?.slice(0, 80)}|${q.correct ?? q.correctOption ?? ""}`),
  )

  const removedCount = questions.length - final.length
  if (removedCount > 0) {
    console.log(`[ADVERSARIAL] ${removedCount} soru çift solver doğrulamasından elendi`)
  }

  return {
    questions: final,
    pass: final.length > 0 || questions.length === 0,
    removedCount,
    metrics: { pass1: pass1.length, pass2: pass2.length, final: final.length },
  }
}

export type AdversarialFlashcardResult = {
  flashcards: any[]
  pass: boolean
  removedCount: number
  metrics: { pass1: number; pass2: number; final: number }
}

/** İki bağımsız solver turu — her ikisinde de geçen kartlar kalır */
export async function validateFlashcardsAdversarial(
  notesContent: string,
  flashcards: any[],
): Promise<AdversarialFlashcardResult> {
  if (!ADVERSARIAL_QUESTIONS() || flashcards.length === 0) {
    return {
      flashcards,
      pass: true,
      removedCount: 0,
      metrics: { pass1: flashcards.length, pass2: flashcards.length, final: flashcards.length },
    }
  }

  const pass1 = await validateFlashcardsWithSolver(notesContent, flashcards)
  const pass2 = await validateFlashcardsWithSolver(notesContent, [...flashcards])

  const pass2Set = new Set(
    pass2.map((f) => `${f.front?.slice(0, 80)}|${f.back?.slice(0, 80)}`),
  )
  const final = pass1.filter((f) =>
    pass2Set.has(`${f.front?.slice(0, 80)}|${f.back?.slice(0, 80)}`),
  )

  const removedCount = flashcards.length - final.length
  if (removedCount > 0) {
    console.log(`[ADVERSARIAL] ${removedCount} flashcard çift solver doğrulamasından elendi`)
  }

  return {
    flashcards: final,
    pass: final.length > 0 || flashcards.length === 0,
    removedCount,
    metrics: { pass1: pass1.length, pass2: pass2.length, final: final.length },
  }
}
