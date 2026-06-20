"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { HelpCircle, CheckCircle2, XCircle, ChevronRight, AlertTriangle, Flag, Lightbulb, RefreshCw, Brain, CheckCircle, Target, Zap, Loader2, Download, Sparkles, Star, BookOpen, AlertCircle } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import { toast } from "sonner"
import { EmptyState, LoadingSkeleton, Badge, ConfettiEffect, formatTitle, Modal, cleanExplanationText, formatQuestionText, SplitNotesLayout, CustomSelect } from "./shared"
import { getMaterialsPreparingDescription, getDefaultNoteTitle } from "@/lib/program-catalog"
import { Tooltip } from "@/components/ui/shared"

export default
function QuestionsTab({ slug, courseName, isProfessional }: { slug: string, courseName: string, isProfessional?: boolean }) {
  const [questions, setQuestions] = useState<any[]>([])
  const [currentQ, setCurrentQ] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [score, setScore] = useState({ correct: 0, wrong: 0 })
  const [topicFilter, setTopicFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all") 
  const [completed, setCompleted] = useState(false)
  const [flagged, setFlagged] = useState<Set<string>>(new Set())
  const [quickReview, setQuickReview] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [generatingMore, setGeneratingMore] = useState(false)
  const [difficultyFilter, setDifficultyFilter] = useState("all")
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [autoScrollKeyword, setAutoScrollKeyword] = useState("")

  // REPORT MODAL STATES
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportReason, setReportReason] = useState("Yanlış Şık")
  const [reportComment, setReportComment] = useState("")
  const [isReporting, setIsReporting] = useState(false)

  useEffect(() => {
    async function load() {
      const { getCourseQuestions } = await import("@/lib/actions")
      const data = await getCourseQuestions(slug)
      const shuffled = data.sort(() => Math.random() - 0.5)
      setQuestions(shuffled)
      setLoading(false)
    }
    load()
  }, [slug])

  const exportQuestionsAsPdf = () => {
    setExporting(true)
    try {
      // Basit Markdown→HTML dönüşümü
      function mdInline(text: string): string {
        return (text || '')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:10px;color:#be185d;">$1</code>')
      }

      const qHtml = filteredQuestions.map((q, i) => `
        <div class="question-block" style="break-inside: avoid; page-break-inside: avoid;">
          <h3>${i + 1}. ${mdInline(q.text)}</h3>
          <div class="options-container">
            ${q.options.map((opt: string, oi: number) => `
              <div class="option">
                <strong>${String.fromCharCode(65 + oi)})</strong> ${mdInline(opt)}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')

      const aHtml = filteredQuestions.map((q, i) => {
        // Markdown explanation'ı HTML'e çevir
        let expHtml = (q.explanation || "Açıklama yok")
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n\n/g, '</p><p style="margin:4pt 0;">')
          .replace(/\n/g, '<br/>')
          .replace(/✅/g, '<span style="color:#16a34a;font-weight:700;">✅</span>')
          .replace(/❌/g, '<span style="color:#dc2626;font-weight:700;">❌</span>')
          .replace(/💡/g, '<span style="color:#ca8a04;font-weight:700;">💡</span>')
          .replace(/⛔/g, '<span style="color:#dc2626;font-weight:700;">⛔</span>')
        
        return `
        <div class="answer-block" style="break-inside: avoid; page-break-inside: avoid;">
          <h4>Soru ${i + 1} - Cevap: ${q.correct}</h4>
          <div style="font-size:10pt; color:#15803d; line-height:1.5;"><p style="margin:4pt 0;">${expHtml}</p></div>
        </div>
      `}).join('')

      const fullHtml = `
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Soru Bankası Test Kitapçığı</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
          body { font-family: 'Inter', sans-serif; color: #0f172a; padding: 40px; max-width: 800px; margin: 0 auto; background: #f8fafc; }
          .page-container { background: white; padding: 50px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border-top: 6px solid #3b82f6; }
          .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 85vh; page-break-after: always; text-align: center; border-left: 12px solid #3b82f6; }
          .cover-badge { font-size:12px; letter-spacing:4px; color:#3b82f6; margin-bottom:16px; font-weight:700; text-transform: uppercase; }
          .cover h1 { font-size:36px; margin-bottom:12px; color: #0f172a; font-weight: 900; max-width: 80%; }
          .cover p { color:#64748b; font-size:14px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
          .questions { padding: 20px; }
          .question-block { break-inside: avoid; page-break-inside: avoid; margin-bottom: 12pt; padding: 10pt; border: 1pt solid #e2e8f0; border-radius: 6pt; background: white; }
          .question-block h3 { font-size:12pt; margin-bottom:8pt; font-weight:700; color: #1e293b; line-height: 1.4; }
          .options-container { margin-left: 4pt; }
          .option { break-inside: avoid; page-break-inside: avoid; margin-bottom:4pt; font-size:11pt; padding: 4pt 8pt; border-radius: 4pt; background: #f8fafc; border: 1pt solid #e2e8f0; color: #334155; word-break: break-word; overflow-wrap: break-word; }
          .option strong { color: #3b82f6; margin-right: 4pt; font-size: 11pt; }
          .answers-section { page-break-before: always; padding-top: 15pt; }
          .answers-title { text-align:center; font-size:16pt; margin-bottom:15pt; padding-bottom:10pt; border-bottom:1pt solid #e2e8f0; font-weight: 800; }
          .answer-block { break-inside: avoid; page-break-inside: avoid; margin-bottom: 10pt; padding:10pt 12pt; background:#f0fdf4; border-radius:6pt; border:1pt solid #bbf7d0; }
          .answer-block h4 { font-size:12pt; margin-bottom:6pt; color:#166534; font-weight: 700; }
          .answer-block p { font-size:11pt; color:#15803d; line-height:1.5; }
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
          @media print {
            body { padding: 0; background: white; max-width: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .no-print { display: none !important; }
            @page { size: A4; margin: 18mm 15mm 15mm 15mm; }
            @page :first { margin: 0; }
            .cover { min-height: 100vh; border: none; border-left: 12px solid #3b82f6; margin: 0; border-radius: 0; }
            .page-container { padding: 0 !important; border: none !important; box-shadow: none !important; background: transparent !important; border-radius: 0 !important; }
            .questions, .answers-section { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="print-bar no-print">
          <span>${courseName} - Soru Bankası</span>
          <button class="print-btn" onclick="window.print()">PDF Olarak Kaydet</button>
        </div>
        <div class="page-container">
          <div class="cover">
            <div class="cover-badge">Soru Bankası Test Kitapçığı</div>
            <h1>${courseName}</h1>
            <p>${filteredQuestions.length} Soru • ${topicFilter !== 'all' ? topicFilter : 'Tüm Konular'}</p>
          </div>
          <div class="questions">
            ${qHtml}
          </div>
          <div class="answers-section">
            <h2 class="answers-title">Cevap Anahtarı ve Açıklamalar</h2>
            ${aHtml}
          </div>
        </div>
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

  const allTopics = Array.from(new Set(
    questions.map(q => {
      if (!q.section || !q.section.title) return "Genel Konular"
      return formatTitle(q.section.title, undefined, q.section.notes, q.section.module)
    }).filter(Boolean)
  )).sort()

  function flagToggle(id: string) {
    setFlagged(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredQuestions = questions.filter(q => {
    if (quickReview) {
      const isFlagged = flagged.has(q.id)
      const isWrong = q.answered && !q.isCorrect
      return isFlagged || isWrong
    }
    if (topicFilter !== "all") {
      const qTopic = (!q.section || !q.section.title) ? "Genel Konular" : formatTitle(q.section.title, undefined, q.section.notes, q.section.module)
      if (qTopic !== topicFilter) return false
    }
    if (statusFilter === "unsolved") {
      return !q.answered
    }
    if (statusFilter === "wrong") {
      return q.answered && !q.isCorrect
    }
    if (statusFilter === "flagged") {
      return flagged.has(q.id)
    }
    if (difficultyFilter !== "all") {
      if (q.difficulty !== difficultyFilter) return false
    }
    return true
  })

  const q = filteredQuestions[currentQ]

  useEffect(() => {
    if (q) {
      if (q.answered) {
        setSelectedAnswer(q.userAnswer)
        setShowResult(true)
        setResult({
          correct: q.isCorrect,
          correctAnswer: q.correct,
          explanation: q.explanation
        })
      } else {
        setSelectedAnswer(null)
        setShowResult(false)
        setResult(null)
      }
    }
  }, [q?.id])

  async function handleAnswer(answer: string) {
    if (showResult) return
    setSelectedAnswer(answer)
    const { answerQuestion } = await import("@/lib/actions")
    const res = await answerQuestion(q.id, answer)
    if (res.error) {
      toast.error("Cevap kaydedilemedi: " + res.error)
      setSelectedAnswer(null)
      return
    }
    setResult(res)
    setShowResult(true)
    setScore(prev => ({
      correct: prev.correct + (res.correct ? 1 : 0),
      wrong: prev.wrong + (res.correct ? 0 : 1),
    }))
  }

  function nextQuestion() {
    if (currentQ >= filteredQuestions.length - 1) {
      setCompleted(true)
      return
    }
    setCurrentQ(prev => prev + 1)
    setSelectedAnswer(null)
    setShowResult(false)
    setResult(null)
    setShowNotesModal(false)
  }

  function resetQuiz() {
    setCurrentQ(0)
    setSelectedAnswer(null)
    setShowResult(false)
    setResult(null)
    setScore({ correct: 0, wrong: 0 })
    setCompleted(false)
    setQuestions(prev => [...prev].sort(() => Math.random() - 0.5))
  }

  if (loading) return <LoadingSkeleton />

  if (questions.length === 0) {
    return (
      <EmptyState
        tabId="questions"
        title="İçerik Hazırlanıyor"
        description={getMaterialsPreparingDescription(!!isProfessional)}
      />
    )
  }

  if (completed) {
    return (
      <div className="max-w-2xl mx-auto text-center p-12 rounded-3xl bg-white/[0.03] border border-white/[0.06] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-emerald-500 to-sky-500" />
        <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/30">
          <CheckCircle className="w-10 h-10 text-emerald-400" />
        </div>
        <h2 className="text-3xl font-bold mb-2">Tur Tamamlandı!</h2>
        <p className="text-slate-400 mb-8">Bu turdaki soruları başarıyla gözden geçirdin.</p>
        
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-2xl font-bold text-emerald-400">{score.correct}</div>
            <div className="text-xs text-emerald-500/70 font-bold uppercase tracking-wider">Doğru</div>
          </div>
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
            <div className="text-2xl font-bold text-red-400">{score.wrong}</div>
            <div className="text-xs text-red-500/70 font-bold uppercase tracking-wider">Yanlış</div>
          </div>
        </div>

        <button onClick={resetQuiz} className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg">
          Yeni Tur Başlat
        </button>
      </div>
    )
  }

  if (filteredQuestions.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="Soru Bulunamadı"
        description="Seçtiğiniz filtrelere uygun soru bulunmuyor veya içerik hazırlık süreci devam ediyor. Tüm soruları görmek için filtreleri temizleyebilirsiniz."
        action={
          <button 
            onClick={() => { setTopicFilter("all"); setStatusFilter("all"); setQuickReview(false); }}
            className="px-6 py-2.5 rounded-xl bg-blue-600/10 text-blue-400 font-bold hover:bg-blue-600/20 transition-colors"
          >
            Filtreleri Temizle
          </button>
        }
      />
    )
  }

  const answeredCount = questions.filter(q => q.answered).length
  const wrongCount = questions.filter(q => q.answered && !q.isCorrect).length

  return (
    <SplitNotesLayout
      isOpen={showNotesModal}
      onClose={() => { setShowNotesModal(false); setAutoScrollKeyword(""); }}
      title={q?.section?.title ? formatTitle(q.section.title, undefined, q.section.notes, q.section.module, isProfessional) : getDefaultNoteTitle(isProfessional)}
      notes={q?.section?.notes || ""}
      autoScrollKeyword={autoScrollKeyword}
    >
      <section className="max-w-3xl mx-auto space-y-6" aria-label="Soru bankası">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center">
            <div className="text-lg font-bold text-white">{questions.length}</div>
            <div className="text-[10px] text-slate-500 uppercase font-bold">Toplam</div>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-center">
          <div className="text-lg font-bold text-emerald-400">{answeredCount}</div>
          <div className="text-[10px] text-emerald-500/60 uppercase font-bold">Çözülen</div>
        </div>
        <div className="p-3 rounded-2xl bg-red-500/5 border border-red-500/10 text-center">
          <div className="text-lg font-bold text-red-400">{wrongCount}</div>
          <div className="text-[10px] text-red-500/60 uppercase font-bold">Yanlış</div>
        </div>
        <button 
          onClick={() => { setQuickReview(!quickReview); setCurrentQ(0); }}
          className={`p-3 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1 ${
            quickReview ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.06]"
          }`}
        >
          <Zap className={`w-4 h-4 ${quickReview ? "animate-pulse" : ""}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Hızlı Tekrar</span>
        </button>
      </div>

      {!quickReview && (
        <div className="space-y-3">
          {/* Filtreler — flashcard ile aynı tasarım */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <CustomSelect
                label="Konu:"
                value={topicFilter}
                onChange={(val) => { setTopicFilter(val); setCurrentQ(0); }}
                options={[
                  { label: "Tümü", value: "all" },
                  ...allTopics.map(t => ({ label: t, value: t }))
                ]}
              />
            </div>
            <div className="flex-1">
              <CustomSelect
                label="Durum:"
                value={statusFilter}
                onChange={(val) => { setStatusFilter(val); setCurrentQ(0); }}
                options={[
                  { label: "Tümü", value: "all" },
                  { label: "Çözülmemiş", value: "unsolved" },
                  { label: "Yanlışlarım", value: "wrong" },
                  { label: "Yıldızladıklarım", value: "flagged" }
                ]}
              />
            </div>
            <div className="flex-1">
              <CustomSelect
                label="Zorluk:"
                value={difficultyFilter}
                onChange={(val) => { setDifficultyFilter(val); setCurrentQ(0); }}
                options={[
                  { label: "Hepsi", value: "all" },
                  { label: "Kolay", value: "easy" },
                  { label: "Orta", value: "medium" },
                  { label: "Zor", value: "hard" }
                ]}
              />
            </div>
          </div>
          {/* Butonlar — ayrı satır */}
          <div className="flex gap-3">
            <button
              onClick={exportQuestionsAsPdf}
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
                  <Download className="w-4 h-4 inline-block" /> Soruları PDF İndir
                </>
              )}
            </button>
            <button
              onClick={async () => {
                setGeneratingMore(true)
                try {
                  const { generateMoreContentAction } = await import("@/lib/actions")
                  const result = await generateMoreContentAction(slug, "QUESTIONS", undefined, 20)
                  if (result.success) {
                    toast.success(result.message)
                    const { getCourseQuestions } = await import("@/lib/actions")
                    const fresh = await getCourseQuestions(slug)
                    setQuestions(fresh)
                  } else {
                    toast.error(result.message)
                  }
                } catch (err: any) {
                  toast.error("Soru üretme hatası: " + err.message)
                }
                setGeneratingMore(false)
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
                  <Sparkles className="w-4 h-4 inline-block" /> Soru Çoğalt
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/[0.05] relative shadow-xl">
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-3xl overflow-hidden">
          <div className="absolute top-0 left-0 h-1 bg-blue-500/20 w-full" role="progressbar" aria-valuenow={currentQ + 1} aria-valuemin={1} aria-valuemax={filteredQuestions.length} aria-label={`Soru ${currentQ + 1} / ${filteredQuestions.length}`}>
            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${((currentQ + 1) / filteredQuestions.length) * 100}%` }} />
          </div>
        </div>
        <div className="flex justify-between items-start mb-6">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-white/5 px-2 py-1 rounded">Soru {currentQ + 1} / {filteredQuestions.length}</span>
          <Tooltip content={flagged.has(q.id) ? "Soruyu kayıtlardan çıkar" : "Soruyu kaydet / favorilere ekle"}>
            <button onClick={() => flagToggle(q.id)} className={`p-2 rounded-lg transition-all ${flagged.has(q.id) ? "text-amber-400 bg-amber-500/10" : "text-slate-600 hover:bg-white/5"}`}>
              <Star className={`w-5 h-5 ${flagged.has(q.id) ? "fill-amber-400" : ""}`} />
            </button>
          </Tooltip>
        </div>
        <div className="text-lg font-medium leading-relaxed mb-6 text-slate-100">{formatQuestionText(q.text)}</div>
        {q.text_en && (
          <div className="mb-6 p-4 rounded-xl bg-blue-500/5 border border-blue-500/15 text-sm text-slate-400 italic">
            <div className="text-[9px] font-bold uppercase tracking-widest text-blue-400/80 mb-2">English</div>
            {formatQuestionText(q.text_en)}
          </div>
        )}
        <div className="space-y-3">
          {q.options.slice(0, 5).map((opt: string, i: number) => {
            const letter = String.fromCharCode(65 + i)
            const isSelected = selectedAnswer === letter
            const isCorrect = showResult && result?.correctAnswer === letter
            const isWrong = showResult && isSelected && !result?.correct
            let colorClass = isCorrect ? "border-emerald-500 bg-emerald-500/10 text-emerald-400" : isWrong ? "border-red-500 bg-red-500/10 text-red-400" : isSelected ? "border-blue-500 bg-blue-500/10" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
            if (showResult && !isCorrect && !isWrong) colorClass += " opacity-40"
            const cleanOpt = opt.replace(/^[A-J][).]\s*/, '')
            const enOptions: string[] | null = (() => {
              if (!q.options_en) return null
              if (Array.isArray(q.options_en)) return q.options_en
              try { return JSON.parse(q.options_en) } catch { return null }
            })()
            const enOpt = enOptions?.[i]?.replace(/^[A-J][).]\s*/, '') || null
            return (
              <button key={i} disabled={showResult} onClick={() => handleAnswer(letter)} className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${colorClass}`}>
                <span className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${isSelected ? "bg-blue-500 text-white" : "bg-white/5 text-slate-500"}`}>{letter}</span>
                <span className="text-sm font-medium flex flex-col gap-0.5">
                  <span>{cleanOpt}</span>
                  {enOpt && <span className="text-xs text-slate-500 italic">{enOpt}</span>}
                </span>
              </button>
            )
          })}
        </div>
        <AnimatePresence>
          {showResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-8 pt-8 border-t border-white/5">
              <div className="flex items-center gap-3 mb-4">
                {result?.correct ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    <CheckCircle className="w-5 h-5" /> Doğru!
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 font-bold border border-red-500/20">
                    <XCircle className="w-5 h-5" /> Yanlış. Doğru Cevap: {result?.correctAnswer}
                  </div>
                )}
              </div>
              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 leading-relaxed text-slate-300 text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanExplanationText(result?.explanation || q.explanation || "Açıklama yüklenemedi.")}</ReactMarkdown>
                
                {/* Kaynak (İlgili Konu) Badge */}
                <div className="mt-6 pt-4 border-t border-white/5 flex justify-end">
                  <button 
                    onClick={() => {
                      if (q.section?.notes) {
                         let targetText = q.text;
                         if (result?.correctAnswer) {
                            const optionIndex = result.correctAnswer.charCodeAt(0) - 65;
                            if (q.options[optionIndex]) {
                               targetText = q.text + " " + q.options[optionIndex];
                            }
                         }
                         setAutoScrollKeyword(targetText);
                         setShowNotesModal(true);
                      }
                    }}
                    disabled={!q.section?.notes}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-bold shadow-sm transition-all ${!q.section?.notes ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:scale-105 hover:shadow-md"} ${result?.correct ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400/90 hover:bg-emerald-500/20" : "bg-red-500/10 border-red-500/20 text-red-400/90 hover:bg-red-500/20"}`}
                  >
                    <BookOpen className="w-3 h-3 opacity-80" />
                    <span>📖 İlgili Konu: {q.section?.title ? formatTitle(q.section.title, undefined, q.section.notes, q.section.module) : (q.text.match(/^\[([^\]]+)\]/)?.[1]?.trim() || "Genel Konular")}</span>
                  </button>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={nextQuestion} className="flex-1 py-4 rounded-2xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-all shadow-xl shadow-blue-600/20">Sonraki Soru</button>
                <Tooltip content={flagged.has(q.id) ? "Bu soru bildirildi" : "Bu soruyu hatalı olarak bildir"}>
                  <button
                    onClick={() => setShowReportModal(true)}
                    disabled={flagged.has(q.id)}
                    className={`px-4 py-4 rounded-2xl font-bold text-xs transition-all ${
                      flagged.has(q.id)
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-default"
                        : "bg-white/[0.03] hover:bg-red-500/10 text-slate-500 hover:text-red-400 border border-white/[0.06] hover:border-red-500/20"
                    }`}
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* REPORT MODAL */}
      <AnimatePresence>
        {showReportModal && (
          <Modal onClose={() => !isReporting && setShowReportModal(false)}>
            <div className="p-2">
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                <AlertCircle className="w-6 h-6 text-red-500" />
                Hatalı Soru Bildirimi
              </h3>
              <p className="text-sm text-slate-400 mb-6">
                Yapay zeka başmüfettişi itirazını hemen inceleyip haklıysan soruyu otonom olarak düzeltecektir.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Hata Nedeni</label>
                  <div className="mt-2">
                    <CustomSelect
                      value={reportReason}
                      onChange={(val) => setReportReason(val)}
                      options={[
                        { label: "Yanlış Şık Verilmiş", value: "Yanlış Şık" },
                        { label: "Bilgi Hatası / Yanlış Süre vb.", value: "Bilgi Hatası" },
                        { label: "Müfredat Dışı / Kapsam Dışı", value: "Müfredat Dışı" },
                        { label: "Soru Kökü Anlaşılmaz", value: "Anlaşılmaz Dil" }
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Detaylı İtirazın (Zorunlu Değil)</label>
                  <textarea 
                    value={reportComment}
                    onChange={e => setReportComment(e.target.value)}
                    placeholder="Örn: 10 iş günü olması gerekirken şıklara 15 gün konulmuş..."
                    className="w-full bg-[#0a0f1c] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 min-h-[100px]"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button 
                  onClick={() => setShowReportModal(false)}
                  disabled={isReporting}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-slate-300 font-bold hover:bg-white/10 transition-all disabled:opacity-50"
                >
                  İptal
                </button>
                <button 
                  onClick={async () => {
                    setIsReporting(true)
                    try {
                      const res = await fetch("/api/questions/flag", {
                        method: "POST",
                        body: JSON.stringify({
                          questionId: q.id,
                          reportReason,
                          reportComment
                        })
                      })
                      const data = await res.json()
                      
                      setFlagged(prev => new Set([...prev, q.id]))
                      setShowReportModal(false)
                      
                      if (data.status === "auto_fixed") {
                        toast.success("Tebrikler, Haklısın! Soru otonom olarak düzeltildi.")
                      } else {
                        toast.error("İtiraz Reddedildi: " + data.message)
                      }
                    } catch (error) {
                      toast.error("Bir hata oluştu")
                    } finally {
                      setIsReporting(false)
                    }
                  }}
                  disabled={isReporting}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isReporting ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white/20 border-t-white rounded-full" />
                  ) : (
                    <Flag className="w-4 h-4" />
                  )}
                  Müfettişe İlet
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* COMPLETION SCREEN OVERLAY */}
      <AnimatePresence>
        {completed && (
          <Modal 
            onClose={() => setCompleted(false)}
            showClose={false}
          >
            {/* 🎊 Confetti Animasyonu */}
            {score.correct > score.wrong && (
              <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden">
                {Array.from({ length: 50 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ 
                      x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 800), 
                      y: -20, 
                      rotate: 0,
                      scale: Math.random() * 0.5 + 0.5
                    }}
                    animate={{ 
                      y: (typeof window !== 'undefined' ? window.innerHeight : 800) + 20, 
                      rotate: Math.random() * 720 - 360,
                      x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 800)
                    }}
                    transition={{ 
                      duration: Math.random() * 2 + 2, 
                      delay: Math.random() * 1.5,
                      ease: "easeOut"
                    }}
                    className="absolute w-3 h-3 rounded-sm"
                    style={{ 
                      backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'][i % 7],
                      width: Math.random() * 8 + 4,
                      height: Math.random() * 8 + 4
                    }}
                  />
                ))}
              </div>
            )}
            
            <div className="text-center">
              <div className="text-5xl mb-4">{score.correct > score.wrong ? "🎉" : "💪"}</div>
              <h2 className="text-2xl font-bold mb-1 text-white">Tur Tamamlandı!</h2>
              <p className="text-sm text-slate-400 mb-2">
                {filteredQuestions.length} soruyu başarıyla inceledin.
              </p>
              {(() => {
                const pct = Math.round((score.correct / (score.correct + score.wrong)) * 100)
                return (
                  <div className={`text-lg font-bold mb-4 ${
                    pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {pct >= 80 ? "🏆 Mükemmel!" : pct >= 60 ? "👍 İyi Gidiyorsun" : "📚 Biraz Daha Çalışmalısın"} — %{pct} Başarı
                  </div>
                )
              })()}
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-2xl font-bold text-emerald-400">{score.correct}</div>
                  <div className="text-[10px] text-emerald-500/50 uppercase font-bold tracking-wider">Doğru</div>
                </div>
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="text-2xl font-bold text-red-400">{score.wrong}</div>
                  <div className="text-[10px] text-red-500/50 uppercase font-bold tracking-wider">Yanlış</div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={resetQuiz}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold transition-all shadow-md shadow-blue-950/50"
                >
                  Yeni Tur Başlat
                </button>
                <button
                  onClick={() => setCompleted(false)}
                  className="w-full py-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 font-bold transition-all border border-white/5"
                >
                  Sonuçları İncele
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
      </section>
    </SplitNotesLayout>
  )
}


