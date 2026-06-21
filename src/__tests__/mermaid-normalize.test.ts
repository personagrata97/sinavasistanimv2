import { describe, it, expect } from "vitest"
import { normalizeMermaidChart } from "@/lib/mermaid-normalize"

describe("normalizeMermaidChart", () => {
  it("dev.db-style Evet/Hayır arrow labels düzeltmeli", () => {
    const input = `flowchart TD
    A["Karar"] -- "Evet" --> B["Devam"]
    B -- "Hayır" --> C["Dur"]`
    const result = normalizeMermaidChart(input)
    expect(result).toContain('-->|"Evet"|')
    expect(result).toContain('-->|"Hayır"|')
    expect(result).not.toContain('-- "Evet" -->')
    expect(result).not.toContain("-- 'Hayır' -->")
  })

  it("zaten geçerli ok etiketlerini değiştirmemeli", () => {
    const valid = `flowchart TD
    A["Başlangıç"] --> B["Bitiş"]
    A -->|"Tamam"| B
    C --- D
    E -.-> F
    G ==> H`
    expect(normalizeMermaidChart(valid)).toBe(valid)
  })

  it("subgraph ve end bloklarını korumalı", () => {
    const input = `flowchart TD
    subgraph Grup1["Türkçe Grup"]
      X["İçerik"] --> Y["Son"]
    end
    end`
    const result = normalizeMermaidChart(input)
    expect(result).toContain("subgraph")
    expect(result).toMatch(/^\s*end\s*$/m)
  })

  it("Türkçe karakterli tek kelimelik ok etiketlerini düzeltmeli", () => {
    const input = "A --> B\nC -- Evet --> D\nE -- Hayır --> F"
    const result = normalizeMermaidChart(input)
    expect(result).toContain('-->|"Evet"|')
    expect(result).toContain('-->|"Hayır"|')
  })

  it("dev.db örnekleri: Hayır/Evet ok etiketleri", () => {
    const input = `B -- "Hayır" --> C["Veri İşlenemez"]
B -- "Evet" --> D["Envanterde"]`
    const result = normalizeMermaidChart(input)
    expect(result).toContain('B -->|"Hayır"| C["Veri İşlenemez"]')
    expect(result).toContain('B -->|"Evet"| D["Envanterde"]')
  })

  it("node içindeki <br> etiketlerini korumalı", () => {
    const input = 'A["Satır 1<br>Satır 2"] -- "Evet" --> B["Son"]'
    const result = normalizeMermaidChart(input)
    expect(result).toContain("<br>")
    expect(result).toContain('-->|"Evet"|')
  })

  it("idempotent olmalı", () => {
    const input = `graph TD
    A -- "Evet" --> B
    C -- Hayır --> D`
    const once = normalizeMermaidChart(input)
    const twice = normalizeMermaidChart(once)
    expect(twice).toBe(once)
  })

  it("boş girdi için boş dönmeli", () => {
    expect(normalizeMermaidChart("")).toBe("")
    expect(normalizeMermaidChart("   ")).toBe("")
  })

  it("graph TD ve flowchart TD ile çalışmalı", () => {
    const graphTd = normalizeMermaidChart('graph TD    A -- "Evet" --> B')
    const flowchartTd = normalizeMermaidChart('flowchart TD    A -- "Evet" --> B')
    expect(graphTd).toContain("graph TD\n")
    expect(flowchartTd).toContain("flowchart TD\n")
    expect(graphTd).toContain('-->|"Evet"|')
    expect(flowchartTd).toContain('-->|"Evet"|')
  })

  it("çok kelimeli etiketleri tek token kuralıyla bozmamalı", () => {
    const input = 'A -- Not Applicable --> B'
    const result = normalizeMermaidChart(input)
    expect(result).toBe(input)
  })
})
