import { test, expect } from "vitest"
import { checkConceptCoverage } from "../lib/coverage-check"

test("checkConceptCoverage verifies presence of concepts in notes and Q&A", () => {
  const concepts = [
    "SPK: Sermaye Piyasası Kurulu",
    "Süre: 10 iş günü",
    "Cezası: 50.000 TL",
    "SadeceKey",
  ]

  const notes = "Ders notu içinde Sermaye Piyasası Kurulu ve 10 iş günü geçmektedir."
  const questionsText = "Soruda Sermaye Piyasası Kurulu, 50.000 TL ve SadeceKey geçiyor mu?"
  const flashcardsText = ""

  const result = checkConceptCoverage(concepts, notes, questionsText, flashcardsText)

  // covered: SPK (in notes and questions), Süre (in notes, but not questions? wait, inQA is check in questions+flashcards. In our test, questionsText doesn't contain '10 iş günü', so Süre is missing in QA!)
  // covered: Cezası (wait, Cezası is in QA but is it in notes? '50.000 TL' is not in notes. So Cezası is missing in Notes!)
  // covered: SadeceKey (is not in notes, so missing in Notes!)
  
  expect(result.covered).toContain("SPK: Sermaye Piyasası Kurulu")
  expect(result.missingInNotes).toContain("Cezası: 50.000 TL")
  expect(result.missingInNotes).toContain("SadeceKey")
  expect(result.missingInQA).toContain("Süre: 10 iş günü")
})
