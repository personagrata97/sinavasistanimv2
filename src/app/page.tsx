"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { BookOpen, ArrowRight, Shield, Brain, Scale, BarChart3, FileText, Flame, Zap } from "lucide-react"
import Link from "next/link"
import { getReadyPrograms } from "@/lib/program-catalog"
import { resolveProgramIcon } from "@/lib/program-icons"

export default function LandingPage() {
  const [mounted, setMounted] = useState(false)
  const programs = getReadyPrograms()

  useEffect(() => setMounted(true), [])

  const features = [
    { icon: FileText, label: "Özet Ders Notları", desc: "PDF'lerinden üretilen sadeleştirilmiş anlatım" },
    { icon: Brain, label: "Çalışma Kartları", desc: "Aralıklı tekrar yöntemiyle kalıcı öğrenme" },
    { icon: BarChart3, label: "Soru Bankası", desc: "Sınav formatına birebir uygun binlerce soru" },
    { icon: Scale, label: "Deneme Sınavları", desc: "Gerçek sınav süresi ve zorluğunda pratik" },
    { icon: Zap, label: "Hızlı Tekrar", desc: "Sınavdan önce bakılacak kritik bilgiler" },
    { icon: Flame, label: "Gelişim Takibi", desc: "Hangi konularda eksiğin olduğunu anında gör" },
  ]

  return (
    <main className="min-h-screen bg-[#020617] text-white overflow-hidden relative">
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[15%] w-[40%] h-[40%] rounded-full bg-indigo-900/20 blur-[200px]" />
        <div className="absolute bottom-[-15%] right-[10%] w-[35%] h-[35%] rounded-full bg-slate-800/30 blur-[180px]" />
      </div>

      <div className="absolute inset-0 z-0 opacity-[0.015]" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }} />

      <div className="relative z-10">
        <nav className="flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <BookOpen className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white/90">
              Sınav Asistanım
            </span>
          </div>
          <Link
            href="/dashboard"
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors text-sm font-semibold"
          >
            Çalışmaya Başla
          </Link>
        </nav>

        <div className="container mx-auto px-6 pt-16 pb-24 flex flex-col items-center text-center">
          {mounted && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
                <span className="text-white/95">Her Sınava</span>
                <br />
                <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  Hazır Ol.
                </span>
              </h1>

              <p className="text-base md:text-lg text-slate-400 max-w-xl mx-auto leading-relaxed mb-14">
                Yapay zeka destekli ders notları, akıllı soru bankası ve kişiselleştirilmiş
                çalışma planı ile hedefine en kısa yoldan ulaş.
              </p>
            </motion.div>
          )}

          {mounted && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="w-full max-w-5xl grid sm:grid-cols-2 md:grid-cols-3 gap-4 mb-16"
            >
              {programs.map((prog, i) => {
                const Icon = resolveProgramIcon(prog.icon)
                return (
                  <motion.div
                    key={prog.slug}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 + i * 0.08 }}
                  >
                    <Link href={`/program/${prog.slug}`}>
                      <div className={`group relative p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] ${prog.theme.border} transition-all cursor-pointer text-left`}>
                        <Icon className={`w-6 h-6 ${prog.theme.text} mb-4`} />
                        <h3 className="text-lg font-bold mb-1">{prog.displayName}</h3>
                        <p className="text-xs text-slate-500 mb-4">{prog.subtitle}</p>
                        <div className={`flex items-center gap-1 text-xs ${prog.theme.cta} font-semibold group-hover:gap-2 transition-all`}>
                          Başla <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </motion.div>
          )}

          {mounted && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl w-full"
            >
              {features.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 + i * 0.06 }}
                  className="flex flex-col items-center gap-2 p-5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.1] transition-colors"
                >
                  <item.icon className="w-5 h-5 text-slate-500" />
                  <span className="text-sm font-medium text-white/80">{item.label}</span>
                  <span className="text-[11px] text-slate-600">{item.desc}</span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </main>
  )
}
