"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { BarChart3, Target, CheckCircle2, AlertTriangle, BookOpen, Loader2, XCircle } from "lucide-react"
import { LoadingSkeleton } from "./shared"

export default
// ==================== KAPSAM HARİTASI + ZAYIF ALAN ANALİZİ ====================

function CoverageTab({ slug }: { slug: string }) {
  const [coverage, setCoverage] = useState<any[]>([])
  const [weakAreas, setWeakAreas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { getCoverageMap, getWeakAreas } = await import("@/lib/actions")
      const [cov, weak] = await Promise.all([getCoverageMap(slug), getWeakAreas(slug)])
      setCoverage(cov)
      setWeakAreas(weak)
      setLoading(false)
    }
    load()
  }, [slug])

  if (loading) return <LoadingSkeleton />

  const totalScore = coverage.length > 0 ? Math.round(coverage.reduce((sum: number, c: any) => sum + c.overallScore, 0) / coverage.length) : 0
  const masteredCount = coverage.filter((c: any) => c.status === "mastered").length
  const learningCount = coverage.filter((c: any) => c.status === "learning").length

  const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
    mastered: { color: "text-emerald-400", bg: "bg-emerald-500", label: "Tamamlandı" },
    learning: { color: "text-amber-400", bg: "bg-amber-500", label: "Devam Ediyor" },
    started: { color: "text-blue-400", bg: "bg-blue-500", label: "Başlandı" },
    processing: { color: "text-indigo-400", bg: "bg-indigo-500", label: "İşleniyor ⏳" },
    not_started: { color: "text-slate-600", bg: "bg-slate-700", label: "Başlanmadı" },
  }

  return (
    <section className="space-y-8 max-w-4xl mx-auto" aria-label="Kapsam haritası">
      {/* Genel Skor */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 text-center">
          <div className="text-3xl font-black text-white">%{totalScore}</div>
          <div className="text-xs text-indigo-400 font-bold uppercase tracking-wider mt-1">Genel İlerleme</div>
        </div>
        <div className="p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-center">
          <div className="text-3xl font-black text-emerald-400">{masteredCount}</div>
          <div className="text-xs text-emerald-500/60 font-bold uppercase tracking-wider mt-1">Tamamlanan Konu</div>
        </div>
        <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/10 text-center">
          <div className="text-3xl font-black text-amber-400">{learningCount}</div>
          <div className="text-xs text-amber-500/60 font-bold uppercase tracking-wider mt-1">Devam Eden</div>
        </div>
        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center">
          <div className="text-3xl font-black text-white">{coverage.length}</div>
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Toplam Konu</div>
        </div>
      </div>

      {/* Zayıf Alan Uyarısı */}
      {weakAreas.length > 0 && (
        <div className="p-5 rounded-2xl bg-red-500/5 border border-red-500/15">
          <h3 className="text-lg font-bold text-red-400 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5" /> Zayıf Alanlar ({weakAreas.length} konu)
          </h3>
          <div className="space-y-3">
            {weakAreas.map((area: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
                <div className="flex-1">
                  <div className="text-sm font-bold text-white">{area.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{area.recommendation}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className={`text-lg font-black ${area.accuracy < 40 ? "text-red-400" : area.accuracy < 60 ? "text-amber-400" : "text-yellow-400"}`}>
                      %{area.accuracy}
                    </div>
                    <div className="text-[10px] text-slate-600">{area.correct}/{area.total} doğru</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Konu Bazlı İlerleme */}
      <div>
        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-indigo-400" /> Konu Bazlı Kapsam Haritası
        </h3>
        <div className="space-y-3">
          {coverage.map((item: any, i: number) => {
            const config = statusConfig[item.status] || statusConfig.not_started
            return (
              <motion.div
                key={item.sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${config.color}`}>{item.title}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.importance === "High" ? "bg-red-500/10 text-red-400 border border-red-500/20" : 
                        item.importance === "Medium" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : 
                        "bg-slate-500/10 text-slate-500 border border-slate-500/20"
                      }`}>{item.importance === "High" ? "Kritik" : item.importance === "Medium" ? "Orta" : "Ek"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-lg text-xs font-bold ${config.color} flex items-center gap-2`}>
                      {item.status === 'processing' && <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }} className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full" />}
                      {config.label}
                    </span>
                    <span className="text-lg font-black text-white">
                      {item.status === 'processing' ? '—' : `%${item.overallScore}`}
                    </span>
                  </div>
                </div>

                {/* İlerleme Çubuğu */}
                <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden mb-3 relative" role="progressbar" aria-valuenow={item.status === 'processing' ? undefined : item.overallScore} aria-valuemin={0} aria-valuemax={100}>
                  {item.status === 'processing' ? (
                    <motion.div
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50"
                    />
                  ) : (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${item.overallScore}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                      className={`h-full rounded-full ${
                        item.overallScore >= 80 ? "bg-gradient-to-r from-emerald-500 to-green-400" :
                        item.overallScore >= 50 ? "bg-gradient-to-r from-amber-500 to-yellow-400" :
                        item.overallScore > 0 ? "bg-gradient-to-r from-blue-500 to-cyan-400" :
                        "bg-slate-700"
                      }`}
                    />
                  )}
                </div>

                {/* Detay İstatistikler */}
                <div className={`grid grid-cols-4 gap-2 transition-opacity ${item.status === 'processing' ? 'opacity-30 pointer-events-none' : ''}`}>
                  <div className="text-center p-2 rounded-lg bg-black/20">
                    <div className="text-[10px] text-slate-600 font-bold uppercase">Notlar</div>
                    <div className={`text-xs font-bold mt-0.5 flex items-center justify-center gap-1.5 ${item.status === 'processing' ? 'text-slate-500' : item.hasNotes ? "text-emerald-400" : "text-slate-600"}`}>
                      {item.status === 'processing' ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> <span>İşleniyor</span></>
                      ) : item.hasNotes ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" /> <span>Var</span></>
                      ) : (
                        <><XCircle className="w-3.5 h-3.5" /> <span>Yok</span></>
                      )}
                    </div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/20">
                    <div className="text-[10px] text-slate-600 font-bold uppercase">Soru Çözüm</div>
                    <div className="text-xs font-bold mt-0.5 text-slate-300">{item.status === 'processing' ? "—" : `${item.answeredQuestions}/${item.totalQuestions}`}</div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/20">
                    <div className="text-[10px] text-slate-600 font-bold uppercase">Doğruluk</div>
                    <div className={`text-xs font-bold mt-0.5 ${item.status === 'processing' ? 'text-slate-500' : item.questionAccuracy >= 70 ? "text-emerald-400" : item.questionAccuracy >= 50 ? "text-amber-400" : "text-red-400"}`}>
                      {item.status === 'processing' ? "—" : item.answeredQuestions > 0 ? `%${item.questionAccuracy}` : "—"}
                    </div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-black/20">
                    <div className="text-[10px] text-slate-600 font-bold uppercase">Bilgi Kartı</div>
                    <div className="text-xs font-bold mt-0.5 text-slate-300">{item.status === 'processing' ? "—" : `${item.masteredFlashcards}/${item.totalFlashcards}`}</div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}


