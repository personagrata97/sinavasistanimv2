"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Brain, ChevronRight, RotateCcw, RefreshCw, CheckCircle2, X, Zap, Flame, BookOpen, Loader2, Download, Sparkles } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { EmptyState, LoadingSkeleton, ConfettiEffect, formatTitle, SplitNotesLayout, CustomSelect } from "./shared"
import { getMaterialsPreparingDescription, getDefaultNoteTitle } from "@/lib/program-catalog"
import rehypeRaw from "rehype-raw"

// Flashcard cevaplarındaki iç içe (nested) madde işaretlerini düzleştirip okunabilir kılar.
// AI bazen alt alt listeler üretir — bu fonksiyon onları tek seviye düz listeye çevirir.
function flattenNestedMarkdown(text: string): string {
  if (!text) return text;
  return text
    // 4+ boşluk girintili alt maddeleri tek seviyeye çek
    .replace(/^\s{4,}[-•*]\s/gm, '- ')
    // 2-3 boşluk girintili alt maddeleri de tek seviyeye çek
    .replace(/^\s{2,3}[-•*]\s/gm, '- ')
    // Tab girintili alt maddeleri de düzelt
    .replace(/^\t+[-•*]\s/gm, '- ')
    // Çift boşluklu numaralı alt listeleri de düzelt
    .replace(/^\s{2,}(\d+)\.\s/gm, '$1. ')
    // Ardışık boş satırları tek satıra düşür
    .replace(/\n{3,}/g, '\n\n');
}




export default
function FlashcardsTab({ slug, courseName, isProfessional }: { slug: string, courseName: string, isProfessional?: boolean }) {
  const [cards, setCards] = useState<any[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewMode, setReviewMode] = useState(false) // true = sadece tekrar zamanı gelen kartlar
  const [topicFilter, setTopicFilter] = useState<string>("all")
  const [exporting, setExporting] = useState(false)
  const [generatingMore, setGeneratingMore] = useState(false)
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [autoScrollKeyword, setAutoScrollKeyword] = useState("")

  useEffect(() => {
    async function load() {
      const { getCourseFlashcards } = await import("@/lib/actions")
      const data = await getCourseFlashcards(slug)
      setCards(data)
      setLoading(false)
    }
    load()
  }, [slug])

  const exportFlashcardsAsPdf = () => {
    setExporting(true)
    try {
      // Basit Markdown→HTML dönüşümü (flashcard cevaplarındaki bold, liste, emoji düzgün görünsün)
      function mdToHtml(text: string): string {
        return (text || '')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:11px;color:#be185d;">$1</code>')
          .replace(/^[-•]\s(.+)/gm, '<div style="display:flex;gap:4px;margin:2px 0 2px 8px;"><span style="color:#3b82f6;">▸</span><span>$1</span></div>')
          .replace(/^(\d+)\.\s(.+)/gm, '<div style="display:flex;gap:4px;margin:2px 0 2px 8px;"><span style="color:#3b82f6;font-weight:700;">$1.</span><span>$2</span></div>')
          .replace(/\n\n/g, '<div style="height:6px;"></div>')
          .replace(/\n/g, '<br/>')
      }

      const rowsHtml = topicFilteredCards.map((c, i) => `
        <tr style="break-inside: avoid; page-break-inside: avoid;">
          <td class="td-front">${mdToHtml(c.front)}</td>
          <td class="td-back">${mdToHtml(flattenNestedMarkdown(c.back))}</td>
        </tr>
      `).join('')

      const fullHtml = `
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Flashcards (Çalışma Kartları)</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
          body { font-family: 'Inter', sans-serif; color: #0f172a; padding: 40px; max-width: 800px; margin: 0 auto; background: #f8fafc; padding-top: 56px; }
          .print-bar { position: fixed; top:0; left:0; right:0; background: linear-gradient(135deg, #1e3a5f, #1e40af); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
          .print-bar span { color: white; font-size: 14px; font-weight: 600; }
          .print-btn { background: linear-gradient(to right, #3b82f6, #4f46e5); color: white; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
          .print-btn:hover { transform: scale(1.02); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4); }
          .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 85vh; page-break-after: always; text-align: center; border-left: 12px solid #3b82f6; }
          .cover-badge { font-size:12px; letter-spacing:4px; color:#3b82f6; margin-bottom:16px; font-weight:700; text-transform: uppercase; }
          .cover h1 { font-size:36px; margin-bottom:12px; color: #0f172a; font-weight: 900; max-width: 80%; }
          .cover p { color:#64748b; font-size:14px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; font-size:12px; background: white; }
          th { background:#f1f5f9; padding:10px 12px; text-align:left; color:#475569; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; border-bottom: 2px solid #e2e8f0; }
          td { padding:10px 12px; border-bottom:1px solid #e2e8f0; line-height: 1.6; word-break: break-word; overflow-wrap: break-word; }
          tr:last-child td { border-bottom: none; }
          tr:nth-child(even) td { background: #f8fafc; }
          .td-front { font-weight: 700; color: #0f172a; width: 35%; border-right: 1px dashed #cbd5e1; }
          .td-back { color: #334155; }
          @media print {
            body { padding: 0; background: white; max-width: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .no-print, .print-bar { display: none !important; }
            @page { size: A4; margin: 18mm 15mm 15mm 15mm; }
            @page :first { margin: 0; }
            .cover { min-height: 100vh; border: none; border-left: 12px solid #3b82f6; margin: 0; border-radius: 0; }
          }
        </style>
      </head>
      <body>
        <div class="print-bar no-print">
          <span>${courseName} - Hızlı Çalışma Kartları</span>
          <button class="print-btn" onclick="window.print()">PDF Olarak Kaydet</button>
        </div>
        <div class="cover">
          <div class="cover-badge">Hızlı Çalışma Kartları</div>
          <h1>${courseName}</h1>
          <p>${topicFilteredCards.length} Kart • ${topicFilter !== 'all' ? topicFilter : 'Tüm Konular'}</p>
        </div>
        <table>
        <thead>
          <tr>
            <th>Soru / Kavram</th>
            <th>Cevap / Tanım</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      </body>
      </html>`

      const blob = new Blob([fullHtml], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err: any) {
      console.error(err)
    }
    setExporting(false)
  }

  async function handleReview(quality: number) {
    const card = displayCards[currentIndex]
    const { reviewFlashcard } = await import("@/lib/actions")
    await reviewFlashcard(card.id, quality)

    // Kartı güncelle
    const { getCourseFlashcards } = await import("@/lib/actions")
    const updated = await getCourseFlashcards(slug)
    setCards(updated)
    setFlipped(false)
    setShowNotesModal(false)

    // Sonraki karta geç
    const nextCards = reviewMode
      ? updated.filter((c: any) => new Date(c.nextReview) <= new Date())
      : updated
    if (currentIndex >= nextCards.length - 1) {
      setCurrentIndex(0)
    } else {
      setCurrentIndex(currentIndex + 1)
    }
  }

  if (loading) return <LoadingSkeleton />

  if (cards.length === 0) {
    return (
      <EmptyState
        tabId="flashcards"
        title="İçerik Hazırlanıyor"
        description={getMaterialsPreparingDescription(!!isProfessional)}
      />
    )
  }

  const now = new Date()
  const dueCards = cards.filter(c => new Date(c.nextReview) <= now)
  const masteredCards = cards.filter(c => c.mastered)
  
  const topicFilteredCards = topicFilter === "all" ? cards : cards.filter(c => {
    const cTopic = (!c.section || !c.section.title) ? "Genel Konular" : formatTitle(c.section.title, undefined, c.section.notes, c.section.module)
    return cTopic === topicFilter
  })
  
  const displayCards = reviewMode ? topicFilteredCards.filter(c => new Date(c.nextReview) <= now) : topicFilteredCards

  const allTopics = Array.from(new Set(
    cards.map(c => {
      if (!c.section || !c.section.title) return "Genel Konular"
      return formatTitle(c.section.title, undefined, c.section.notes, c.section.module)
    }).filter(Boolean)
  )).sort()

  if (displayCards.length === 0 && reviewMode) {
    const nextDueCard = cards
      .filter(c => new Date(c.nextReview) > now)
      .sort((a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime())[0]
    
    const nextReviewText = nextDueCard 
      ? `Bir sonraki tekrar: ${new Date(nextDueCard.nextReview).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
      : (topicFilter !== "all" ? "Bu konuda tüm kartlar öğrenildi!" : "Tüm kartlar öğrenildi!")

    return (
      <EmptyState
        icon={CheckCircle2}
        title="Tebrikler! Bugünlük tekrar bitti."
        description={`${masteredCards.length}/${cards.length} kart öğrenildi. ⏰ ${nextReviewText}`}
        action={
          <button onClick={() => setReviewMode(false)} className="px-6 py-2.5 rounded-xl bg-white/5 text-white font-bold hover:bg-white/10 transition-colors">
            Tüm Kartları Gör
          </button>
        }
      />
    )
  }

  const safeIndex = Math.min(currentIndex, displayCards.length - 1)
  const card = displayCards[safeIndex]

  return (
    <SplitNotesLayout
      isOpen={showNotesModal}
      onClose={() => { setShowNotesModal(false); setAutoScrollKeyword(""); }}
      title={card?.section?.title ? formatTitle(card.section.title, undefined, card.section.notes, card.section.module, isProfessional) : getDefaultNoteTitle(isProfessional)}
      notes={card?.section?.notes || ""}
      autoScrollKeyword={autoScrollKeyword}
    >
      <div className="max-w-3xl mx-auto space-y-6" role="region" aria-label="Flashcard çalışma kartları">
        {/* Stats Bar (Synced with Questions UI) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center">
          <div className="text-lg font-bold text-white">{cards.length}</div>
          <div className="text-[10px] text-slate-500 uppercase font-bold">Toplam</div>
        </div>
        <div className="p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-center">
          <div className="text-lg font-bold text-emerald-400">{masteredCards.length}</div>
          <div className="text-[10px] text-emerald-500/60 uppercase font-bold">Öğrenilen</div>
        </div>
        <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/10 text-center">
          <div className="text-lg font-bold text-amber-400">{dueCards.length}</div>
          <div className="text-[10px] text-amber-500/60 uppercase font-bold">Tekrar Bekleyen</div>
        </div>
        <button 
          aria-label={reviewMode ? "Tekrar modunu kapat" : "Tekrar modunu aç"}
          onClick={() => { setReviewMode(!reviewMode); setCurrentIndex(0); setFlipped(false) }}
          className={`p-3 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 ${
            reviewMode ? "bg-blue-500/20 border-blue-500/30 text-blue-400" : "bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.06]"
          }`}
        >
          <Zap className={`w-4 h-4 ${reviewMode ? "animate-pulse" : ""}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Tekrar Modu</span>
        </button>
      </div>

      {/* Topic Filter */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <CustomSelect
            label="Konu:"
            value={topicFilter}
            onChange={(val) => { setTopicFilter(val); setCurrentIndex(0); setFlipped(false) }}
            options={[
              { label: "Tümü", value: "all" },
              ...allTopics.map(t => ({ label: t || '', value: t || '' }))
            ]}
          />
        </div>
        <button
          onClick={exportFlashcardsAsPdf}
          disabled={exporting}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 transition-all disabled:opacity-50 whitespace-nowrap"
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              PDF Oluşturuluyor...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 inline-block" /> Kartları PDF İndir
            </>
          )}
        </button>
        <button
          onClick={async () => {
            setGeneratingMore(true)
            try {
              const { generateMoreContentAction, getCourseFlashcards } = await import("@/lib/actions")
              const result = await generateMoreContentAction(slug, "FLASHCARDS", undefined, 20)
              if (result.success) {
                toast.success(result.message)
                const fresh = await getCourseFlashcards(slug)
                setCards(fresh)
              } else {
                toast.error(result.message)
              }
            } catch (err: any) {
              toast.error("Kart üretme hatası: " + err.message)
            } finally {
              setGeneratingMore(false)
            }
          }}
          disabled={generatingMore}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/30 transition-all disabled:opacity-50 whitespace-nowrap"
        >
          {generatingMore ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Üretiliyor...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 inline-block" /> Kart Çoğalt
            </>
          )}
        </button>
      </div>

      <div className="max-w-lg mx-auto">

      {/* Progress */}
      <div className="flex items-center justify-between mb-6">
        <span className="text-sm text-slate-400">{safeIndex + 1} / {displayCards.length}</span>
        <div className="w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${((safeIndex + 1) / displayCards.length) * 100}%` }} />
        </div>
      </div>

      {/* Card */}
      <div
        onClick={() => setFlipped(!flipped)}
        className="relative w-full min-h-64 max-h-96 rounded-2xl cursor-pointer perspective-1000"
      >
        <div className={`absolute inset-0 p-6 rounded-2xl border transition-all duration-500 flex items-start justify-center overflow-y-auto ${
          flipped ? "bg-emerald-500/5 border-emerald-500/20" : "bg-blue-500/5 border-blue-500/20"
        }`}>
          <div className="w-full">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 text-center">
              {flipped ? "CEVAP" : "SORU"}
            </div>
            <div className={`font-medium leading-relaxed text-left space-y-4 ${flipped ? "text-sm" : "text-lg text-center"}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {flattenNestedMarkdown((flipped ? card.back : card.front).replace(/\[KAYNAK BAŞLIĞI:.*?\]/gi, '').replace(/💡/g, '\n\n💡').replace(/🪤/g, '\n\n🪤'))}
              </ReactMarkdown>
              {(flipped ? card.back_en : card.front_en) && (
                <div className="mt-3 pt-3 border-t border-blue-500/20 text-sm text-slate-400 italic">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-blue-400/80 mb-1">English</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {(flipped ? card.back_en : card.front_en) || ""}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            {flipped && (
              <div className="mt-8 pt-4 border-t border-emerald-500/20 flex justify-center">
                <button 
                  onClick={(e) => {
                    e.stopPropagation(); // prevent flipping the card back
                    if (card.section?.notes) {
                        // Ön yüz (soru) ve arka yüzü (cevap) birlikte gönderiyoruz.
                        // Yeni "Strong Tag Bonus" algoritması sayesinde uzun arka yüz metinleri alakasız eşleşmelere yol açmayacak,
                        // tam tersine cevaptaki anahtar kelimenin (Örn: Bütünlük) metindeki kalın harfli (Strong) tanımını bulmasını sağlayacak.
                        const semanticTarget = card.front + " " + card.back;
                        setAutoScrollKeyword(semanticTarget);
                        setShowNotesModal(true);
                    }
                  }}
                  disabled={!card.section?.notes}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-bold shadow-sm transition-all ${!card.section?.notes ? "opacity-50 cursor-not-allowed bg-emerald-500/5 border-emerald-500/10 text-emerald-500/50" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400/90 hover:bg-emerald-500/20 hover:scale-105"}`}
                >
                  <BookOpen className="w-3 h-3" />
                  <span>İlgili Konu: {(!card.section || !card.section.title) ? "Genel Konular" : formatTitle(card.section.title, undefined, card.section.notes, card.section.module)}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Buttons */}
      {!flipped ? (
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => { setCurrentIndex(Math.max(0, safeIndex - 1)); setFlipped(false); setShowNotesModal(false); }}
            disabled={safeIndex === 0}
            className="flex-1 py-3 rounded-xl bg-white/5 text-slate-400 font-bold hover:bg-white/10 transition-colors disabled:opacity-30"
          >
            ← Önceki
          </button>
          <button
            onClick={() => setFlipped(true)}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-colors"
          >
            Cevabı Gör
          </button>
          <button
            onClick={() => { setCurrentIndex(Math.min(displayCards.length - 1, safeIndex + 1)); setFlipped(false); setShowNotesModal(false); }}
            disabled={safeIndex === displayCards.length - 1}
            className="flex-1 py-3 rounded-xl bg-white/5 text-slate-400 font-bold hover:bg-white/10 transition-colors disabled:opacity-30"
          >
            Sonraki →
          </button>
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-xs text-center text-slate-500 mb-3">Bu kartı ne kadar iyi biliyorsun?</p>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={() => handleReview(0)} className="py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-colors">
              Bilmiyorum
            </button>
            <button onClick={() => handleReview(2)} className="py-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold hover:bg-orange-500/20 transition-colors">
              Zor
            </button>
            <button onClick={() => handleReview(3)} className="py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 transition-colors">
              Bildim
            </button>
            <button onClick={() => handleReview(4)} className="py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-colors">
              Kolay
            </button>
          </div>
        </div>
      )}
      </div>
      </div>
    </SplitNotesLayout>
  )
}


