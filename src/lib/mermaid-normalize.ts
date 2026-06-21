/**
 * Render-time Mermaid syntax normalization. Does not modify stored note content.
 */

/** Remove standalone `end` lines only when no subgraph is present (stray AI artifact). */
export function removeStrayMermaidEndLines(chart: string): string {
  if (chart.toLowerCase().includes("subgraph")) return chart
  return chart.replace(/^\s*end\s*$/gim, "")
}

export function normalizeMermaidChart(raw: string): string {
  if (!raw || !raw.trim()) return ""

  let chart = raw.replace(/\r\n/g, "\n")

  // AI sometimes writes the whole chart on one line — insert breaks before edges (same line only)
  chart = chart.replace(/((?:graph|flowchart)\s+(?:LR|TD|BT|RL|TB))[ \t]+/gi, "$1\n")
  chart = chart.replace(/"\][ \t]+([A-Za-z0-9_]+)[ \t]*-/g, '"]\n$1 -')
  chart = chart.replace(/\)[ \t]+([A-Za-z0-9_]+)[ \t]*-/g, ")\n$1 -")
  chart = chart.replace(/\][ \t]+([A-Za-z0-9_]+)[ \t]*-/g, "]\n$1 -")

  // Invalid edge labels: -- "Label" --> or -- 'Label' -->
  chart = chart.replace(/--[ \t]*"([^"]+)"[ \t]*-->/g, '-->|"$1"|')
  chart = chart.replace(/--[ \t]*'([^']+)'[ \t]*-->/g, '-->|"$1"|')

  // Single-token unquoted labels: -- Evet --> (not multi-word)
  chart = chart.replace(
    /--[ \t]+([A-Za-z0-9_İıŞşÇçĞğÜüÖö]+)[ \t]*-->/g,
    '-->|"$1"|'
  )

  return chart
}

/** Single render-time prep: normalize syntax, then strip stray `end` lines when safe. */
export function prepareMermaidForRender(raw: string): string {
  return removeStrayMermaidEndLines(normalizeMermaidChart(raw))
}
