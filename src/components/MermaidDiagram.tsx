"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { prepareMermaidForRender } from "@/lib/mermaid-normalize"

export default function MermaidDiagram({ chart }: { chart: string }) {
  const [error, setError] = useState(false)
  const [svgContent, setSvgContent] = useState<string>("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    const renderId = `mermaid-${Math.random().toString(36).slice(2, 11)}`

    async function renderDiagram() {
      if (!chart) {
        if (isMounted) {
          setLoading(false)
          setSvgContent("")
        }
        return
      }

      if (isMounted) {
        setLoading(true)
        setError(false)
        setSvgContent("")
      }

      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "14px",
            primaryColor: "#1e3a5f",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#38bdf8",
            lineColor: "#64748b",
            secondaryColor: "#1e293b",
            tertiaryColor: "#0f172a",
          },
          securityLevel: "loose",
          flowchart: { htmlLabels: true, curve: "basis" },
        })

        const cleanChart = prepareMermaidForRender(chart)

        const { svg } = await mermaid.render(renderId, cleanChart)

        if (isMounted) {
          setSvgContent(svg)
          setError(false)
          setLoading(false)
        }
      } catch (err) {
        console.error("Mermaid error:", err)
        if (isMounted) {
          setError(true)
          setLoading(false)
        }
      }
    }

    renderDiagram()

    return () => {
      isMounted = false
      document.getElementById(renderId)?.remove()
      document.querySelector(`[data-mermaid-id="${renderId}"]`)?.remove()
    }
  }, [chart])

  if (error) {
    return (
      <div className="my-4 p-4 bg-amber-950/30 rounded-xl border border-amber-700/40">
        <div className="text-amber-400 text-xs mb-2">⚠️ Diyagram Görüntülenemiyor</div>
        <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap bg-slate-900/60 p-3 rounded-lg">{chart}</pre>
      </div>
    )
  }

  return (
    <div className="my-4 p-4 bg-slate-900/60 rounded-xl border border-sky-500/10 overflow-hidden relative group">
      <style>{`
        .mermaid-container svg {
          width: 100% !important;
          max-width: 900px !important;
          height: auto !important;
          display: block;
          margin: 0 auto;
        }
      `}</style>
      <div className="text-[10px] text-sky-400/60 uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Akış Şeması
      </div>

      <div className="w-full flex justify-center py-2 overflow-auto mermaid-container min-h-[120px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-sky-400/70">
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
            <span className="text-xs">Şema yükleniyor…</span>
          </div>
        ) : (
          <div className="mermaid transition-opacity duration-300" dangerouslySetInnerHTML={{ __html: svgContent }} />
        )}
      </div>
    </div>
  )
}
