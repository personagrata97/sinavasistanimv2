"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, Target, CheckCircle2, Clock, Flame, Coffee, Zap, Brain, BarChart3, BookOpen } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { LoadingSkeleton, EmptyState, cleanExplanationText } from "./shared"

export default
function DailyGoalsTab({ course, slug, hasExamDate, onSetExamDate, onNavigateToSection }: { course: any; slug: string; hasExamDate?: boolean; onSetExamDate?: () => void; onNavigateToSection?: (sectionId: string) => void }) {
  const [goals, setGoals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dailyQuestion, setDailyQuestion] = useState<any>(null)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [showExplanation, setShowExplanation] = useState(false)

  useEffect(() => {
    async function load() {
      const { getDailyGoals, getCourseQuestions } = await import("@/lib/actions")
      const [goalsData, questions] = await Promise.all([getDailyGoals(slug), getCourseQuestions(slug)])
      setGoals(goalsData)
      
      if (questions && questions.length > 0) {
        // Bugüne özel tek bir soru seç (tarihi seed olarak kullan)
        const today = new Date().toISOString().split('T')[0]
        let hash = 0
        for (let i = 0; i < today.length; i++) hash = today.charCodeAt(i) + ((hash << 5) - hash)
        const index = Math.abs(hash) % questions.length
        setDailyQuestion(questions[index])
      }
      setLoading(false)
    }
    load()
  }, [slug])

  if (loading) return <LoadingSkeleton />

  if (course?.sections?.length === 0 || goals.length === 0) {
    return (
      <EmptyState
        tabId="goals"
        title="İçerik Hazırlanıyor"
        description="Bu dersin materyalleri yapay zeka asistanımız tarafından arka planda sizin için hazırlanıyor. Lütfen daha sonra tekrar kontrol edin."
      />
    )
  }

  if (!hasExamDate) {
    return (
      <EmptyState
        tabId="goals"
        title="Çalışma Planınızı Oluşturun"
        description="Size özel, yapay zeka destekli dinamik günlük hedeflerinizi hesaplayabilmemiz için lütfen hedef sınav tarihinizi ve günlük ayırabileceğiniz ortalama çalışma süresini belirleyin."
        action={
          <button
            onClick={onSetExamDate}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5"
          >
            Sınav Tarihi ve Planı Belirle
          </button>
        }
      />
    )
  }

  const completedCount = goals.filter((g: any) => g.completed).length

  return (
    <section className="max-w-2xl mx-auto space-y-6" aria-label="Günlük hedefler">
      {/* Günlük Meydan Okuma */}
      {dailyQuestion && (
        <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-600/10 border border-amber-500/20 relative overflow-hidden mb-8">
          <div className="absolute -top-4 -right-4 p-4 opacity-10 pointer-events-none">
            <Flame className="w-32 h-32 text-amber-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-amber-400">Günün Zor Sorusu (+50 XP)</h3>
            </div>
            <p className="text-sm font-medium text-white/90 mb-4 leading-relaxed">{dailyQuestion.text}</p>
            <div className="space-y-2" role="radiogroup" aria-label="Çoktan seçmeli seçenekler">
              {dailyQuestion.options.map((opt: string, i: number) => {
                const letter = String.fromCharCode(65 + i)
                const isSelected = selectedOption === letter
                const isCorrect = letter === dailyQuestion.correct
                const showStatus = showExplanation
                
                let btnClass = "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] text-slate-300"
                if (showStatus) {
                  if (isCorrect) btnClass = "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                  else if (isSelected && !isCorrect) btnClass = "bg-red-500/20 border-red-500/50 text-red-400"
                  else btnClass = "bg-white/[0.01] border-white/[0.02] text-slate-500 opacity-50"
                } else if (isSelected) {
                  btnClass = "bg-amber-500/20 border-amber-500/50 text-amber-400"
                }

                return (
                  <button
                    key={i}
                    disabled={showExplanation}
                    onClick={() => {
                      setSelectedOption(letter)
                      setShowExplanation(true)
                      if (letter === dailyQuestion.correct) {
                        toast.success("Tebrikler! +50 XP kazandınız.", { icon: "🔥" })
                      } else {
                        toast.error("Yanlış cevap, yarın tekrar dene!", { icon: "❌" })
                      }
                    }}
                    className={`w-full text-left p-3 rounded-xl border text-[13px] transition-all ${btnClass}`}
                    aria-label={`Seçenek ${letter}: ${opt}`}
                    role="radio"
                    aria-checked={isSelected}
                  >
                    <span className="font-bold mr-2 opacity-60">{letter})</span> {opt}
                  </button>
                )
              })}
            </div>
            
            <AnimatePresence>
              {showExplanation && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 p-4 rounded-xl bg-black/20 border border-white/5">
                  <div className="text-xs font-bold text-slate-400 mb-1">Detaylı Çözüm</div>
                  <div className="text-[13px] text-slate-300 leading-relaxed markdown-notes mb-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanExplanationText(dailyQuestion.explanation)}</ReactMarkdown>
                  </div>
                  {selectedOption !== dailyQuestion.correct && dailyQuestion.sectionId && (
                    <button
                      onClick={() => onNavigateToSection?.(dailyQuestion.sectionId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-bold transition-all text-white border border-sky-500/20 cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      Bu Konuyu Tekrar Et
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Bugünün Hedefleri</h2>
          <p className="text-sm text-slate-400">Öğrenme eğrinize göre hesaplanan günlük planınız.</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-sky-400">{completedCount}/{goals.length}</div>
          <div className="text-xs text-slate-500">Tamamlandı</div>
        </div>
      </div>

      <div className="space-y-4" role="list" aria-label="Günlük hedef listesi">
        {goals.map((goal: any) => (
          <div
            key={goal.id}
            role="listitem"
            aria-label={`${goal.title} - ${goal.completed ? 'Tamamlandı' : 'Bekliyor'}`}
            className={`p-5 rounded-xl border flex items-start gap-4 transition-all ${
              goal.completed 
                ? "bg-emerald-500/5 border-emerald-500/20" 
                : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08]"
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              goal.completed ? "bg-emerald-500/20" : "bg-sky-500/20"
            }`}>
              {goal.completed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : goal.type === "flashcards" ? (
                <Brain className="w-5 h-5 text-sky-400" />
              ) : goal.type === "mock_exam" ? (
                <BarChart3 className="w-5 h-5 text-sky-400" />
              ) : (
                <BookOpen className="w-5 h-5 text-sky-400" />
              )}
            </div>
            <div className="flex-1 pt-1">
              <h3 className={`font-bold ${goal.completed ? "text-emerald-400" : "text-white"}`}>{goal.title}</h3>
              <p className="text-sm text-slate-400 mt-1">{goal.desc}</p>
              
              {!goal.completed && (
                <div className="mt-4">
                  {goal.type === "flashcards" && (
                    <button onClick={() => document.querySelector<HTMLElement>('[data-tab="flashcards"]')?.click()} className="text-xs px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg font-bold transition-colors">
                      {goal.count} Kartı Tekrar Et
                    </button>
                  )}
                  {goal.type === "reading" && (
                    <button onClick={() => goal.sectionId ? onNavigateToSection?.(goal.sectionId) : document.querySelector<HTMLElement>('[data-tab="notes"]')?.click()} className="text-xs px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg font-bold transition-colors">
                      Notları Oku
                    </button>
                  )}
                  {goal.type === "mock_exam" && (
                    <button onClick={() => document.querySelector<HTMLElement>('[data-tab="mock_exam"]')?.click()} className="text-xs px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-bold transition-colors">
                      Deneme Çöz
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )

}

