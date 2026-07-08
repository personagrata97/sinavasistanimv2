"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { createPortal } from "react-dom"
import { BookOpen, ChevronRight, Download, FileText, RefreshCw, Loader2, Bookmark, BookmarkCheck, Highlighter, X, Palette, Sparkles, ShieldCheck, AlertCircle, Bot, Check, Maximize, Minimize, Folder, Search } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeRaw from "rehype-raw"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { EmptyState, LoadingSkeleton, formatTitle, cleanMarkdown, Modal } from "./shared"
import { getMaterialsPreparingDescription, getNoNotesToast } from "@/lib/program-catalog"
import { Tooltip } from "@/components/ui/shared"
import { getBookmarkForCourse, setBookmark, removeBookmark, getHighlightsForSection, getHighlightsForCourse, addHighlight, removeHighlight, getColorClass, type Highlight } from "@/lib/study-marks"
import { PremiumMarkdownRenderer } from "./PremiumMarkdownRenderer"
import { SectionQualityModal } from "@/components/admin/SectionQualityModal"
import { parseQualityIssues, deriveQualityStages, getQualityBadgeState } from "@/lib/section-quality-gates"
import { prepareMermaidForRender } from "@/lib/mermaid-normalize"

const PDF_SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  body { font-family: 'Inter', sans-serif; color: #0f172a; padding: 40px; max-width: 800px; margin: 0 auto; background: #f8fafc; }
  .print-bar { position: fixed; top:0; left:0; right:0; background: linear-gradient(135deg, #1e3a5f, #1e40af); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
  .print-bar span { color: white; font-size: 14px; font-weight: 600; }
  .print-btn { background: linear-gradient(to right, #3b82f6, #4f46e5); color: white; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
  body { padding-top: 56px; }
  @media print { .print-bar { display: none; } body { padding-top: 0; max-width: 100% !important; margin: 0 !important; } table { width: 100%; table-layout: auto; } }
  h2 { font-size: 22px; color: #1e3a5f; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 3px solid #3b82f6; font-weight: 800; }
  h3 { font-size: 15px; color: #1e3a5f; margin: 18px 0 8px; font-weight: 700; }
  p, li { font-size: 13px; line-height: 1.8; color: #334155; }
  ul { list-style: disc; padding-left: 24px; }
  table { width: 100% !important; table-layout: fixed !important; border-collapse: collapse; margin: 16px 0; font-size: 12px; word-wrap: break-word; }
  th { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; font-weight: 700; color: #1e3a5f; }
  td { border: 1px solid #e2e8f0; padding: 10px 12px; vertical-align: top; }
  strong { color: #0f172a; }
  .mermaid-diagram-wrapper svg { max-height: 450px !important; width: auto !important; max-width: 100% !important; }
  .overflow-x-auto { overflow: visible !important; width: 100% !important; }
  .print-section-block { page-break-inside: auto !important; break-inside: auto !important; }
  h1, h2, h3, h4 { page-break-after: avoid !important; break-after: avoid !important; break-after: avoid-page !important; }
  p, div, li, span, tr { orphans: 3 !important; widows: 3 !important; }
`

import { ABBREVIATIONS_DICT } from "@/lib/abbreviations"


export function extractDynamicAbbreviations(sections: any[]): Record<string, string> {
  const dynamicDict: Record<string, string> = {}
  if (!sections || !Array.isArray(sections)) return dynamicDict

  for (const section of sections) {
    if (!section.notes) continue

    const notes = section.notes
    const lines = notes.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith("### 🔑")) {
        const rawTerm = line.replace("### 🔑", "").trim()
        const cleanTerm = rawTerm.split("(")[0].trim().replace(/[^a-zA-Z0-9-İıŞşÇçĞğÜüÖö]/g, "")
        
        if (cleanTerm && cleanTerm.length > 1) {
          let definition = ""
          for (let j = 1; j <= 5 && i + j < lines.length; j++) {
            const nextLine = lines[i + j].trim()
            if (nextLine.startsWith("- **Açılımı") || nextLine.startsWith("- **Açılımı veya Resmi Tanımı")) {
              definition = nextLine.replace(/- \*\*Açılımı( veya Resmi Tanımı)?:\*\*/i, "").trim()
              definition = definition.replace(/^\s*\*\*\s*/, "").replace(/\s*\*\*\s*$/, "")
              break
            }
          }
          if (cleanTerm && definition) {
            dynamicDict[cleanTerm] = definition
          }
        }
      }
    }
  }
  return dynamicDict
}

export function renderTextWithTooltips(children: React.ReactNode, dict: Record<string, string> = ABBREVIATIONS_DICT): React.ReactNode {
  if (typeof children !== "string") {
    if (Array.isArray(children)) {
      return children.map((child, idx) => (
        <span key={idx}>{renderTextWithTooltips(child, dict)}</span>
      ))
    }
    return children
  }

  const text = children
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length)
  if (keys.length === 0) return text
  
  const regex = new RegExp(`\\b(${keys.join("|")})\\b`, 'g')

  const parts = text.split(regex)
  if (parts.length <= 1) return text

  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const desc = dict[part] || dict[part.toUpperCase()] || ""
      return (
        <Tooltip key={index} content={desc}>
          <span className="text-amber-400 font-bold border-b border-dotted border-amber-400 cursor-help select-none hover:text-amber-300 transition-colors">
            {part}
          </span>
        </Tooltip>
      )
    }
    return part
  })
}

export default function NotesTab({ course, slug, isAdmin, isProfessional, onReloadCourse, initialSectionId, initialScrollKeyword, processingStatus }: { course: any; slug: string; isAdmin?: boolean; isProfessional?: boolean; onReloadCourse?: () => void; initialSectionId?: string; initialScrollKeyword?: string; processingStatus?: any }) {
  const [sections, setSections] = useState<any[]>(course.sections || [])

  const dynamicDict = useMemo(() => {
    return extractDynamicAbbreviations(sections)
  }, [sections])

  const mergedDict = useMemo(() => {
    let dbGlossary = {}
    try {
      if (course.glossary) dbGlossary = JSON.parse(course.glossary)
    } catch(e) {}
    return { ...ABBREVIATIONS_DICT, ...dynamicDict, ...dbGlossary }
  }, [dynamicDict, course.glossary])

  const renderTooltips = useCallback((children: React.ReactNode): React.ReactNode => {
    return renderTextWithTooltips(children, mergedDict)
  }, [mergedDict])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [currentBookmark, setCurrentBookmark] = useState<{ sectionId: string } | null>(null)
  const [highlightPopup, setHighlightPopup] = useState<{ x: number; y: number; text: string; sectionId: string; sectionTitle: string } | null>(null)
  const [highlightNote, setHighlightNote] = useState("")
  const [scrollKeyword, setScrollKeyword] = useState<string>(initialScrollKeyword || "")
  const [sectionHighlights, setSectionHighlights] = useState<Record<string, Highlight[]>>({})
  const [courseHighlights, setCourseHighlights] = useState<Highlight[]>([])
  const [showHighlightsMenu, setShowHighlightsMenu] = useState(false)
  const [activeScoreSection, setActiveScoreSection] = useState<any | null>(null)
  const [mounted, setMounted] = useState(false)
  const [isRefining, setIsRefining] = useState(false)
  const [isApproving, setIsApproving] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFocusMode) {
        setIsFocusMode(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    
    if (isFocusMode) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = "unset"
    }
  }, [isFocusMode])

  useEffect(() => {
    if (course?.sections) {
      setSections(course.sections)
    }
  }, [course?.sections])

  // Günün kavramından tıklandığında ilgili konuyu aç ve oraya kaydır
  useEffect(() => {
    if (initialSectionId) {
      setExpandedIds(new Set([initialSectionId]))
      setScrollKeyword(initialScrollKeyword || "");
      setTimeout(() => {
        const el = document.getElementById(`section-card-${initialSectionId}`)
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" })
          el.classList.add("ring-2", "ring-sky-500", "shadow-[0_0_20px_rgba(14,165,233,0.3)]", "transition-all", "duration-500")
          setTimeout(() => {
            el.classList.remove("ring-2", "ring-sky-500", "shadow-[0_0_20px_rgba(14,165,233,0.3)]")
          }, 1500)
        }
      }, 300)
    }
  }, [initialSectionId, initialScrollKeyword])

  // Bookmark yükle
  useEffect(() => {
    const bm = getBookmarkForCourse(slug)
    if (bm) setCurrentBookmark({ sectionId: bm.sectionId })
  }, [slug])

  // Kursun tüm highlight'larını yükle
  useEffect(() => {
    setCourseHighlights(getHighlightsForCourse(slug))
  }, [slug, sectionHighlights])

  // Highlight popup — metin seçildiğinde göster
  const handleTextSelect = useCallback((sectionId: string, sectionTitle: string) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return
    }
    const text = selection.toString().trim()
    if (text.length < 3) return

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setHighlightPopup({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
      text,
      sectionId,
      sectionTitle
    })
  }, [])

  const doHighlight = useCallback(async (color: Highlight["color"]) => {
    if (!highlightPopup) return
    const { saveUserAnnotation } = await import("@/lib/actions")

    const noteText = highlightNote.trim() || undefined
    const selectedText = highlightPopup.text
    const sectionId = highlightPopup.sectionId

    // 1. Önce iyimser (optimistic) olarak UI'a ekle (Hızlı tepki)
    const tempId = `temp-${Date.now()}`
    const tempHl: Highlight = {
      id: tempId,
      sectionId,
      sectionTitle: highlightPopup.sectionTitle,
      courseSlug: slug,
      selectedText,
      color,
      note: noteText,
      createdAt: new Date().toISOString()
    }

    setSectionHighlights(prev => ({
      ...prev,
      [sectionId]: [...(prev[sectionId] || []), tempHl]
    }))

    setHighlightPopup(null)
    setHighlightNote("")
    window.getSelection()?.removeAllRanges()
    toast.success(`"${selectedText.substring(0, 30)}..." işaretleniyor... 🖍️`)

    // 2. Arka planda DB'ye kaydet
    try {
      const res = await saveUserAnnotation({
        courseId: course.id,
        sectionId,
        text: selectedText,
        color,
        note: noteText
      })

      if (res.success && res.annotation) {
        // Geçici ID'yi gerçek DB ID'si ile değiştir
        setSectionHighlights(prev => {
          const sectionArray = prev[sectionId] || []
          return {
            ...prev,
            [sectionId]: sectionArray.map(h => h.id === tempId ? { ...h, id: res.annotation!.id } : h)
          }
        })
      } else {
        toast.error("İşaretleme kaydedilemedi: " + res.error)
        // Başarısız olursa geçici ekleneni sil
        setSectionHighlights(prev => {
          const sectionArray = prev[sectionId] || []
          return {
            ...prev,
            [sectionId]: sectionArray.filter(h => h.id !== tempId)
          }
        })
      }
    } catch (e) {
      console.error(e)
    }
  }, [highlightPopup, slug, highlightNote, course.id])

  // Highlights yükle (section expand olduğunda)
  const loadHighlights = useCallback(async (sectionId: string) => {
    const { getSectionAnnotations } = await import("@/lib/actions")
    const dbAnns = await getSectionAnnotations(sectionId)
    // DB modellerini UI modeline çevir
    const mappedHls: Highlight[] = dbAnns.map((a: any) => ({
      id: a.id,
      sectionId: a.sectionId,
      sectionTitle: "", // Not strictly needed here for UI render
      courseSlug: slug,
      selectedText: a.text,
      color: (a.color as Highlight["color"]) || "yellow",
      note: a.note || undefined,
      createdAt: a.createdAt.toISOString ? a.createdAt.toISOString() : a.createdAt
    }))
    setSectionHighlights(prev => ({ ...prev, [sectionId]: mappedHls }))
  }, [slug])

  // Popup kapat (dışarı tıklayınca)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (highlightPopup && !(e.target as HTMLElement)?.closest?.('.highlight-popup')) {
        setHighlightPopup(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [highlightPopup])

  async function exportAllNotesAsPdf() {
    setExporting(true)
    try {
      const noteSections = sections
        .filter((s: any) => s.notes && s.notes.length > 50 && !s.title.toLowerCase().includes("kaynakça") && !s.title.toLowerCase().includes("kaynaklar"))
        .sort((a: any, b: any) => a.pageStart - b.pageStart)

      if (noteSections.length === 0) {
        toast.error(getNoNotesToast(!!isProfessional))
        setExporting(false)
        return
      }

      // Markdown'u güzel HTML'e çevirme fonksiyonu
      function md2html(text: string): string {
        // 0. Yeni satırları (\r\n -> \n) normalize et. Bu sayede tablolar ve listeler asla bozulmaz.
        const normalizedText = (text || '').replace(/\r\n/g, '\n');

        // 1. Mermaid bloklarını korumaya al (Böylece cleanMarkdown veya \n -> <br/> değişimlerinden etkilenmez)
        const mermaidBlocks: string[] = [];
        let tempText = normalizedText.replace(/```mermaid\s*\n?([\s\S]*?)```/g, (match, code) => {
          mermaidBlocks.push(prepareMermaidForRender(code));
          return `%%DIAGRAM_BLOCK_${mermaidBlocks.length - 1}%%`;
        });

        // Teknik kelimeleri temizle (Mermaid, Mermaid.js vb. kullanıcı görmesin)
        tempText = tempText
          .replace(/mermaid\.js/gi, 'görsel akış şeması')
          .replace(/mermaid diyagramı/gi, 'akış şeması')
          .replace(/mermaid/gi, 'akış şeması')

        // 2. Kalan metni temizle ve HTML'e çevir
        let html = cleanMarkdown(tempText, true)
          // Normal Kod blokları
          .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="print-code" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:11px;overflow-x:auto;margin:10px 0;page-break-inside:avoid;break-inside:avoid;"><code>$2</code></pre>')
          // Tablolar
          .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, (match: string) => {
            const rows = match.trim().split('\n').filter((r: string) => !r.match(/^\|[-| :]+\|$/))
            const header = rows[0]
            const body = rows.slice(1)
            const thCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => 
              `<th style="padding:6px 10px;background:#1e3a5f;color:white;font-size:11px;font-weight:700;text-align:left;border:1px solid #cbd5e1;">${c.trim()}</th>`
            ).join('')
            const bodyRows = body.map((r: string, ri: number) => {
              const cells = r.split('|').filter((c: string) => c.trim()).map((c: string) =>
                `<td style="padding:5px 10px;font-size:11px;border:1px solid #e2e8f0;background:${ri % 2 === 0 ? '#ffffff' : '#f8fafc'};">${c.trim()}</td>`
              ).join('')
              return `<tr>${cells}</tr>`
            }).join('')
            return `<table class="print-table" style="width:100%;border-collapse:collapse;margin:12px 0;border-radius:8px;overflow:hidden;page-break-inside:avoid;break-inside:avoid;"><thead><tr>${thCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
          })
          // BAŞLIKLARI BÖLÜNMEZ BÖLÜM DIV'LERİ İLE SARMA (ORPHAN/WIDOW VE KOPUKLUK ENGELLEME)
          // Her ### ve ## başlığı gördüğümüzde önceki sarmalayıcıyı kapatıp yeni bir bölünmez div açıyoruz.
          .replace(/^### (.+)/gm, '</div><div class="print-section-block" style="page-break-inside: auto; break-inside: auto; margin-bottom: 16px;"><h3 style="font-size:15px;color:#1e3a5f;margin:18px 0 8px;font-weight:700;page-break-after:avoid;break-after:avoid;display:block;"><svg style="display:inline-block;vertical-align:middle;margin-right:6px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg><span style="vertical-align:middle;">$1</span></h3>')
          .replace(/^## (.+)/gm, '</div><div class="print-section-block" style="page-break-inside: auto; break-inside: auto; margin-bottom: 24px;"><h2 style="font-size:17px;color:#0f172a;margin:22px 0 10px;font-weight:800;border-bottom:2px solid #e2e8f0;padding-bottom:6px;page-break-after:avoid;break-after:avoid;display:block;"><svg style="display:inline-block;vertical-align:middle;margin-right:6px;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg><span style="vertical-align:middle;">$1</span></h2>')
          .replace(/^# (.+)/gm, '</div><div class="print-section-block" style="page-break-inside: auto; break-inside: auto; margin-bottom: 28px;"><h1 style="font-size:20px;color:#0f172a;margin:28px 0 12px;font-weight:800;page-break-after:avoid;break-after:avoid;display:block;">$1</h1>')
          .replace(/^#### (.+)/gm, '<h4 style="font-size:14px;color:#1e3a5f;margin:16px 0 6px;font-weight:700;page-break-after:avoid;break-after:avoid;display:block;">$1</h4>')
          // Yatay Çizgiler (---)
          .replace(/^---\s*$/gm, '<hr class="print-hr" style="border:0;border-top:1px solid #cbd5e1;margin:16px 0;page-break-inside:avoid;break-inside:avoid;"/>')
          // İnline stiller
          .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:12px;color:#be185d;">$1</code>')
          // Emoji rozet satırları
          .replace(/^((?:🔴|🟡|🟢|📌|⚡|🔑|💡|📊|⚠️|✅|❌|📝|🎯|📋).+)$/gm, '<div class="callout-block" style="background:#eff6ff;border-left:3px solid #3b82f6;padding:8px 12px;margin:8px 0;border-radius:0 6px 6px 0;font-size:13px;font-weight:600;color:#1e40af;page-break-inside:avoid;break-inside:avoid;">$1</div>')
          // Listeler
          .replace(/^(\d+)\.\s(.+)/gm, '<div style="display:flex;gap:8px;margin:4px 0 4px 12px;page-break-inside:avoid;break-inside:avoid;"><span style="color:#3b82f6;font-weight:700;min-width:20px;">$1.</span><span>$2</span></div>')
          .replace(/^[-•*]\s(.+)/gm, '<div style="display:flex;gap:6px;margin:3px 0 3px 16px;page-break-inside:avoid;break-inside:avoid;"><span style="color:#3b82f6;">▸</span><span style="flex:1;">$1</span></div>')
          // Paragraflar
          .replace(/\n\n/g, '<div style="height:10px;"></div>')
          .replace(/([^\n<>])\n([^\n<>])/g, '$1<br/>$2')

        // html'in en başına açılış div'ini koyuyoruz
        let wrappedHtml = '<div class="print-section-block" style="page-break-inside: auto; break-inside: auto; margin-bottom: 16px;">' + html + '</div>';

        // İlk baştaki gereksiz sarmalayıcıyı ve boş aç-kapa div'lerini temizle
        wrappedHtml = wrappedHtml
          .replace('<div class="print-section-block" style="page-break-inside: auto; break-inside: auto; margin-bottom: 16px;"></div>', '')
          .replace(/<div class="print-section-block"[^>]*><\/div>/g, '');


        // 3. Mermaid bloklarını geri yükle (Artık <br/> veya HTML karakterlerinden etkilenmeyecek)
        mermaidBlocks.forEach((code, index) => {
          wrappedHtml = wrappedHtml.replace(`%%DIAGRAM_BLOCK_${index}%%`, `<div class="mermaid-wrap" data-char-count="${code.length}">\n<div class="mermaid">\n${code}\n</div>\n</div>`);
        });

        // Başlıkların hemen ardındaki boşluk div'lerini temizle ki page-break-after: avoid kuralı kırılmasın
        wrappedHtml = wrappedHtml.replace(/(<\/h[1-4]>)\s*<div style="height:10px;"><\/div>/gi, '$1');

        return wrappedHtml;
      }

      // Notların HTML'ini hazırla
      const notesHtml = noteSections.map((s: any, i: number) => {
        const c = { border: '#3b82f6', bg: '#f8fafc', text: '#0f172a' }
        const noteContent = md2html(s.notes || '')

        return `
          <div class="section-block">
            <!-- Bölüm Başlığı -->
            <div style="background:linear-gradient(135deg, ${c.bg}, #ffffff);border-left:5px solid ${c.border};padding:16px 20px;border-radius:0 12px 12px 0;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06);page-break-after:avoid;break-after:avoid;">
              <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;">
                <span style="font-size:20px;font-weight:800;color:#0f172a;">${formatTitle(s.title, i, s.notes, s.module)}</span>
              </div>
            </div>
            <!-- İçerik -->
            <div style="font-size:13px;color:#1e293b;line-height:1.75;width:100%;display:block;">
              <div style="margin:6px 0;width:100%;">${noteContent}</div>
            </div>
          </div>`
      }).join('\n')

      // İçindekiler
      const tocHtml = noteSections.map((s: any, i: number) => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dotted #cbd5e1;">
          <span style="font-size:13px;color:#1e293b;"><strong style="color:#3b82f6;">${i + 1}.</strong> ${formatTitle(s.title, i, s.notes, s.module)}</span>
        </div>`
      }).join('')

      // Stats
      const totalChars = noteSections.reduce((sum: number, s: any) => sum + (s.notes?.length || 0), 0)

      // Blob URL ile açarak about:blank sorununu çöz
      const fullHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${course.name} - Ders Notları</title>
  <script src="/js/mermaid.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Inter', 'Segoe UI', -apple-system, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      background: white;
    }

    .cover {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      background: white;
      color: #0f172a;
      page-break-after: always;
      min-height: 85vh;
      border: 8px solid #f8fafc;
      border-radius: 20px;
      margin: 10px;
    }
    .cover-badge { font-size:14px; letter-spacing:4px; color:#3b82f6; margin-bottom:24px; font-weight:700; text-transform: uppercase; }
    .cover h1 { font-size:42px; font-weight:900; margin-bottom:16px; line-height:1.2; color:#0f172a; max-width: 80%; }
    .cover .subtitle { font-size:16px; color:#64748b; margin-bottom:50px; }
    .cover .stats-row { display:flex; gap:20px; justify-content:center; margin-bottom:50px; }
    .cover .stat-box { padding:12px 24px; border:1.5px solid #e2e8f0; border-radius:12px; background:#f8fafc; }
    .cover .stat-num { font-size:22px; font-weight:800; color:#3b82f6; }
    .cover .stat-label { font-size:11px; color:#64748b; margin-top:2px; }
    .cover .date { font-size:11px; color:#94a3b8; margin-top:40px; }

    .toc { padding:40px 50px; page-break-after:always; }
    .toc h2 { font-size:22px; color:#0f172a; border-bottom:3px solid #3b82f6; padding-bottom:10px; margin-bottom:20px; font-weight:800; }

    .content { padding: 0; margin: 0; }
    .section-block { 
      padding: 10px 0; 
      margin: 0; 
      page-break-before: always; 
      page-break-inside: auto; 
      display: flow-root; 
    }
    .section-block:first-of-type {
      page-break-before: avoid !important;
    }

    /* Professional Orphan & Widow protection for headings, paragraphs, and list items */
    h1, h2, h3, h4, h5, h6 {
      page-break-after: avoid !important;
      break-after: avoid !important;
      break-after: avoid-page !important;
    }
    
    p, div, li, span, tr {
      orphans: 3 !important;
      widows: 3 !important;
    }

    .print-table {
      width: auto !important;
      max-width: 100% !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      margin: 15px auto !important;
      border-collapse: collapse !important;
      font-size: 11px !important;
    }
    .print-table td, .print-table th {
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      max-width: 200px !important;
      padding: 5px 8px !important;
    }

    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }

    /* Elegant, ink-saving, beautifully scaled Mermaid diagrams in print & view */
    .mermaid-wrap {
      display: block !important;
      width: 100% !important;
      min-width: 200px !important;
      max-width: 650px !important;
      margin: 15px auto !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important; /* Modern standard */
      background: transparent !important;
    }
    /* Kutusuz/serbest kitap tasarımı: Çerçeve ve dolguları tamamen kaldırıyoruz */
    .mermaid-wrap .mermaid {
      display: block !important;
      width: 100% !important;
      margin: 0 auto !important;
      border: none !important;
      background: transparent !important;
      padding: 0 !important;
      border-radius: 0 !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .mermaid-wrap svg {
      display: block !important;
      margin: 0 auto !important;
      /* UI ile aynı mantık: viewBox korunarak kapsayıcıya sığdır */
      width: 100% !important;
      max-width: 650px !important;
      height: auto !important;
      overflow: visible !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .mermaid-wrap svg rect,
    .mermaid-wrap svg polygon,
    .mermaid-wrap svg circle,
    .mermaid-wrap svg ellipse,
    .mermaid-wrap svg path.node {
      fill: #f8fafc !important;
      stroke: #1e3a5f !important;
      stroke-width: 1.5px !important;
    }
    .mermaid-wrap svg .label,
    .mermaid-wrap svg text,
    .mermaid-wrap svg span {
      fill: #0f172a !important;
      color: #0f172a !important;
      font-family: 'Inter', sans-serif !important;
      font-weight: 500 !important;
    }
    .mermaid-wrap svg .edgePath .path,
    .mermaid-wrap svg .edgePath path,
    .mermaid-wrap svg path.link,
    .mermaid-wrap svg path.connection {
      stroke: #475569 !important;
      stroke-width: 1.5px !important;
    }
    .mermaid-wrap svg .markerPath,
    .mermaid-wrap svg marker path,
    .mermaid-wrap svg .arrowheadPath {
      fill: #475569 !important;
      stroke: #475569 !important;
    }
    .mermaid-wrap svg .edgeLabel rect {
      fill: #ffffff !important;
      opacity: 0.95 !important;
    }
    .mermaid-wrap svg .edgeLabel text {
      fill: #334155 !important;
      font-size: 11px !important;
      font-weight: 600 !important;
    }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; background: white; border-top: none; }
      .no-print { display: none !important; }
      @page { size: A4; margin: 18mm 15mm 15mm 15mm; }
      @page :first { margin: 0; }
      .cover { min-height: 100vh; border: none; border-left: 12px solid #3b82f6; margin: 0; border-radius: 0; }
      .mermaid-wrap .mermaid { border: none !important; background: transparent !important; padding: 0 !important; }
      .content { padding: 0 !important; margin: 0 !important; }
      .section-block { 
        padding: 0 0 10px 0 !important; 
        margin: 0 !important; 
        display: flow-root !important; 
        page-break-before: always !important;
        page-break-inside: auto !important;
      }
      .section-block:first-of-type {
        page-break-before: avoid !important;
      }
    }

    .print-bar {
      position: fixed; top:0; left:0; right:0;
      background: linear-gradient(135deg, #1e3a5f, #1e40af);
      padding: 12px 24px;
      display: flex; align-items: center; justify-content: space-between;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .print-bar span { color: white; font-size: 14px; font-weight: 600; }
    .print-btn {
      background: linear-gradient(to right, #3b82f6, #4f46e5); color: white; border: none;
      padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 700;
      cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }
    .print-btn:hover { transform: scale(1.02); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4); }
    body { padding-top: 56px; }
    @media print { body { padding-top: 0; } }
  </style>
</head>
<body>
  
  <div class="print-bar no-print">
    <span>${course.name} - Ders Notları</span>
    <button class="print-btn" onclick="window.print()">PDF Olarak Kaydet</button>
  </div>

  <div class="cover">
    <div class="cover-badge">DERS NOTLARI</div>
    <h1>${course.name}</h1>
    <p class="subtitle">${course.code || ''} · ${course.instructor || ''}</p>
  </div>

  <div class="toc">
    <h2>İÇİNDEKİLER</h2>
    ${tocHtml}
  </div>

  <div class="content">${notesHtml}</div>

  <div style="page-break-before:always;text-align:center;padding:80px 40px;">
    <div style="font-size:40px;margin-bottom:20px;"></div>
    <h2 style="font-size:24px;color:#0f172a;font-weight:800;">Başarılar!</h2>
    <div style="margin-top:40px;font-size:11px;color:#94a3b8;">Sınav Asistanım · ${new Date().getFullYear()}</div>
  </div>

  <script>
    // PDF formatı okuma/çıktı amaçlı olduğu için gizli cevapları (details) otomatik açıyoruz
    document.querySelectorAll('details').forEach(d => {
      d.setAttribute('open', 'true');
      const summary = d.querySelector('summary');
      if (summary) {
        summary.innerHTML = "<strong>Cevap:</strong>";
        summary.style.pointerEvents = "none";
        summary.style.color = "#1e40af";
        summary.style.marginTop = "10px";
      }
    });
  </script>
  <script>
    let mermaidRenderDone = false;

    async function initMermaid() {
      if (mermaidRenderDone) return;
      if (typeof mermaid === 'undefined') {
        setTimeout(initMermaid, 50);
        return;
      }

      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        flowchart: { htmlLabels: true, curve: 'basis' }
      });

      document.querySelectorAll('code.language-mermaid').forEach(el => {
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = el.textContent;
        el.parentNode.replaceWith(div);
      });

      const nodes = Array.from(document.querySelectorAll('.mermaid')).filter(
        (node) => !node.querySelector('svg')
      );

      if (nodes.length === 0) {
        if (document.querySelectorAll('.mermaid-wrap, .mermaid').length === 0) {
          mermaidRenderDone = true;
        }
        return;
      }

      try {
        await mermaid.run({
          nodes,
          suppressErrors: false
        });
        mermaidRenderDone = true;
      } catch (err) {
        console.error('Mermaid render failed:', err);
      }
    }

    initMermaid();
    document.addEventListener('DOMContentLoaded', initMermaid);
    window.addEventListener('load', initMermaid);
  </script>
</body>
</html>`

      // 3. İstemci tarafında HTML Blob oluştur ve yeni sekmede aç (Questions ve Flashcards sekmeleriyle aynı mantık)
      const blob = new Blob([fullHtml], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      
      // İndirmek yerine yeni sekmede aç (Tarayıcının kendi yazdır/PDF okuyucusu devreye girer)
      window.open(url, '_blank')
      
      // Bellek sızıntısını önlemek için URL'yi bir süre sonra temizle
      setTimeout(() => URL.revokeObjectURL(url), 15000)

      toast.success("PDF Şablonu Hazır! Lütfen açılan sekmeden yazdır/kaydet işlemini yapın.", { id: 'pdf-toast' })
    } catch (err: any) {
      console.error('[PDF]', err)
      toast.error("PDF oluşturulurken hata: " + err.message)
    }
    setExporting(false)
  }

  const noteSections = useMemo(() => {
    let contentCounter = 1;
    return sections
      .filter((s: any) => !s.title.toLowerCase().includes("kaynakça") && !s.title.toLowerCase().includes("kaynaklar"))
      .map((s: any, i: number) => {
        const rawTitle = formatTitle(s.title, i, s.notes, s.module);
        const isIntro = /kısaltmalar|tanımlar|önsöz|giriş/i.test(rawTitle);
        const displayTitle = isIntro ? rawTitle : `${contentCounter++}. ${rawTitle}`;
        return { ...s, displayTitle, rawTitle };
      });
  }, [sections]);
  const groupedSections = useMemo(() => {
    const groups: { [key: string]: any[] } = {}
    noteSections.forEach((section) => {
      let mod = section.module || "Genel"
      
      // Eğer modül adı ile başlık neredeyse aynıysa (sayılar hariç), bu sahte bir modüldür (iç içe görünümü engelle)
      if (section.rawTitle) {
        const modLower = mod.toLowerCase().replace(/^\d+[\.\-\)]\s*/, '').trim();
        const titleLower = section.rawTitle.toLowerCase().replace(/^\d+[\.\-\)]\s*/, '').trim();
        
        if (modLower === titleLower || modLower.includes(titleLower) || titleLower.includes(modLower)) {
          mod = "Ders İçeriği";
        }
      }

      if (!groups[mod]) groups[mod] = []
      groups[mod].push(section)
    })
    return groups
  }, [noteSections])
  if (sections.length === 0) {
    return (
      <EmptyState
        tabId="notes"
        title="İçerik Hazırlanıyor"
        description={getMaterialsPreparingDescription(!!isProfessional)}
      />
    )
  }

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
      loadHighlights(id)
    }
    setExpandedIds(next)
  }

  const handleBookmark = (e: React.MouseEvent, sectionId: string, sectionTitle: string) => {
    e.stopPropagation()
    if (currentBookmark?.sectionId === sectionId) {
      removeBookmark(slug)
      setCurrentBookmark(null)
      toast.success("Yer imi kaldırıldı")
    } else {
      setBookmark({ sectionId, sectionTitle, courseSlug: slug, scrollPosition: 0 })
      setCurrentBookmark({ sectionId })
      toast.success(`📌 "${sectionTitle.substring(0, 40)}" — burada kaldın!`)
    }
  }

  return (
    <section className="space-y-6" aria-label="Ders notları">
      {/* Header Stats + PDF Export */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {currentBookmark && (
            <button
              onClick={() => {
                const el = document.getElementById(`section-card-${currentBookmark.sectionId}`);
                if (el) {
                  if (!expandedIds.has(currentBookmark.sectionId)) {
                    toggleExpand(currentBookmark.sectionId);
                  }
                  setTimeout(() => {
                    const scrollParent = el.closest('.overflow-y-auto') as HTMLElement;
                    if (scrollParent) {
                      const parentRect = scrollParent.getBoundingClientRect();
                      const elRect = el.getBoundingClientRect();
                      const relativeTop = elRect.top - parentRect.top;
                      scrollParent.scrollTo({ top: scrollParent.scrollTop + relativeTop - 20, behavior: 'smooth' });
                    } else {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    el.classList.add("ring-2", "ring-sky-500", "shadow-[0_0_20px_rgba(14,165,233,0.3)]", "transition-all", "duration-500")
                    setTimeout(() => {
                      el.classList.remove("ring-2", "ring-sky-500", "shadow-[0_0_20px_rgba(14,165,233,0.3)]")
                    }, 1500)
                  }, 150);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 text-xs font-bold transition-all border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
              aria-label="Kaldığım Yere Git"
            >
              <Bookmark className="w-3.5 h-3.5 fill-current" />
              Kaldığım Yere Git
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {/* Boyadığım Yerler Dropdown */}
          {courseHighlights.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowHighlightsMenu(!showHighlightsMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 text-xs font-bold transition-all border border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)]"
              >
                <Highlighter className="w-3.5 h-3.5 fill-current" />
                Boyadığım Yerler ({courseHighlights.length})
              </button>
              
              <AnimatePresence>
                {showHighlightsMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-80 bg-[#060912]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="p-3 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Palette className="w-4 h-4 text-yellow-400" /> Önemli Notlarım
                      </h4>
                      <button onClick={() => setShowHighlightsMenu(false)} className="p-1 hover:bg-white/10 rounded-lg text-slate-400 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 p-2 space-y-2">
                      {courseHighlights.map(hl => (
                        <button
                          key={hl.id}
                          onClick={() => {
                            setShowHighlightsMenu(false);
                            setScrollKeyword(hl.selectedText);
                            if (!expandedIds.has(hl.sectionId)) {
                              toggleExpand(hl.sectionId);
                            }
                          }}
                          className="w-full text-left p-3 rounded-xl hover:bg-white/[0.04] transition-all border border-transparent hover:border-white/[0.06] flex flex-col gap-1"
                        >
                          <span className="text-[10px] font-bold text-slate-500 line-clamp-1">{hl.sectionTitle}</span>
                          <span className={`text-xs leading-relaxed line-clamp-3 p-1.5 rounded-md ${getColorClass(hl.color)}`}>
                            {hl.selectedText}
                          </span>
                          {hl.note && (
                            <span className="text-[10px] text-slate-300 italic px-1">📝 {hl.note}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <button
            onClick={() => setIsFocusMode(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-bold border border-slate-700 hover:border-slate-600 shadow-lg shadow-black/20 transition-all"
            aria-label="Odak Modu"
          >
            <Maximize className="w-4 h-4 text-amber-400" /> Odak Modu
          </button>

          <button
            onClick={exportAllNotesAsPdf}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 transition-all disabled:opacity-50"
          aria-label="Tüm Notları PDF İndir"
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              PDF Oluşturuluyor...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" /> Tüm Notları PDF İndir
            </>
          )}
        </button>
      </div>
      </div>

      {/* Notes List (Flat - V1 Style) */}
      <div className="space-y-4">
      {noteSections.map((section: any, i: number) => {
        const isExpanded = expandedIds.has(section.id)

        return (
          <article id={`section-card-${section.id}`} key={section.id} className="rounded-2xl border border-white/[0.08]" role="article" aria-label={section.displayTitle}>
            {/* Section Header */}
            <div
              onClick={() => toggleExpand(section.id)}
              className={`p-5 cursor-pointer hover:bg-white/[0.02] transition-colors bg-white/[0.02] rounded-t-2xl ${isExpanded ? "" : "rounded-b-2xl"}`}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-controls={`notes-content-${section.id}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(section.id) } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <BookOpen className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-lg">{section.displayTitle}</h3>
                      {section.module && (section.module === "Modül 1" || section.module === "Modül 2") && (
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                          section.module === "Modül 1" 
                            ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" 
                            : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                        }`}>
                          <BookOpen className="w-3 h-3" /> {section.module}
                        </span>
                      )}
                      {isAdmin && (() => {
                        const issues = parseQualityIssues(section.verificationIssues)
                        const attempt = issues.currentAttempt || (issues.attemptHistory?.length ? issues.attemptHistory.length : 1)
                        // LIVE POLLING OVERRIDE: Eğer `processingStatus` üzerinden gelen güncel bir microPhase varsa (ve bölüm uyuyorsa), onu kullan!
                        const liveMicroPhase = (processingStatus?.processingSection?.id === section.id || processingStatus?.processingSection?.order === section.order) 
                          ? processingStatus.processingSection.microPhase 
                          : null;
                        const currentMicroPhase = (liveMicroPhase || issues.currentMicroPhase) ?? null
                        const stages = deriveQualityStages(issues, section.verificationScore ?? -1, section.processed)
                        const badge = getQualityBadgeState(section.verificationScore, section.processed, stages, currentMicroPhase)

                        const showScore = section.verificationScore != null && section.notes
                        const showAttempt = showScore || (!section.processed && attempt > 0)

                        if (!showScore && !currentMicroPhase) return null

                        return (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Single Section Fallback Warning Badge */}
                            {issues.singleSectionFallback && (
                              <span 
                                title={`Başarısız kaynaklar: ${Array.isArray(issues.failedSources) ? issues.failedSources.join(", ") : ""}`}
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase bg-orange-500/10 text-orange-500 border border-orange-500/20 flex items-center gap-1"
                              >
                                <AlertCircle className="w-2.5 h-2.5" /> Bölümleme Başarısız (Tek Bölüm)
                              </span>
                            )}

                            {/* Deneme Badge */}
                            {showAttempt && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase bg-amber-500/10 text-amber-500/90 border border-amber-500/20">
                                Kalite Kontrol: Deneme #{attempt}
                              </span>
                            )}
                            
                            {/* Score Badge */}
                            {showScore && (
                              <span 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveScoreSection(section);
                                }}
                                title={badge.hint || undefined}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer hover:scale-105 active:scale-95 transition-all flex items-center gap-1 ${badge.badgeClass}`}
                              >
                                <ShieldCheck className="w-3 h-3" /> {badge.scoreLabel}
                                {badge.hint && !currentMicroPhase && (
                                  <span className="text-[8px] opacity-80 ml-0.5 hidden sm:inline">· {badge.hint}</span>
                                )}
                              </span>
                            )}

                            {/* Live Status Badge */}
                            {!section.processed && currentMicroPhase && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide text-blue-400 bg-blue-500/10 border border-blue-500/20 flex items-center gap-1.5 ml-1">
                                <RefreshCw className="w-3 h-3 animate-spin" /> {currentMicroPhase}
                              </span>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    {isAdmin && (
                      <span className="text-[10px] text-slate-500 bg-slate-800/50 px-2 py-0.5 rounded-full mt-1 inline-block">
                        <span className="flex items-center gap-1"><FileText className="w-3 h-3 inline-block" /> PDF Sayfa {section.pageStart}-{section.pageEnd}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip content={currentBookmark?.sectionId === section.id ? "Yer imini kaldır" : "Burada kaldım 📌"}>
                    <button
                      onClick={(e) => handleBookmark(e, section.id, section.displayTitle)}
                      className={`p-1.5 rounded-lg transition-all ${
                        currentBookmark?.sectionId === section.id
                          ? "bg-amber-500/20 text-amber-400 shadow-lg shadow-amber-500/10"
                          : "hover:bg-white/5 text-slate-500 hover:text-amber-400"
                      }`}
                      aria-label="Yer imi"
                    >
                      {currentBookmark?.sectionId === section.id 
                        ? <BookmarkCheck className="w-4 h-4" />
                        : <Bookmark className="w-4 h-4" />
                      }
                    </button>
                  </Tooltip>
                  <ChevronRight className={`w-5 h-5 text-slate-500 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                </div>
              </div>
            </div>

            {/* Content Body */}
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                id={`notes-content-${section.id}`}
                className="border-t border-white/[0.08] p-5 lg:p-8 bg-slate-900/50 rounded-b-2xl"
                onMouseUp={() => handleTextSelect(section.id, section.displayTitle)}
              >
                {/* Removed AI Warning Banner */}
                
                {/* Active Highlights (Inline view) */}
                {sectionHighlights[section.id]?.length > 0 && (
                  <div className="mb-6 border-b border-white/[0.08] pb-6">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Palette className="w-4 h-4 text-yellow-400" /> Vurguladığım Notlar
                    </h4>
                    <div className="space-y-2">
                      {sectionHighlights[section.id].map(hl => (
                        <span 
                          key={hl.id} 
                          onClick={() => setScrollKeyword(hl.selectedText)}
                          className={`inline-block mr-2 mb-2 px-3 py-1.5 rounded-lg text-xs leading-relaxed border border-transparent hover:border-white/[0.08] cursor-pointer transition-colors ${getColorClass(hl.color)}`}
                          title={hl.note ? `Not: ${hl.note}` : "Tıkla ve metinde bul"}
                        >
                          {hl.selectedText}
                          {hl.note && <span className="ml-2 text-[10px] opacity-70">📝 {hl.note}</span>}
                          
                          {/* Sil Butonu */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              // Optimistic UI
                              setSectionHighlights(prev => ({
                                ...prev,
                                [section.id]: prev[section.id].filter(h => h.id !== hl.id)
                              }))
                              removeHighlight(hl.id)
                              toast.success("İşaret kaldırıldı")
                            }}
                            className="ml-2 hover:text-red-400"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-sm text-slate-300 leading-relaxed markdown-notes">
                  {section.notes ? (
                    <>
                    <PremiumMarkdownRenderer 
                      content={cleanMarkdown(section.notes, true)}
                      renderTooltips={section.title.toUpperCase().includes("KISALTMALAR") ? undefined : renderTooltips}
                      autoScrollKeyword={scrollKeyword}
                    />
                    </>
                  ) : (
                    <EmptyState
                      icon={BookOpen}
                      title="İçerik Hazırlanıyor"
                      description={getMaterialsPreparingDescription(!!isProfessional)}
                    />
                  )}
                </div>
              </motion.div>
            )}
          </article>
        )
      })}
      </div>
      
      {/* Highlight renk seçici popup */}
      {highlightPopup && (
        <div
          className="highlight-popup fixed z-50 flex flex-col gap-2 p-3 rounded-xl bg-slate-800 border border-white/10 shadow-2xl shadow-black/40 min-w-[240px]"
          style={{
            left: `${Math.min(highlightPopup.x, window.innerWidth - 240)}px`,
            top: `${highlightPopup.y + 10}px`,
          }}
        >
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-slate-300">Özet Panosuna İğnele</span>
            <textarea 
              value={highlightNote}
              onChange={(e) => setHighlightNote(e.target.value)}
              placeholder="Bu kısım için bir not düş (isteğe bağlı)..."
              className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-white/5">
            <span className="text-[10px] text-slate-400">Kategori seçerek kaydet:</span>
            <div className="flex items-center gap-1">
              {(["yellow", "green", "red", "blue"] as const).map(color => (
                <Tooltip key={color} content={color === "yellow" ? "Kritik Kavram" : color === "green" ? "Sınavda Çıkabilir" : color === "red" ? "Önemli Uyarı" : "Hatırlatma"}>
                  <button
                    onClick={() => doHighlight(color)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-125 ${
                      color === "yellow" ? "bg-yellow-400 border-yellow-500" :
                      color === "green" ? "bg-emerald-400 border-emerald-500" :
                      color === "red" ? "bg-red-400 border-red-500" :
                      "bg-blue-400 border-blue-500"
                    }`}
                  />
                </Tooltip>
              ))}
            </div>
          </div>
          <button 
            onClick={() => { setHighlightPopup(null); setHighlightNote(""); }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center border border-white/10"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Puan, Kontrolör ve Müfettiş Detay Modalı (Admin Görünümü) */}
      {mounted && createPortal(
        <AnimatePresence>
          {isAdmin && activeScoreSection && (
            (() => {
              let issues: any = {};
              try { issues = JSON.parse(activeScoreSection.verificationIssues || "{}"); } catch(e) {}
              const needsAction = issues.needsUserAction === true;
              
              return (
                <SectionQualityModal
                  section={activeScoreSection}
                  onClose={() => setActiveScoreSection(null)}
                  actions={needsAction ? (
                    <div className="flex flex-col gap-3 w-full">
                      <div className="w-full text-center sm:hidden mb-2">
                        <span className="text-red-400 font-bold text-[11px] tracking-widest uppercase bg-red-500/10 px-3 py-1.5 rounded-full border border-red-500/20">
                          ⚠️ 5 DENEME SONUCUNDA %100 PUANA ULAŞILAMADI
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3 w-full">
                        <button
                          disabled={isApproving}
                          onClick={async () => {
                            setIsApproving(true);
                            try {
                              const res = await fetch("/api/courses/resolve-action", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ sectionId: activeScoreSection.id, action: "accept" }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                toast.success("Mevcut skor kabul edildi ve devam ediliyor!");
                                setActiveScoreSection(null);
                                onReloadCourse?.();
                              } else {
                                toast.error(data.error || "Bilinmeyen hata");
                              }
                            } catch (err: any) {
                              toast.error("Hata: " + err.message);
                            } finally {
                              setIsApproving(false);
                            }
                          }}
                          className={`flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold transition-all text-center text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950/30 ${
                            isApproving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" /> En İyi Skoru Kabul Et
                        </button>

                        <button
                          disabled={isApproving}
                          onClick={async () => {
                            setIsApproving(true);
                            try {
                              const res = await fetch("/api/courses/resolve-action", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ sectionId: activeScoreSection.id, action: "restart" }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                toast.success("Bölüm başarıyla sıfırlandı ve baştan başlatılıyor!");
                                setActiveScoreSection(null);
                                onReloadCourse?.();
                              } else {
                                toast.error(data.error || "Bilinmeyen hata");
                              }
                            } catch (err: any) {
                              toast.error("Hata: " + err.message);
                            } finally {
                              setIsApproving(false);
                            }
                          }}
                          className={`flex-1 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold transition-all text-center text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-rose-950/30 ${
                            isApproving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                          }`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Süreci Baştan Başlat
                        </button>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row gap-3 w-full mt-2 pt-2 border-t border-white/10">
                        <button
                          disabled={isApproving}
                          onClick={async () => {
                            setIsApproving(true);
                            try {
                              const res = await fetch("/api/courses/sections/rollback", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ sectionId: activeScoreSection.id, targetPhase: "mufettis" }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                toast.success("Notlar korundu! Süreç Müfettiş'e çekildi.");
                                setActiveScoreSection(null);
                                onReloadCourse?.();
                              } else {
                                toast.error(data.error || "Bilinmeyen hata");
                              }
                            } catch (err: any) {
                              toast.error("Hata: " + err.message);
                            } finally {
                              setIsApproving(false);
                            }
                          }}
                          className={`flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-bold transition-all text-center text-[11px] flex items-center justify-center gap-1.5 shadow-lg shadow-amber-950/30 ${
                            isApproving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                          }`}
                        >
                          ⏪ Sadece Müfettiş'e Geri Çek (Notları Koru)
                        </button>

                        <button
                          disabled={isApproving}
                          onClick={async () => {
                            setIsApproving(true);
                            try {
                              const res = await fetch("/api/courses/sections/rollback", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ sectionId: activeScoreSection.id, targetPhase: "flashcards" }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                toast.success("Müfettiş onayı korundu! Soru/Kart aşamasına çekildi.");
                                setActiveScoreSection(null);
                                onReloadCourse?.();
                              } else {
                                toast.error(data.error || "Bilinmeyen hata");
                              }
                            } catch (err: any) {
                              toast.error("Hata: " + err.message);
                            } finally {
                              setIsApproving(false);
                            }
                          }}
                          className={`flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-bold transition-all text-center text-[11px] flex items-center justify-center gap-1.5 shadow-lg shadow-purple-950/30 ${
                            isApproving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                          }`}
                        >
                          ⏪ Soru/Kartları Baştan Üret
                        </button>
                      </div>
                    </div>
                  ) : null}
                />
              );
            })()
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Odak Modu (Zen Mode) Overlay */}
      {mounted && createPortal(
        <AnimatePresence>
          {isFocusMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="fixed inset-0 z-[99999] bg-[#020617] overflow-y-auto custom-scrollbar"
            >
              <div className="sticky top-0 left-0 right-0 z-50 bg-[#020617]/80 backdrop-blur-xl border-b border-white/10 px-6 py-4 flex justify-between items-center shadow-2xl">
                <div className="flex items-center gap-3 text-slate-300">
                  <BookOpen className="w-5 h-5 text-indigo-400" />
                  <h2 className="font-bold text-lg hidden sm:block text-slate-200">Odak Modu</h2>
                  <span className="text-sm font-medium px-3 py-1 bg-white/[0.03] rounded-md text-slate-400 border border-white/[0.05]">
                    {course.name}
                  </span>
                </div>
                <button
                  onClick={() => setIsFocusMode(false)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-white/[0.05] hover:border-red-500/20 transition-all font-bold text-sm shadow-sm"
                >
                  <Minimize className="w-4 h-4" /> Çıkış (ESC)
                </button>
              </div>
              
              <div className="max-w-[800px] mx-auto px-6 py-16 pb-32">
                {noteSections.map((section: any, i: number) => (
                  <div key={section.id} className="mb-24">
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-8 border-b border-white/10 pb-6 leading-tight tracking-tight">
                      {section.displayTitle}
                    </h1>
                    <div className="text-lg sm:text-[21px] text-slate-300 leading-[1.85] tracking-normal font-sans font-medium markdown-notes focus-mode">
                      {section.notes ? (
                        <PremiumMarkdownRenderer 
                          content={cleanMarkdown(section.notes, true)}
                          renderTooltips={section.title.toUpperCase().includes("KISALTMALAR") ? undefined : renderTooltips}
                        />
                      ) : (
                        <p className="text-slate-500 italic">Notlar hazırlanıyor...</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <style jsx global>{`
        .focus-mode p {
          margin-bottom: 2em;
          color: #cbd5e1; /* slate-300 */
        }
        .focus-mode h2 {
          font-size: 1.75rem;
          margin-top: 2.5em;
          margin-bottom: 1em;
          color: #f8fafc;
          font-weight: 800;
        }
        .focus-mode h3 {
          font-size: 1.35rem;
          margin-top: 2em;
          margin-bottom: 1em;
          color: #e2e8f0;
          font-weight: 700;
        }
        .focus-mode li {
          margin-bottom: 0.75em;
        }
        .focus-mode table {
          font-family: 'Inter', sans-serif;
          font-size: 0.9em;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </section>
  )
}


