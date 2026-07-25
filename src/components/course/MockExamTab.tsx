"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import {
  Rocket, Clock, ClipboardList, ClipboardSignature, Target, CheckCircle, XCircle,
  BarChart2, AlertTriangle, Lightbulb, RotateCcw, BookOpen, Brain, ArrowRight,
  RefreshCw, Timer, TrendingUp, Lock, ShieldCheck
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import dynamic from "next/dynamic"
import { EmptyState, LoadingSkeleton, cleanExplanationText, formatMockExamQuestionText } from "./shared"
import { getMaterialsPreparingDescription } from "@/lib/program-catalog"
import { Tooltip } from "@/components/ui/shared"
import { toast } from "sonner"
import {
  getExamConfig,
  getCourseMockExamParams,
  estimateScaledScore,
  getScaledScoreRange,
} from "@/lib/course-data"

const ProgressChart = dynamic(() => import("@/components/ProgressChart"), { ssr: false })

type ExamState = "setup" | "running" | "results"

export default function MockExamTab({ slug, programSlug, courseName, pastExamResults, onReloadCourse, processingStatus, isProfessional }: { slug: string, programSlug: string, courseName?: string, pastExamResults?: any[], onReloadCourse?: () => void, processingStatus?: any, isProfessional?: boolean }) {
  const [examState, setExamState] = useState<ExamState>("setup")
  const [questions, setQuestions] = useState<any[]>([])
  const [allQuestions, setAllQuestions] = useState<any[]>([])
  const [currentQ, setCurrentQ] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const [isRemediation, setIsRemediation] = useState(false)
  const [initialTime, setInitialTime] = useState(0)
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState<any>(null)
  const [flagged, setFlagged] = useState<Set<number>>(new Set())
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const examConfig = getExamConfig(programSlug)
  const courseParams = getCourseMockExamParams(programSlug, slug)
  const QUESTION_COUNT = courseParams?.questionCount ?? 25
  const EXAM_DURATION_MINUTES = courseParams?.durationMinutes ?? 45
  const PASSING_SCORE = courseParams?.passingScore ?? 60
  const MODULE_BARRIER = courseParams?.moduleBarrier ?? 50
  const SCORE_DISPLAY_MODE = courseParams?.scoreDisplayMode ?? "percent"
  const MIN_QUESTION_POOL = courseParams?.minQuestionPool ?? 5
  const usesModuleBarrier = MODULE_BARRIER > 0 && SCORE_DISPLAY_MODE === "percent"
  const scaledRange = examConfig ? getScaledScoreRange(examConfig) : null

  const programRulesLabel = (() => {
    switch (programSlug) {
      case "masak": return "MASAK"
      case "cisa": return "CISA (ISACA)"
      case "cia": return "CIA (IIA)"
      case "smmm": return "SMMM (TÜRMOB/TESMER)"
      case "spl-bagimsiz-denetim": return "BSBD (SPL)"
      default: return "SPL"
    }
  })()

  useEffect(() => {
    async function load() {
      const { getCourseQuestions } = await import("@/lib/actions")
      const data = await getCourseQuestions(slug)
      setAllQuestions(data)
      setLoading(false)
    }
    load()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [slug])

  async function startExam(moduleName?: string) {
    if (moduleName) {
      // Modül seçildiyse eski sistem (şimdilik)
      let pool = [...allQuestions]
      pool = pool.filter(q => q.module === moduleName || q.section?.module === moduleName)
      if (pool.length === 0) {
        toast.error("Seçilen modüle ait henüz üretilmiş soru bulunamadı.")
        return
      }
      if (programSlug === "masak" && pool.length < QUESTION_COUNT) {
        toast.error(`Modül denemesi için en az ${QUESTION_COUNT} soru gerekir. Şu an ${pool.length} soru var.`)
        return
      }
      const shuffled = pool.sort(() => Math.random() - 0.5)
      setQuestions(shuffled.slice(0, Math.min(QUESTION_COUNT, shuffled.length)))
    } else {
      // Blueprint API'sini çağır (Yeni Mimari)
      try {
        setLoading(true)
        const res = await fetch(`/api/courses/${slug}/mock-exam`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        if (data.questions.length === 0) throw new Error("Soru bulunamadı")
        setQuestions(data.questions)
        if (onReloadCourse) {
          onReloadCourse()
        }
      } catch (e: any) {
        toast.error(e.message || "Sınav oluşturulamadı.")
        setLoading(false)
        return
      } finally {
        setLoading(false)
      }
    }

    setCurrentQ(0)
    setAnswers({})
    const duration = EXAM_DURATION_MINUTES * 60
    setTimeLeft(duration)
    setInitialTime(duration)
    setIsRemediation(false)
    setExamState("running")
    setResults(null)

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // SÜRE BİTİMİ DENETİMİ (React Closure tuzağını önlemek için)
  useEffect(() => {
    if (examState === "running" && timeLeft === 0) {
      toast.warning("Süre doldu! Sınav otomatik sonlandırıldı.")
      finishExam()
    }
  }, [timeLeft, examState]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectAnswer(qIndex: number, answer: string) {
    setAnswers(prev => ({ ...prev, [qIndex]: answer }))
  }

  function startRemediationExam() {
    if (!results?.wrongQuestions || results.wrongQuestions.length === 0) return;
    setQuestions(results.wrongQuestions)
    setCurrentQ(0)
    setAnswers({})
    const duration = results.wrongQuestions.length * 2 * 60
    setTimeLeft(duration)
    setInitialTime(duration)
    setIsRemediation(true)
    setExamState("running")
    setResults(null)
    
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function finishExam() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    let correct = 0
    let wrong = 0
    let empty = 0
    const wrongTopics: Record<string, number> = {}
    const wrongQuestions: any[] = []

    const moduleStats: Record<string, { correct: number; total: number }> = {}

    questions.forEach((q, i) => {
      const userAnswer = answers[i]
      const moduleName = q.module || q.section?.module || "Genel"

      if (!moduleStats[moduleName]) {
        moduleStats[moduleName] = { correct: 0, total: 0 }
      }
      moduleStats[moduleName].total++

      if (!userAnswer) { empty++; return }
      if (userAnswer === q.correct) {
        correct++
        moduleStats[moduleName].correct++
      } else {
        wrong++
        const sectionTitle = q.section?.title || "Genel"
        wrongTopics[sectionTitle] = (wrongTopics[sectionTitle] || 0) + 1
        wrongQuestions.push({ ...q, userAnswer, index: i + 1 })
      }
    })

    const choiceCount = questions[0]?.options?.length || 4
    const netCorrect = Math.max(0, correct - (examConfig?.negativeMarking ? wrong / (choiceCount - 1) : 0))

    const score = SCORE_DISPLAY_MODE === "scaled" && examConfig
      ? estimateScaledScore(netCorrect, questions.length, examConfig)
      : Math.round((netCorrect / questions.length) * 100)

    const moduleScores: Record<string, number> = {}
    let allModulesPassed = true
    for (const [mod, stats] of Object.entries(moduleStats)) {
      const modScore = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
      moduleScores[mod] = modScore
      if (usesModuleBarrier && modScore < MODULE_BARRIER) {
        allModulesPassed = false
      }
    }

    const passed = SCORE_DISPLAY_MODE === "scaled"
      ? score >= PASSING_SCORE
      : score >= PASSING_SCORE && allModulesPassed

    const weakAreas = Object.entries(wrongTopics)
      .sort(([, a], [, b]) => b - a)
      .map(([topic, count]) => ({ topic, count }))

    const resultData = {
      correct, wrong, empty, total: questions.length,
      score, passed, weakAreas, wrongQuestions,
      timeUsed: initialTime - timeLeft,
      moduleScores,
      allModulesPassed,
      isRemediation
    }

    setResults(resultData)
    setExamState("results")

    const courseId = questions[0]?.courseId
    if (courseId && !isRemediation) {
      try {
        const { saveMockExamResult } = await import("@/lib/actions")
        await saveMockExamResult(courseId, {
          score, correct, wrong, empty,
          timeUsed: resultData.timeUsed, passed, weakAreas, wrongQuestions
        })
        
        // Trigger study plan regeneration to adapt to new mock exam results/weak areas
        fetch("/api/study-plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId })
        }).catch(e => console.error("Error triggering study plan generation:", e))

        if (onReloadCourse) {
          onReloadCourse()
        }
      } catch (error) {
        console.error("Error saving mock exam results:", error)
      }
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }

  if (loading) return <LoadingSkeleton />

  // ========== SETUP SCREEN ==========
  if (examState === "setup") {
    return (
      <div className="max-w-lg mx-auto text-center py-8">
        <div className="mb-6 flex justify-center"><Clock className="w-16 h-16 text-slate-600" /></div>
        <h2 className="text-2xl font-bold mb-3">Deneme Sınavı</h2>
        <p className="text-sm text-slate-400 mb-8">
          {programSlug === "cisa"
            ? `Gerçek CISA sınav koşullarında kendinizi test edin. ${QUESTION_COUNT} soru, ${EXAM_DURATION_MINUTES} dakika süre.`
            : programSlug === "cia"
              ? `Gerçek CIA parça koşullarında kendinizi test edin. ${QUESTION_COUNT} soru, ${EXAM_DURATION_MINUTES} dakika süre.`
              : programSlug === "smmm"
                ? `SMMM test usulü deneme. ${QUESTION_COUNT > 0 ? `${QUESTION_COUNT} soru` : "mevcut soru havuzu"}, ${EXAM_DURATION_MINUTES} dakika süre.`
                : `Gerçek ${programRulesLabel} sınav koşullarında kendinizi test edin. ${QUESTION_COUNT} soru, ${EXAM_DURATION_MINUTES} dakika süre.`}
        </p>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-2xl font-bold text-blue-400">{Math.min(QUESTION_COUNT, allQuestions.length)}</div>
            <div className="text-[11px] text-slate-500 mt-1">Soru</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-2xl font-bold text-amber-400">{EXAM_DURATION_MINUTES}</div>
            <div className="text-[11px] text-slate-500 mt-1">Dakika</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-2xl font-bold text-emerald-400">{PASSING_SCORE}</div>
            <div className="text-[11px] text-slate-500 mt-1">
              {SCORE_DISPLAY_MODE === "scaled"
                ? `Geçme (ölçekli${scaledRange ? ` ${scaledRange.min}-${scaledRange.max}` : ""})`
                : "Geçme Notu"}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-left mb-8">
          <div className="text-sm text-amber-300 font-medium mb-2 flex items-center gap-2"><ClipboardList className="w-4 h-4" /> {programRulesLabel} Sınav Kuralları</div>
          <ul className="text-xs text-slate-400 space-y-1">
            {programSlug === "masak" ? (
              <>
                <li>• Her modülden en az <strong className="text-amber-300">{MODULE_BARRIER} puan</strong> almalısın</li>
                <li>• Genel ortalaman en az <strong className="text-amber-300">{PASSING_SCORE} puan</strong> olmalı</li>
              </>
            ) : programSlug === "cisa" ? (
              <>
                <li>• Geçme eşiği: ölçekli <strong className="text-amber-300">{PASSING_SCORE} puan</strong> (200-800 aralığı)</li>
                <li>• Domain/alan bazlı baraj yoktur; alan skorları yalnızca bilgi amaçlıdır</li>
                <li>• ISACA Aday Kılavuzu: 2×10 dk mola hakkınız vardır; molada süre işlemeye devam eder</li>
              </>
            ) : programSlug === "cia" ? (
              <>
                <li>• Her parçada geçme: ölçekli <strong className="text-amber-300">{PASSING_SCORE} puan</strong> (250-750 aralığı)</li>
                <li>• 4 şıklı çoktan seçmeli; yanlış cevap cezası yok</li>
              </>
            ) : programSlug === "smmm" ? (
              <>
                <li>• Her dersten en az <strong className="text-amber-300">{MODULE_BARRIER} puan</strong> almalısın</li>
                <li>• Ders ortalaması en az <strong className="text-amber-300">{PASSING_SCORE} puan</strong> olmalı</li>
              </>
            ) : (
              <>
                <li>• Her {programSlug === "spl-bagimsiz-denetim" ? "dersten" : "dersten"} en az <strong className="text-amber-300">{MODULE_BARRIER} puan</strong> almalısın</li>
                <li>• Genel ortalaman en az <strong className="text-amber-300">{PASSING_SCORE} puan</strong> olmalı (sertifika için)</li>
              </>
            )}
            <li>• Yanlış cevaplar doğruları götürmez</li>
            <li>• Boş bırakılan sorular yanlış sayılmaz</li>
            <li>• Süre bitince sınav otomatik sonlanır</li>
          </ul>
        </div>

        {(!allQuestions || allQuestions.length < MIN_QUESTION_POOL) ? (
          <EmptyState
            tabId="mock_exam"
            title="İçerik Hazırlanıyor"
            description={getMaterialsPreparingDescription(!!isProfessional)}
          />
        ) : (
          programSlug === "masak" ? (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <button onClick={() => startExam("Modül 1")} className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 font-bold text-base transition-all shadow-lg shadow-blue-600/25 flex flex-col items-center justify-center gap-1" aria-label="Modül 1 sınavını başlat">
                <div className="flex items-center gap-2"><Rocket className="w-5 h-5" /><span>Modül 1 Sınavı</span></div>
                <span className="text-[10px] text-blue-200 font-normal">Hukuki Çerçeve (50 Soru)</span>
              </button>
              <button onClick={() => startExam("Modül 2")} className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 font-bold text-base transition-all shadow-lg shadow-indigo-600/25 flex flex-col items-center justify-center gap-1" aria-label="Modül 2 sınavını başlat">
                <div className="flex items-center gap-2"><Rocket className="w-5 h-5" /><span>Modül 2 Sınavı</span></div>
                <span className="text-[10px] text-indigo-200 font-normal">Uyum Yönetimi (50 Soru)</span>
              </button>
            </div>
          ) : (
            <button onClick={() => startExam()} className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold text-lg transition-all shadow-lg shadow-blue-600/25 mb-8" aria-label="Sınava başla">
              <Rocket className="w-5 h-5 inline-block mr-2" /> Sınava Başla
            </button>
          )
        )}

        {/* İLERLEME GRAFİĞİ */}
        {pastExamResults && pastExamResults.length >= 2 && (
          <div className="mt-12 mb-8 p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                <TrendingUp className="w-4.5 h-4.5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">İlerleme Trendi</h3>
                <p className="text-[11px] text-slate-500">Deneme sınavı puanlarının zaman içindeki değişimi</p>
              </div>
            </div>
            <div className="h-48 w-full">
              <ProgressChart data={pastExamResults.slice().reverse().map((r: any, i: number) => ({
                name: `#${i + 1}`,
                puan: r.score,
                tarih: new Date(r.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
              }))} passingScore={PASSING_SCORE} />
            </div>
          </div>
        )}

        {/* GEÇMİŞ DENEMELER */}
        {pastExamResults && pastExamResults.length > 0 && (
          <div className="text-left mt-4 w-full max-w-full overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Clock className="w-5 h-5 text-sky-400" />
                Geçmiş Denemelerim
              </h3>
              <span className="text-xs text-slate-500 font-medium bg-white/5 px-2 py-1 rounded-md">{pastExamResults.length} Deneme</span>
            </div>
            
            <div className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-4 -mx-4 px-4 sm:mx-0 sm:px-0">
              {pastExamResults.map((past, i) => (
                <div 
                  key={i} 
                  onClick={() => {
                    let weakAreas: any[] = [];
                    let wrongQuestions: any[] = [];
                    try {
                      const parsed = JSON.parse(past.weakAreas);
                      if (parsed.topics) { weakAreas = parsed.topics; wrongQuestions = parsed.wrongQuestions || []; }
                      else { weakAreas = parsed; }
                    } catch {}
                    setResults({ correct: past.correct, wrong: past.wrong, empty: past.empty, total: past.correct + past.wrong + past.empty, score: past.score, passed: past.passed, weakAreas, wrongQuestions, timeUsed: past.timeUsed, isPast: true, createdAt: past.createdAt });
                    setExamState("results");
                  }}
                  className="flex-none w-64 snap-center p-5 rounded-2xl bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.08] hover:border-indigo-500/40 hover:bg-white/[0.04] transition-all cursor-pointer group shadow-lg shadow-black/20 relative overflow-hidden"
                  role="button"
                  aria-label={`Deneme ${i + 1} sonuçlarını görüntüle`}
                >
                  <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity ${past.passed ? "bg-emerald-500" : "bg-red-500"}`} />
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div className={`text-4xl font-black tracking-tight ${past.passed ? "text-emerald-400" : "text-red-400"}`}>{past.score}</div>
                    <div className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider ${past.passed ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                      {past.passed ? "BAŞARILI" : "BAŞARISIZ"}
                    </div>
                  </div>
                  <div className="space-y-1.5 relative z-10">
                    <div className="text-sm font-semibold text-white">{new Date(past.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-xs font-medium text-slate-400 flex items-center gap-3">
                      <Tooltip content="Doğru">
                        <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-emerald-500/80" /> {past.correct}</span>
                      </Tooltip>
                      <Tooltip content="Yanlış">
                        <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-red-500/80" /> {past.wrong}</span>
                      </Tooltip>
                      <Tooltip content="Süre">
                        <span className="flex items-center gap-1"><Timer className="w-3.5 h-3.5 text-sky-500/80" /> {Math.floor(past.timeUsed / 60)} dk</span>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs font-bold text-indigo-400 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 relative z-10">
                    Analizi İncele <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ========== RUNNING SCREEN (SPL E-SINAV KLONU) ==========
  if (examState === "running") {
    const q = questions[currentQ]
    const answeredCount = Object.keys(answers).length
    const isTimeWarning = timeLeft < 300

    return (
      <div className="fixed inset-0 z-[100] bg-[#f8f9fa] text-[#212529] font-sans overflow-y-auto" role="region" aria-label="SPL E-Sınav Arayüzü">
        {/* HEADER */}
        <div className="bg-white border-b border-[#dee2e6] shadow-sm px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[#e9ecef] rounded flex items-center justify-center font-bold text-[#495057]">SPL</div>
            <div>
              <h2 className="text-[15px] font-bold text-[#343a40]">Elektronik Sınav Sistemi (e-Sınav)</h2>
              <div className="text-[11px] text-[#6c757d] uppercase font-semibold tracking-wide mt-1">{courseName || slug.toUpperCase().replace(/-/g, ' ')}</div>
            </div>
          </div>
          <div className={`px-4 py-2 border rounded font-mono text-xl font-bold bg-[#f8f9fa] ${isTimeWarning ? "border-red-500 text-red-600 animate-pulse" : "border-[#ced4da] text-[#495057]"}`}>
            Kalan Süre: {formatTime(timeLeft)}
          </div>
        </div>

        <div className="max-w-6xl mx-auto py-6 px-4 flex flex-col md:flex-row gap-6">
          {/* SOL: SORU VE ŞIKLAR */}
          <div className="flex-1 bg-white border border-[#dee2e6] rounded-sm p-8 shadow-sm h-fit">
            <div className="flex items-center justify-between border-b border-[#dee2e6] pb-4 mb-6">
              <div className="text-[15px] font-bold text-[#495057]">Soru {currentQ + 1} / {questions.length}</div>
              <button 
                onClick={() => { setFlagged(prev => { const next = new Set(prev); if (next.has(currentQ)) next.delete(currentQ); else next.add(currentQ); return next }) }} 
                className={`text-[12px] px-3 py-1.5 border rounded-sm transition-colors ${flagged.has(currentQ) ? "bg-[#fff3cd] border-[#ffe69c] text-[#664d03]" : "bg-[#f8f9fa] border-[#ced4da] text-[#495057] hover:bg-[#e2e3e5]"}`}
              >
                {flagged.has(currentQ) ? "🚩 İşaretlendi" : "🚩 İşaretle (Boş Bırak)"}
              </button>
            </div>

            <div className="text-[15px] leading-relaxed text-[#212529] mb-4 select-none">
              {formatMockExamQuestionText(q.text)}
            </div>
            {q.text_en && (
              <div className="text-[13px] leading-relaxed text-[#6c757d] mb-8 italic border-l-2 border-[#b6d4fe] pl-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#0d6efd] block mb-1">English</span>
                {formatMockExamQuestionText(q.text_en)}
              </div>
            )}
            {!q.text_en && <div className="mb-4" />}

            <fieldset className="space-y-4" aria-label="Cevap seçenekleri">
              {q.options.slice(0, 5).map((opt: string, i: number) => {
                const letter = String.fromCharCode(65 + i)
                const isSelected = answers[currentQ] === letter
                const cleanOpt = opt.replace(/^[A-J][).]\s*/, '')
                const enOptions: string[] | null = (() => {
                  if (!q.options_en) return null
                  if (Array.isArray(q.options_en)) return q.options_en
                  try { return JSON.parse(q.options_en) } catch { return null }
                })()
                const enOpt = enOptions?.[i]?.replace(/^[A-J][).]\s*/, '') || null
                return (
                  <label key={i} className={`flex items-start gap-3 p-3 border rounded-sm cursor-pointer transition-colors ${isSelected ? "bg-[#e7f1ff] border-[#b6d4fe]" : "bg-white border-[#ced4da] hover:bg-[#f8f9fa]"}`}>
                    <input 
                      type="radio" 
                      name="exam-option" 
                      value={letter} 
                      checked={isSelected}
                      onChange={() => selectAnswer(currentQ, letter)}
                      className="mt-1 w-4 h-4 text-blue-600"
                    />
                    <span className="font-bold text-[#495057] w-5">{letter})</span>
                    <span className="text-[14px] text-[#212529] select-none flex flex-col gap-0.5">
                      <span>{cleanOpt}</span>
                      {enOpt && <span className="text-[12px] text-[#6c757d] italic">{enOpt}</span>}
                    </span>
                  </label>
                )
              })}
            </fieldset>

            <div className="flex items-center justify-between mt-12 pt-6 border-t border-[#dee2e6]">
              <button 
                onClick={() => setCurrentQ(Math.max(0, currentQ - 1))} 
                disabled={currentQ === 0} 
                className="px-6 py-2.5 bg-[#6c757d] text-white text-[13px] font-bold rounded-sm hover:bg-[#5a6268] disabled:opacity-50 transition-colors"
              >
                ◀ Önceki Soru
              </button>
              
              {currentQ === questions.length - 1 ? (
                <button 
                  onClick={finishExam} 
                  className="px-8 py-2.5 bg-[#198754] text-white text-[13px] font-bold rounded-sm hover:bg-[#157347] transition-colors shadow-sm"
                >
                  Sınavı Bitir
                </button>
              ) : (
                <button 
                  onClick={() => setCurrentQ(currentQ + 1)} 
                  className="px-6 py-2.5 bg-[#0d6efd] text-white text-[13px] font-bold rounded-sm hover:bg-[#0b5ed7] transition-colors shadow-sm"
                >
                  Sonraki Soru ▶
                </button>
              )}
            </div>
          </div>

          {/* SAĞ: OPTİK FORM (Soru Navigasyonu) */}
          <div className="w-full md:w-[280px] shrink-0">
            <div className="bg-white border border-[#dee2e6] rounded-sm p-4 sticky top-24 shadow-sm">
              <div className="text-[13px] font-bold text-[#495057] border-b border-[#dee2e6] pb-3 mb-4">Soru Tablosu</div>
              
              <div className="grid grid-cols-5 gap-2 mb-6">
                {questions.map((_, i) => {
                  const isAnswered = !!answers[i]
                  const isFlagged = flagged.has(i)
                  const isCurrent = i === currentQ
                  
                  let btnClass = "bg-[#f8f9fa] border-[#ced4da] text-[#495057]" // Varsayılan (Boş)
                  if (isCurrent) btnClass = "bg-[#0d6efd] border-[#0a58ca] text-white ring-2 ring-[#0d6efd]/30" // Aktif Soru
                  else if (isAnswered && isFlagged) btnClass = "bg-[#fff3cd] border-[#ffe69c] text-[#664d03]" // Cevaplandı + İşaretlendi
                  else if (isAnswered) btnClass = "bg-[#cfe2ff] border-[#9ec5fe] text-[#052c65]" // Sadece Cevaplandı
                  else if (isFlagged) btnClass = "bg-[#fff3cd] border-[#ffe69c] text-[#664d03]" // Boş + İşaretlendi

                  return (
                    <button 
                      key={i} 
                      onClick={() => setCurrentQ(i)}
                      className={`w-10 h-10 flex items-center justify-center text-[12px] font-bold border rounded-sm transition-colors relative ${btnClass}`}
                    >
                      {i + 1}
                      {isFlagged && <div className="absolute top-0 right-0 w-2 h-2 bg-[#dc3545] rounded-full translate-x-1 -translate-y-1 border border-white"></div>}
                    </button>
                  )
                })}
              </div>

              <div className="text-[11px] text-[#6c757d] space-y-2 border-t border-[#dee2e6] pt-4">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#cfe2ff] border border-[#9ec5fe] rounded-sm"></div><span>Cevaplandı ({answeredCount})</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#f8f9fa] border border-[#ced4da] rounded-sm"></div><span>Boş ({questions.length - answeredCount})</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#fff3cd] border border-[#ffe69c] rounded-sm relative"><div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-[#dc3545] rounded-full"></div></div><span>İşaretlendi ({flagged.size})</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ========== RESULTS SCREEN ==========
  if (examState === "results" && results) {
    const timeUsedMin = Math.floor(results.timeUsed / 60)
    const timeUsedSec = results.timeUsed % 60

    const scaleMin = SCORE_DISPLAY_MODE === "scaled" ? (scaledRange?.min ?? 0) : 0
    const scaleMax = SCORE_DISPLAY_MODE === "scaled" ? (scaledRange?.max ?? 100) : 100
    const normalized = scaleMax > scaleMin
      ? Math.round(((results.score - scaleMin) / (scaleMax - scaleMin)) * 100)
      : Math.round((results.correct / results.total) * 100)
    const passMark = scaleMax > scaleMin
      ? Math.round(((PASSING_SCORE - scaleMin) / (scaleMax - scaleMin)) * 100)
      : PASSING_SCORE

    const durum =
      normalized >= passMark + 15 ? "guclu"
      : normalized >= passMark     ? "orta"
      : normalized >= passMark - 10 ? "riskli"
      :                             "yetersiz"

    return (
      <div className="max-w-2xl mx-auto space-y-6" role="region" aria-label="Sınav sonuçları">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className={`p-8 rounded-2xl text-center border ${results.passed ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}
        >
          <div className={`text-6xl font-bold mb-2 ${results.passed ? "text-emerald-400" : "text-red-400"}`}>{results.score}</div>
          <div className="text-sm text-slate-400 mb-2">
            {SCORE_DISPLAY_MODE === "scaled"
              ? `Tahmini ölçekli puan${scaledRange ? ` (${scaledRange.min}-${scaledRange.max})` : ""}`
              : "100 üzerinden"}
          </div>
          {SCORE_DISPLAY_MODE === "scaled" && (
            <p className="text-[11px] text-slate-500 mb-4 max-w-md mx-auto">
              Bu puan, doğru sayına göre hesaplanmış kaba bir tahmindir. Gerçek sınavda ölçekli puan, soru zorlukları ve o dönemki aday dağılımına göre belirlenir; sonucun bu tahminden farklı olabilir. Kendini değerlendirirken doğru sayını ve zayıf konularını esas al.
            </p>
          )}
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold ${results.passed ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {results.passed ? <><CheckCircle className="w-4 h-4 inline-block mr-1" /> GEÇTİN!</> : <><XCircle className="w-4 h-4 inline-block mr-1" /> KALDIN</>}
            {!results.passed && ` (Geçme: ${PASSING_SCORE}${usesModuleBarrier && !results.allModulesPassed ? ` + Her modül min ${MODULE_BARRIER}` : ""})`}
          </div>
          {/* Modül Bazlı Skorlar */}
          {results.moduleScores && Object.keys(results.moduleScores).length > 1 && usesModuleBarrier && (
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {Object.entries(results.moduleScores as Record<string, number>).map(([mod, modScore]) => (
                <div key={mod} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${modScore >= MODULE_BARRIER ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
                  {mod}: {modScore} {modScore < MODULE_BARRIER && `(min ${MODULE_BARRIER} gerekli)`}
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Güven ve Şeffaflık Notu */}
        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <strong className="block text-blue-200 mb-1">Gerçekçi Sınav Garantisi</strong>
            Bu sınavdaki sorular, günlük çalışmanızda görmediğiniz özel deneme sınavı havuzundan seçilmiştir. Elde ettiğiniz bu skor, gerçek sınav performansınızı en doğru yansıtan göstergedir.
          </div>
        </div>

        {/* Performans Analizi */}
        <div className={`p-6 rounded-2xl border ${durum === "guclu" || durum === "orta" ? "bg-emerald-500/5 border-emerald-500/20" : durum === "riskli" ? "bg-amber-500/5 border-amber-500/20" : "bg-red-500/5 border-red-500/20"}`}>
          <h3 className="text-base font-bold mb-3 flex items-center gap-2"><BarChart2 className="w-5 h-5 text-indigo-400" /> Performans Analizi</h3>
          <div className="flex items-center gap-4 mb-4">
            <div className={`text-2xl font-bold flex items-center gap-2 ${durum === "guclu" || durum === "orta" ? "text-emerald-400" : durum === "riskli" ? "text-amber-400" : "text-red-400"}`}>
              {durum === "guclu" ? <><CheckCircle className="w-6 h-6" /> Güçlü</> : durum === "orta" ? <><CheckCircle className="w-6 h-6" /> Orta</> : durum === "riskli" ? <><AlertTriangle className="w-6 h-6" /> Riskli</> : <><XCircle className="w-6 h-6" /> Yetersiz</>}
            </div>
            <div className="text-xs text-slate-500">
              Geçme: {PASSING_SCORE}{SCORE_DISPLAY_MODE === "percent" ? " puan" : " (ölçekli)"} | Senin puanın: {results.score}
            </div>
          </div>
          <div className="text-xs text-slate-300 p-4 rounded-lg bg-white/[0.03] space-y-2">
            {durum === "guclu" ? <p><CheckCircle className="w-4 h-4 inline-block mr-1 text-emerald-400" /> <strong>Çok iyi durumdasın.</strong> Eksik olduğun birkaç konuya göz at ve 1-2 gün sonra seviyeni korumak için tekrar dene.</p>
            : durum === "orta" ? <p><CheckCircle className="w-4 h-4 inline-block mr-1 text-emerald-400" /> <strong>Başarılısın.</strong> Zayıf konuların notlarını hızlıca tekrarla ve bilgi kartı çöz. Hedefini koru!</p>
            : durum === "riskli" ? <p><AlertTriangle className="w-4 h-4 inline-block mr-1 text-amber-400" /> <strong>Kıl payı / Riskli.</strong> Eksik hissettiğin konuların özetlerine çalışıp 1-2 deneme daha yaparak pratik kazanmalısın.</p>
            : <p><XCircle className="w-4 h-4 inline-block mr-1 text-red-400" /> <strong>Eksiklerini tamamlamalısın.</strong> Yanlış yaptığın konuları notlardan oku ve o konulara ait soruları tekrar çözüp seviyeni artır.</p>}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <div className="text-xl font-bold text-emerald-400">{results.correct}</div>
            <div className="text-[10px] text-slate-500 mt-1">Doğru</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <div className="text-xl font-bold text-red-400">{results.wrong}</div>
            <div className="text-[10px] text-slate-500 mt-1">Yanlış</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <div className="text-xl font-bold text-slate-400">{results.empty}</div>
            <div className="text-[10px] text-slate-500 mt-1">Boş</div>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <div className="text-xl font-bold text-blue-400">{timeUsedMin}:{timeUsedSec.toString().padStart(2, "0")}</div>
            <div className="text-[10px] text-slate-500 mt-1">Süre</div>
          </div>
        </div>

        {/* Weak Areas */}
        {results.weakAreas.length > 0 && (
          <div className="p-6 rounded-3xl bg-white/[0.02] border border-red-500/10 shadow-[0_0_40px_rgba(239,68,68,0.05)]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center"><Target className="w-5 h-5 text-red-400" /></div>
              <div><h3 className="text-lg font-bold text-white">Zayıf Konu Radarı</h3><p className="text-xs text-slate-400">Bu konularda daha fazla hata yaptın</p></div>
            </div>
            <div className="space-y-5 mb-8">
              {results.weakAreas.map((area: any, i: number) => {
                const maxWrong = Math.max(...results.weakAreas.map((a: any) => a.count))
                const percentage = Math.round((area.count / maxWrong) * 100)
                return (
                  <div key={i} className="relative">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-semibold text-slate-200 line-clamp-1 pr-4">{area.topic}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-bold text-red-400">{area.count} yanlış</span>
                        <button onClick={() => { setExamState("setup"); setResults(null); setTimeout(() => { const el = document.querySelector('[data-tab="questions"]') as HTMLElement; el?.click() }, 100) }}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 font-bold hover:bg-indigo-500/20 transition-colors">Bu konuyu çalış →</button>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="pt-5 border-t border-white/5 space-y-4">
              <p className="text-sm text-slate-300 font-medium flex items-center gap-2"><Lightbulb className="w-4 h-4 text-yellow-500" /> Önerilen Telafi Planı:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button onClick={startRemediationExam} className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold hover:bg-red-500/20 transition-all group" aria-label="Sadece yanlışları tekrar çöz">
                  <RotateCcw className="w-4 h-4 group-hover:-rotate-180 transition-transform duration-500" /> Sadece Yanlışları Çöz
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setTimeout(() => { const el = document.querySelector('[data-tab="notes"]') as HTMLElement; el?.click() }, 100) }} className="flex items-center justify-center gap-2 py-3 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-colors" aria-label="Ders notlarına git">
                    <BookOpen className="w-3.5 h-3.5" /> Notlar
                  </button>
                  <button onClick={() => { setTimeout(() => { const el = document.querySelector('[data-tab="flashcards"]') as HTMLElement; el?.click() }, 100) }} className="flex items-center justify-center gap-2 py-3 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-colors" aria-label="Flashcard'lara git">
                    <Brain className="w-3.5 h-3.5" /> Kartlar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Wrong Questions Detail */}
        {results.wrongQuestions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-base font-bold">❌ Yanlış Cevapladığın Sorular ({results.wrongQuestions.length})</h3>
            {results.wrongQuestions.map((wq: any, i: number) => (
              <div key={i} className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded">Soru {wq.index}</span>
                  {wq.section?.title && <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded">{wq.section.title}</span>}
                </div>
                <div className="text-sm mb-3">{formatMockExamQuestionText(wq.text)}</div>
                <div className="flex items-center gap-4 text-xs mb-2">
                  <span className="text-red-400">Senin cevabın: <b>{wq.userAnswer}</b></span>
                  <span className="text-emerald-400">Doğru cevap: <b>{wq.correct}</b></span>
                </div>
                {wq.explanation && (
                  <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                    <div className="mt-2 text-slate-300 leading-relaxed markdown-notes">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanExplanationText(wq.explanation)}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={() => { setExamState("setup"); setResults(null); }} className="flex-1 py-3 rounded-xl bg-white/5 text-slate-400 font-bold hover:bg-white/10 transition-colors" aria-label={results.isPast ? "Geçmiş denemelere dön" : "Yeni sınav başlat"}>
            ← {results.isPast ? "Geçmiş Denemelere Dön" : "Yeni Sınav"}
          </button>
          {results.wrongQuestions && results.wrongQuestions.length > 0 && (
            <button onClick={startRemediationExam} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-bold hover:from-amber-500 hover:to-orange-500 transition-all shadow-lg shadow-amber-600/20" aria-label="Zayıf alan telafi sınavı başlat">
              <Target className="w-4 h-4 mr-2 inline-block" /> Zayıf Alan Telafi Sınavı
            </button>
          )}
          <button onClick={() => startExam()} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-colors" aria-label="Yeni deneme başlat">
            <RefreshCw className="w-4 h-4 mr-2 inline-block" /> Yeni Deneme Çöz
          </button>
        </div>
      </div>
    )
  }

  return null
}
