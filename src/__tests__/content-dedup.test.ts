import { describe, it, expect } from "vitest"
import { dedupFlashcards, dedupQuestions, contentFingerprint } from "@/lib/content-dedup"

describe("content-dedup", () => {
  it("contentFingerprint aynı normalize metin için aynı hash", () => {
    expect(contentFingerprint("Merhaba Dünya!")).toBe(contentFingerprint("merhaba dünya"))
  })

  it("dedupFlashcards tekrarlayan ön yüzleri eler", () => {
    const cards = [
      { front: "SPK nedir?", back: "Sermaye Piyasası Kurulu" },
      { front: "SPK nedir?", back: "Sermaye Piyasası Kurulu" },
      { front: "BDDK nedir?", back: "Bankacılık düzenleme" },
    ]
    const out = dedupFlashcards(cards)
    expect(out).toHaveLength(2)
  })

  it("dedupQuestions aynı metin+şıkları eler", () => {
    const qs = [
      { text: "Hangisi doğrudur?", options: ["A) x", "B) y"] },
      { text: "Hangisi doğrudur?", options: ["A) x", "B) y"] },
      { text: "Farklı soru?", options: ["A) a", "B) b"] },
    ]
    const out = dedupQuestions(qs)
    expect(out).toHaveLength(2)
  })
})
