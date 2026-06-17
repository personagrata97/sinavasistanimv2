import { describe, it, expect } from "vitest"
import { stitchOcrMarkdownChunks } from "@/lib/ai-service"

describe("stitchOcrMarkdownChunks", () => {
  it("örtüşen paragrafı tekrar etmeden birleştirir", () => {
    const a = "Tablo başlığı\n| Kolon A | Kolon B |\n| --- | --- |\n| Satır 1 | Değer |"
    const b = "| Satır 1 | Değer |\n| Satır 2 | Devam |"
    const merged = stitchOcrMarkdownChunks(a, b)
    expect(merged).toContain("Satır 2")
    expect(merged.match(/\| Satır 1 \| Değer \|/g)?.length).toBe(1)
  })

  it("örtüşme yoksa iki parçayı ayırır", () => {
    const a = "Bölüm A içeriği"
    const b = "Bölüm B içeriği"
    expect(stitchOcrMarkdownChunks(a, b)).toBe("Bölüm A içeriği\n\nBölüm B içeriği")
  })
})
