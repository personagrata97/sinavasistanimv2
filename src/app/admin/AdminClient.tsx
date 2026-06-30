"use client"

import { useState, useTransition, useEffect } from "react"
import { Users, Bot, Activity, Target, Clock, ShieldAlert, Flame, AlertTriangle, CheckCircle2, BookOpen, Check, ChevronLeft, ChevronRight, Search, ShieldCheck, FileText, AlertCircle, Sparkles, X, Database, Zap, RefreshCw, Server } from "lucide-react"
import { resolveQuestion } from "@/lib/actions"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Modal } from "@/components/course/shared"
import { ConfirmModal } from "@/components/course/shared/ConfirmModal"
import { Tooltip } from "@/components/ui/shared"
import { SectionQualityModal } from "@/components/admin/SectionQualityModal"
import { parseQualityIssues, deriveQualityStages } from "@/lib/section-quality-gates"
import {
  getApiOperationLabel,
  getApiStatusLabel,
  getApiStatusTone,
  API_STATUS_BADGE_CLASS,
} from "@/lib/api-operation-labels"
import type { ApiUsageDaySummary } from "@/lib/api-usage-summary"

interface AdminClientProps {
  users: Array<{
    id: string
    name: string | null
    email: string | null
    role: string
    createdAt: Date
    lastActiveAt: Date
    currentStreak: number
    _count: {
      mockResults: number
      questionAnswers: number
    }
  }>
  reportedQuestions: Array<{
    id: string
    text: string
    options: string
    correct: string
    explanation: string | null
    course: { slug: string; name: string; program: { slug: string; name: string } | null } | null
    section: { title: string; module: string | null } | null
  }>
  sectionsQuality: Array<{
    id: string
    title: string
    module: string | null
    course: { slug: string; name: string; program: { slug: string; name: string } | null } | null
    processed: boolean
    verificationScore: number | null
    verificationIssues: string | null
  }>
  stats: {
    totalUsers: number
    activeToday: number
    totalMockExams: number
  }
  apiLogs?: Array<{
    id: string
    apiKey: string
    model: string
    operation: string
    courseSlug: string | null
    courseFullName?: string | null
    status: string
    durationMs: number | null
    createdAt: Date
  }>
  apiSummary?: ApiUsageDaySummary
  systemKeys?: string[]
}

type TabType = "users" | "reported" | "quality" | "api_usage" | "queue"

const MODEL_LABELS: Record<string, string> = {
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
}

function formatApiLogTime(createdAt: string | Date): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return "—"

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const logStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((todayStart.getTime() - logStart.getTime()) / 86400000)

  const time = d.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  let dayLabel: string
  if (dayDiff === 0) dayLabel = "Bugün"
  else if (dayDiff === 1) dayLabel = "Dün"
  else {
    dayLabel = d.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  }

  return `${dayLabel} · ${time}`
}

function translateApiErrorDetail(detail: string): string {
  const lower = detail.toLowerCase()

  if (/timeout.*exceeded|econnaborted|etimedout/.test(lower)) {
    const msMatch = detail.match(/(\d+)\s*ms/)
    const sec = msMatch ? Math.round(Number(msMatch[1]) / 1000) : 120
    return `Yanıt ${sec} saniye içinde gelmedi (zaman aşımı).`
  }

  if (/high demand|try again later|overloaded|503/.test(lower)) {
    return "Model şu an çok yoğun. Talep artışı genelde geçicidir; kısa süre sonra tekrar deneyin."
  }

  if (/api key not valid|forbidden|403/.test(lower)) {
    return "API anahtarı geçersiz veya bu işlem için yetkili değil."
  }

  if (/quota exceeded|rate limit|429/.test(lower)) {
    const retryMatch = detail.match(/retry in ([\d.]+)s/i)
    if (retryMatch) {
      const sec = Math.ceil(parseFloat(retryMatch[1]))
      return `Kota veya hız limiti aşıldı — yaklaşık ${sec} saniye sonra tekrar denenebilir.`
    }
    return "Kota veya hız limiti aşıldı."
  }

  if (/invalid argument|no pages|bad request/.test(lower)) {
    return "Gönderilen dosya veya istek biçimi geçersiz."
  }

  if (/sn bekleniyor|anahtar dinleniyor/.test(lower) || /[ığüşöçİĞÜŞÖÇ]/.test(detail)) {
    return detail
  }

  return "Beklenmeyen bir hata oluştu. Kayıt zamanına bakarak tekrar deneyin."
}

function QuotaBar({
  label,
  used,
  limit,
  tooltip,
}: {
  label: string
  used: number
  limit: number
  tooltip: string
}) {
  const remaining = Math.max(0, limit - used)
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const barColor = remaining <= 0 ? "bg-rose-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500"

  return (
    <Tooltip content={tooltip}>
      <div className="space-y-1 cursor-help">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="text-slate-400 font-medium">{label}</span>
          <span className="font-mono text-slate-200 shrink-0">
            {used}/{limit}
            <span className="text-slate-500 ml-1">({remaining} kalan)</span>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Tooltip>
  )
}

export default function AdminClient({ users, reportedQuestions, sectionsQuality, stats, apiLogs, apiSummary: initialApiSummary, systemKeys }: AdminClientProps) {
  const [recentApiLogs, setRecentApiLogs] = useState(apiLogs || [])
  const [apiSummary, setApiSummary] = useState<ApiUsageDaySummary | null>(initialApiSummary ?? null)
  const [activeTab, setActiveTab] = useState<TabType>("users")
  const [userSearch, setUserSearch] = useState("")
  const [questionSearch, setQuestionSearch] = useState("")
  const [sectionSearch, setSectionSearch] = useState("")
  const [apiSearch, setApiSearch] = useState("")
  const [apiSortMethod, setApiSortMethod] = useState("default")
  const [showAllApiKeys, setShowAllApiKeys] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [jobs, setJobs] = useState<any[]>([])
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {} })

  const handleConfirmAction = (config: Omit<typeof confirmConfig, "isOpen">) => {
    setConfirmConfig({ ...config, isOpen: true })
  }

  const closeConfirm = () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))

  const router = useRouter()

  const handleRefresh = () => {
    setIsRefreshing(true)
    router.refresh()
    setTimeout(() => setIsRefreshing(false), 500)
  }
  
  // Pagination States
  const [userPage, setUserPage] = useState(1)
  const [questionPage, setQuestionPage] = useState(1)
  const [sectionPage, setSectionPage] = useState(1)
  const [apiPage, setApiPage] = useState(1)
  const [liveKeyStats, setLiveKeyStats] = useState<any | null>(null)
  const itemsPerPage = 5

  // Canlı RPM/RPD sayaçları (motor belleğinden — 5sn polling)
  useEffect(() => {
    if (activeTab !== "api_usage") return
    let cancelled = false
    const fetchLive = async () => {
      try {
        const res = await fetch("/api/admin/api-usage/live", { cache: "no-store" })
        if (res.ok && !cancelled) {
          setLiveKeyStats(await res.json())
        }
      } catch { /* sessiz */ }
    }
    fetchLive()
    const id = setInterval(fetchLive, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeTab])

  // Canlı istek akışı tablosu (veritabanından — 5sn polling)
  useEffect(() => {
    if (activeTab !== "api_usage") return
    let cancelled = false
    const fetchRecentLogs = async () => {
      try {
        const res = await fetch("/api/admin/api-usage/recent", { cache: "no-store" })
        if (res.ok && !cancelled) {
          const data = await res.json()
          if (Array.isArray(data.logs)) {
            setRecentApiLogs(data.logs)
          }
          if (data.summary) {
            setApiSummary(data.summary)
          }
        }
      } catch { /* sessiz */ }
    }
    fetchRecentLogs()
    const id = setInterval(fetchRecentLogs, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeTab])

  // Aktif Görevler Kuyruğu (3sn polling)
  useEffect(() => {
    if (activeTab !== "queue") return
    let cancelled = false
    const fetchJobs = async () => {
      try {
        const res = await fetch("/api/admin/jobs", { cache: "no-store" })
        if (res.ok && !cancelled) {
          setJobs(await res.json())
        }
      } catch { /* sessiz */ }
    }
    fetchJobs()
    const id = setInterval(fetchJobs, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeTab])

  const [activeSectionForHistory, setActiveSectionForHistory] = useState<any | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  const [isPending, startTransition] = useTransition()

  // Handle reported question resolution
  const handleResolve = async (id: string) => {
    handleConfirmAction({
      title: "Hatalı İşareti Kaldır",
      message: "Bu sorunun hatalı işaretini kaldırmak istediğinize emin misiniz?",
      confirmText: "Kaldır",
      isDestructive: false,
      onConfirm: () => {
        closeConfirm()
        startTransition(async () => {
          const res = await resolveQuestion(id)
          if (res.success) {
            router.refresh()
          } else {
            alert("Hata: " + res.error)
          }
        })
      }
    })
  }

  // Filter lists based on search
  const filteredUsers = users.filter(u =>
    (u.name || "").toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(userSearch.toLowerCase())
  )

  const filteredQuestions = reportedQuestions.filter(q =>
    q.text.toLowerCase().includes(questionSearch.toLowerCase()) ||
    (q.course?.name || "").toLowerCase().includes(questionSearch.toLowerCase()) ||
    (q.section?.title || "").toLowerCase().includes(questionSearch.toLowerCase())
  )

  const filteredSections = sectionsQuality.filter(s =>
    s.title.toLowerCase().includes(sectionSearch.toLowerCase()) ||
    (s.course?.name || "").toLowerCase().includes(sectionSearch.toLowerCase())
  )

  // Paginated Slices
  const paginatedUsers = filteredUsers.slice((userPage - 1) * itemsPerPage, userPage * itemsPerPage)
  const paginatedQuestions = filteredQuestions.slice((questionPage - 1) * itemsPerPage, questionPage * itemsPerPage)
  const paginatedSections = filteredSections.slice((sectionPage - 1) * itemsPerPage, sectionPage * itemsPerPage)

  // Page Counts
  const userTotalPages = Math.ceil(filteredUsers.length / itemsPerPage) || 1
  const questionTotalPages = Math.ceil(filteredQuestions.length / itemsPerPage) || 1
  const sectionTotalPages = Math.ceil(filteredSections.length / itemsPerPage) || 1

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <ShieldAlert className="w-8 h-8 text-indigo-400" />
              Yönetici Paneli
            </h1>
            <p className="text-slate-400 mt-2">Platform genelindeki kullanıcı aktiviteleri, kalite kontrol metrikleri ve gerçek zamanlı yapay zeka (API) kullanım süreçleri.</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleRefresh}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors font-medium border border-indigo-500/20"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Yenile
            </button>
            <Link href="/" className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-sm font-medium border border-white/10 flex items-center gap-2">
              <ChevronLeft className="w-4 h-4" />
              Platforma Dön
            </Link>
          </div>
        </div>
        {/* İstatistikler */}
        {activeTab === "users" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <Users className="w-6 h-6 text-indigo-400 mb-4" />
              <div className="text-4xl font-bold">{stats.totalUsers}</div>
              <div className="text-sm text-slate-400 mt-1">Toplam Kullanıcı</div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <Activity className="w-6 h-6 text-emerald-400 mb-4" />
              <div className="text-4xl font-bold">{stats.activeToday}</div>
              <div className="text-sm text-slate-400 mt-1">Bugün Aktif Kullanıcılar</div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <Target className="w-6 h-6 text-amber-400 mb-4" />
              <div className="text-4xl font-bold">{stats.totalMockExams}</div>
              <div className="text-sm text-slate-400 mt-1">Çözülen Toplam Deneme</div>
            </div>
          </div>
        )}

        {activeTab === "reported" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <AlertTriangle className="w-6 h-6 text-amber-400 mb-4" />
              <div className="text-4xl font-bold">{reportedQuestions.length}</div>
              <div className="text-sm text-slate-400 mt-1">Toplam İhbar Edilen Soru</div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <Clock className="w-6 h-6 text-rose-400 mb-4" />
              <div className="text-4xl font-bold">{reportedQuestions.length}</div>
              <div className="text-sm text-slate-400 mt-1">Bekleyen İşlem</div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 mb-4" />
              <div className="text-4xl font-bold">0</div>
              <div className="text-sm text-slate-400 mt-1">Bugün Çözülenler</div>
            </div>
          </div>
        )}

        {activeTab === "quality" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <BookOpen className="w-6 h-6 text-indigo-400 mb-4" />
              <div className="text-4xl font-bold">{sectionsQuality.length}</div>
              <div className="text-sm text-slate-400 mt-1">Tüm Sistemdeki Notlar</div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <Check className="w-6 h-6 text-emerald-400 mb-4" />
              <div className="text-4xl font-bold">{sectionsQuality.filter(s => s.processed).length}</div>
              <div className="text-sm text-slate-400 mt-1">Onaylı / Kaliteli Notlar</div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all">
              <AlertCircle className="w-6 h-6 text-amber-400 mb-4" />
              <div className="text-4xl font-bold">{sectionsQuality.filter(s => s.verificationScore !== null && s.verificationScore < 95).length}</div>
              <div className="text-sm text-slate-400 mt-1">Kusurlu Bulunan Notlar</div>
            </div>
          </div>
        )}

        {activeTab === "api_usage" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(() => {
              const activeSystemKeys = systemKeys || []
              const totalReqs = apiSummary?.todayTotal ?? 0
              const total429 = apiSummary?.today429 ?? 0
              const deadKeysCount = apiSummary?.deadKeysCount ?? activeSystemKeys.filter((_, idx) => {
                const masked = `Key #${idx + 1}`
                return recentApiLogs.some((l: any) => l.apiKey === masked && l.status === "FORBIDDEN_403")
              }).length
              const healthyKeysCount = apiSummary?.healthyKeysCount ?? Math.max(0, activeSystemKeys.length - deadKeysCount)

              return (
                <>
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] relative overflow-hidden">
                    <Database className="w-6 h-6 text-indigo-400 mb-4" />
                    <div className="text-3xl font-bold mb-1">{totalReqs}</div>
                    <div className="text-sm text-slate-400 mb-4">Bugünkü Toplam API İsteği</div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      {/* Hedef 10000 varsayıyoruz sistem genel limiti olarak */}
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (totalReqs / 10000) * 100)}%` }}></div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5 text-right">Hedef Kapasite Doluluğu: %{Math.min(100, Math.round((totalReqs / 10000) * 100))}</div>
                  </div>
                  
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] relative overflow-hidden">
                    <Activity className="w-6 h-6 text-emerald-400 mb-4" />
                    <div className="text-3xl font-bold mb-1 flex items-baseline gap-2">
                      {healthyKeysCount} <span className="text-sm text-slate-500 font-medium">/ {activeSystemKeys.length}</span>
                    </div>
                    <div className="text-sm text-slate-400 mb-4">Aktif Anahtar Durumu {deadKeysCount > 0 && <span className="text-rose-400 font-bold ml-1">({deadKeysCount} Ölü)</span>}</div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full ${(healthyKeysCount / Math.max(1, activeSystemKeys.length)) > 0.5 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${(healthyKeysCount / Math.max(1, activeSystemKeys.length)) * 100}%` }}></div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5 text-right">Sistem Sağlığı: %{Math.round((healthyKeysCount / Math.max(1, activeSystemKeys.length)) * 100)}</div>
                  </div>

                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] relative overflow-hidden">
                    <AlertTriangle className="w-6 h-6 text-rose-400 mb-4" />
                    <div className="text-3xl font-bold mb-1">{total429}</div>
                    <div className="text-sm text-slate-400 mb-4">Rate Limit Engeli (429 Hiti)</div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, (total429 / Math.max(1, totalReqs)) * 100)}%` }}></div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5 text-right">Hata Riski: %{Math.round((total429 / Math.max(1, totalReqs)) * 100)}</div>
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* Sekme Menüsü (Tabs) */}
        <div className="flex border-b border-white/10 p-1 bg-white/[0.01] rounded-xl max-w-2xl">
          <button
            onClick={() => setActiveTab("users")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === "users"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white"
              }`}
          >
            <Users className="w-4 h-4" />
            Öğrenciler
          </button>

          <button
            onClick={() => setActiveTab("reported")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all relative ${activeTab === "reported"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white"
              }`}
          >
            <AlertTriangle className="w-4 h-4" />
            Hatalı Sorular
            {reportedQuestions.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-slate-950">
                {reportedQuestions.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("quality")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === "quality"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white"
              }`}
          >
            <BookOpen className="w-4 h-4" />
            Not Kalitesi
          </button>

          <button
            onClick={() => setActiveTab("api_usage")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === "api_usage"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white"
              }`}
          >
            <Database className="w-4 h-4" />
            API Kullanımı
          </button>

          <button
            onClick={() => setActiveTab("queue")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === "queue"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white"
              }`}
          >
            <Server className="w-4 h-4" />
            Aktif Üretimler
          </button>
        </div>

        {/* SEKMELİ İÇERİK ALANLARI */}
        <div className="space-y-6">

          {/* TAB 1: ÖĞRENCİLER */}
          {activeTab === "users" && (
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Users className="w-6 h-6 text-indigo-400" />
                  <h2 className="text-xl font-bold">Öğrenci Listesi</h2>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 focus-within:border-indigo-500 transition-colors w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="text"
                    placeholder="Öğrenci ara..."
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
                    className="bg-transparent w-full text-sm text-white focus:outline-none placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="py-3 px-4 font-medium">Kullanıcı</th>
                      <th className="py-3 px-4 font-medium">Rol</th>
                      <th className="py-3 px-4 font-medium">Çalışma Serisi</th>
                      <th className="py-3 px-4 font-medium">Çözülen Soru</th>
                      <th className="py-3 px-4 font-medium">Son Görülme</th>
                      <th className="py-3 px-4 font-medium">Kayıt Tarihi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 text-sm">Kullanıcı bulunamadı.</td>
                      </tr>
                    ) : (
                      paginatedUsers.map((user) => (
                        <tr key={user.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-4 px-4">
                            <div className="font-bold">{user.name || "İsimsiz"}</div>
                            <div className="text-xs text-slate-500">{user.email}</div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${user.role === "admin" ? "bg-indigo-500/20 text-indigo-400" : "bg-white/10 text-slate-400"
                              }`}>
                              {user.role}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1">
                              <Flame className="w-4 h-4 text-amber-400" />
                              <span className="font-bold">{user.currentStreak} gün</span>
                            </div>
                          </td>
                          <td className="py-4 px-4 font-mono text-sm">{user._count.questionAnswers}</td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1.5 text-sm text-slate-300">
                              <Clock className="w-3.5 h-3.5 text-slate-500" />
                              {new Date(user.lastActiveAt).toLocaleDateString("tr-TR")}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-sm text-slate-500">
                            {new Date(user.createdAt).toLocaleDateString("tr-TR")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {userTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-xs text-slate-400">Sayfa {userPage} / {userTotalPages} ({filteredUsers.length} öğrenci)</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setUserPage(p => Math.max(1, p - 1))}
                      disabled={userPage === 1}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                      disabled={userPage === userTotalPages}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: AKTİF ÜRETİMLER (QUEUE) */}
          {activeTab === "queue" && (
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Server className="w-6 h-6 text-indigo-400" />
                  <h2 className="text-xl font-bold">Kuyruk Yöneticisi (Aktif API İşlemleri)</h2>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="py-3 px-4 font-medium">Kurs / PDF</th>
                      <th className="py-3 px-4 font-medium">Durum</th>
                      <th className="py-3 px-4 font-medium">Başlangıç</th>
                      <th className="py-3 px-4 font-medium">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500 text-sm">Şu an arka planda çalışan veya bekleyen bir işlem yok.</td>
                      </tr>
                    ) : (
                      jobs.map((job) => (
                        <tr key={job.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-4 px-4">
                            {job.programSlug && job.courseSlug ? (
                              <a 
                                href={`/program/${job.programSlug}/${job.courseSlug}`} 
                                target="_blank" 
                                className="hover:text-indigo-400 transition-colors flex flex-col"
                              >
                                <span className="text-xs text-slate-400 font-medium mb-1">{job.programName || "Program"}</span>
                                <span className="font-semibold">{job.courseName}</span>
                              </a>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-xs text-slate-400 font-medium mb-1">{job.programName || "Program"}</span>
                                <span className="font-semibold">{job.courseName}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex flex-col gap-1">
                              <span className={`px-2 py-1 rounded text-xs font-bold w-fit ${job.status === "processing" ? "bg-amber-500/20 text-amber-400 animate-pulse" : job.status === "pausing" ? "bg-rose-500/20 text-rose-400 animate-pulse" : job.status === "failed" ? "bg-red-500/20 text-red-400" : "bg-slate-500/20 text-slate-400"}`}>
                                {job.status === "processing" ? "Üretiliyor" : job.status === "pausing" ? "Duraklatılıyor..." : job.status === "failed" ? "Hata (Durduruldu)" : "Kuyrukta Bekliyor"}
                              </span>
                              {job.phaseLabel && job.status === "processing" && (
                                <span className="text-[10px] text-blue-300/80 font-medium truncate max-w-[200px]" title={job.phaseLabel}>
                                  {job.phaseLabel}
                                </span>
                              )}
                              {job.status === "failed" && job.error && (
                                <span className="text-[10px] text-red-300/80 font-medium max-w-[250px]" title={job.error}>
                                  API Hatası: {job.error}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-sm text-slate-500">
                            {new Date(job.createdAt).toLocaleString("tr-TR")}
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              {(job.status === "processing" || job.status === "pausing") && (
                                <button
                                  onClick={() => {
                                    handleConfirmAction({
                                      title: "Görevi Duraklat",
                                      message: "Bu görevi geçici olarak duraklatmak istediğinize emin misiniz? İşlem API tüketimini kesecek ve kaldığı yerden devam ettirilebilir.",
                                      confirmText: "Evet, Duraklat",
                                      isDestructive: false,
                                      onConfirm: async () => {
                                        closeConfirm()
                                        setJobs(prevJobs => prevJobs.map(j => j.id === job.id ? { ...j, status: "pausing" } : j));
                                        await fetch("/api/admin/jobs", {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ id: job.id, courseSlug: job.courseSlug, action: "pause" })
                                        });
                                      }
                                    })
                                  }}
                                  disabled={job.status === "pausing"}
                                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${job.status === "pausing" ? "bg-amber-500/5 text-amber-500/50 cursor-not-allowed" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}
                                >
                                  {job.status === "pausing" ? "Duraklatılıyor..." : "Duraklat"}
                                </button>
                              )}
                              {job.status === "failed" && (
                                <button
                                  onClick={async () => {
                                    setJobs(prev => prev.filter(j => j.id !== job.id));
                                    await fetch("/api/admin/jobs", {
                                      method: "DELETE",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ id: job.id })
                                    });
                                    await fetch("/api/courses/process", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ slug: job.courseSlug, forceRetry: true })
                                    });
                                  }}
                                  className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-md text-xs font-bold transition-colors"
                                >
                                  Tekrar Dene
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  handleConfirmAction({
                                    title: "Görevi İptal Et / Durdur",
                                    message: "Bu görevi tamamen iptal etmek istediğinize emin misiniz? Görev kuyruktan silinecek.",
                                    confirmText: "Evet, İptal Et",
                                    isDestructive: true,
                                    onConfirm: async () => {
                                      closeConfirm()
                                      setJobs(prev => prev.filter(j => j.id !== job.id));
                                      await fetch("/api/admin/jobs", {
                                        method: "DELETE",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ id: job.id, courseSlug: job.courseSlug })
                                      });
                                    }
                                  })
                                }}
                                className="px-3 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-md text-xs font-bold transition-colors"
                              >
                                İptal Et
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: HATALI SORULAR */}
          {activeTab === "reported" && (
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                  <h2 className="text-xl font-bold">Bildirilen Soru İhbarları ({reportedQuestions.length})</h2>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 focus-within:border-indigo-500 transition-colors w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="text"
                    placeholder="Soru veya ders ara..."
                    value={questionSearch}
                    onChange={(e) => { setQuestionSearch(e.target.value); setQuestionPage(1); }}
                    className="bg-transparent w-full text-sm text-white focus:outline-none placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="py-3 px-4 font-medium">Bölüm / Ders</th>
                      <th className="py-3 px-4 font-medium w-1/3">Soru Açıklaması</th>
                      <th className="py-3 px-4 font-medium">Seçenekler & Doğru Cevap</th>
                      <th className="py-3 px-4 font-medium text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedQuestions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500 text-sm">Herhangi bir soru ihbarı bulunamadı.</td>
                      </tr>
                    ) : (
                      paginatedQuestions.map((q) => {
                        let parsedOptions: string[] = []
                        try {
                          parsedOptions = JSON.parse(q.options)
                        } catch {
                          parsedOptions = []
                        }
                        return (
                          <tr key={q.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                            <td className="py-4 px-4 text-sm">
                              {q.course?.program?.slug && q.course?.slug ? (
                                <Link
                                  href={`/program/${q.course.program.slug}/${q.course.slug}`}
                                  className="hover:underline hover:text-indigo-400 group flex flex-col"
                                >
                                  <span className="font-bold text-indigo-300 group-hover:text-indigo-200">
                                    {q.course.name} {q.section?.module && `• ${q.section.module}`} {q.course.program.name && `• ${q.course.program.name}`}
                                  </span>
                                  <span className="text-xs text-slate-500 mt-1">{q.section?.title || "Bilinmeyen Bölüm"}</span>
                                </Link>
                              ) : (
                                <>
                                  <div className="font-bold text-indigo-300">
                                    {q.course?.name || "Bilinmeyen Ders"} {q.section?.module && `• ${q.section.module}`} {q.course?.program?.name && `• ${q.course.program.name}`}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1">{q.section?.title || "Bilinmeyen Bölüm"}</div>
                                </>
                              )}
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-sm font-semibold">{q.text}</p>
                              {q.explanation && (
                                <p className="text-xs text-slate-400 mt-2 bg-slate-900/50 p-2 rounded border border-white/[0.03] italic">
                                  {q.explanation}
                                </p>
                              )}
                            </td>
                            <td className="py-4 px-4 text-xs space-y-1">
                              {parsedOptions.map((opt, oIdx) => (
                                <div key={oIdx} className={`p-1 rounded ${opt.startsWith(q.correct) ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400'}`}>
                                  {opt}
                                </div>
                              ))}
                            </td>
                            <td className="py-4 px-4 text-right">
                              <button
                                onClick={() => handleResolve(q.id)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all font-medium text-xs disabled:opacity-50"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Düzeltildi
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {questionTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-xs text-slate-400">Sayfa {questionPage} / {questionTotalPages} ({filteredQuestions.length} soru)</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setQuestionPage(p => Math.max(1, p - 1))}
                      disabled={questionPage === 1}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setQuestionPage(p => Math.min(questionTotalPages, p + 1))}
                      disabled={questionPage === questionTotalPages}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: NOT KALİTESİ */}
          {activeTab === "quality" && (
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-6 h-6 text-indigo-400" />
                  <h2 className="text-xl font-bold">Ders Notu Kalite & Kontrolör Takip Paneli</h2>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 focus-within:border-indigo-500 transition-colors w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="text"
                    placeholder="Bölüm veya ders ara..."
                    value={sectionSearch}
                    onChange={(e) => { setSectionSearch(e.target.value); setSectionPage(1); }}
                    className="bg-transparent w-full text-sm text-white focus:outline-none placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="py-3 px-4 font-medium">Bölüm / Ders</th>
                      <th className="py-3 px-4 font-medium text-center">Durum</th>
                      <th className="py-3 px-4 font-medium text-center">Denetim Skorları</th>
                      <th className="py-3 px-4 font-medium">Tespit Edilen Kılcal Eksikler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSections.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500 text-sm">Bölüm bulunamadı.</td>
                      </tr>
                    ) : (
                      paginatedSections.map((sec) => {
                        const issuesObj = parseQualityIssues(sec.verificationIssues)
                        const stages = deriveQualityStages(issuesObj, sec.verificationScore ?? -1, sec.processed)

                        const score = sec.verificationScore ?? -1
                        const isOK = score === 100
                        const mufettisPassed = stages.mufettis
                        const issuesList = [
                          ...(issuesObj.missingTopics || []).map((t: string) => `Eksik: ${t}`),
                          ...(issuesObj.issues || []).map((i: string) => `Hata: ${i}`),
                          ...(issuesObj.auditResult?.missingDetails || []).map((d: string) => `Detay Eksiği: ${d}`),
                          ...(issuesObj.auditResult?.contradictions || []).map((c: string) => `Çelişki: ${c}`)
                        ]

                        return (
                          <tr key={sec.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                            <td className="py-4 px-4">
                              {sec.course?.program?.slug && sec.course?.slug ? (
                                <Link
                                  href={`/program/${sec.course.program.slug}/${sec.course.slug}`}
                                  className="hover:underline hover:text-indigo-400 group flex flex-col"
                                >
                                  <span className="font-bold text-sm text-slate-200 group-hover:text-indigo-300">
                                    {sec.title}
                                  </span>
                                  <span className="text-xs text-slate-500 mt-1">
                                    {sec.course.name} {sec.module && `• ${sec.module}`} {sec.course.program.name && `• ${sec.course.program.name}`}
                                  </span>
                                </Link>
                              ) : (
                                <>
                                  <div className="font-bold text-sm text-slate-200">{sec.title}</div>
                                  <div className="text-xs text-slate-500 mt-1">
                                    {sec.course?.name} {sec.module && `• ${sec.module}`} {sec.course?.program?.name && `• ${sec.course.program.name}`}
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="py-4 px-4 text-center">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${sec.processed
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                }`}>
                                {sec.processed ? "Onaylandı" : "İşleniyor"}
                              </span>
                            </td>
                            <td 
                              className={`py-4 px-4 text-center font-mono font-bold select-none transition-all ${
                                score !== -1 
                                  ? "cursor-pointer hover:bg-white/[0.04] active:scale-95" 
                                  : ""
                              }`}
                              onClick={() => {
                                if (score !== -1) {
                                  setActiveSectionForHistory(sec)
                                }
                              }}
                            >
                              <Tooltip content={score !== -1 ? "Detaylı Zaman Tüneli Raporunu Aç" : "Henüz Puanlanmadı"}>
                                {score === -1 ? (
                                  <span className="text-slate-600 text-xs">Puanlanmadı</span>
                                ) : (
                                  <div className="flex flex-col items-center gap-1.5">
                                    <span className={`text-xs ${isOK ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-1`}>
                                      🔍 Kontrolör: %{score}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded font-sans tracking-wide font-bold ${
                                      mufettisPassed
                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" 
                                        : stages.kontrolorGroundTruth && !sec.processed
                                          ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    }`}>
                                      Müfettiş: {mufettisPassed ? "GEÇTİ" : stages.kontrolorGroundTruth ? "BEKLİYOR" : "KALDI"}
                                    </span>
                                  </div>
                                )}
                              </Tooltip>
                            </td>
                            <td 
                              className={`py-4 px-4 text-xs text-slate-400 select-none transition-all ${
                                issuesList.length > 0 
                                  ? "cursor-pointer hover:bg-white/[0.04] active:scale-95" 
                                  : ""
                              }`}
                              onClick={() => {
                                if (issuesList.length > 0) {
                                  setActiveSectionForHistory(sec)
                                } else if (score !== -1) {
                                  setActiveSectionForHistory(sec)
                                }
                              }}
                            >
                              <Tooltip content={issuesList.length > 0 ? "Eksik Bulgu Raporunu Aç" : "Detayları İncele"}>
                                {score === -1 ? (
                                  <div className="flex items-center gap-1 text-slate-500 font-medium italic">
                                    <Clock className="w-3.5 h-3.5 text-slate-600" />
                                    Eksik analizi bekleniyor...
                                  </div>
                                ) : issuesList.length === 0 ? (
                                  <div className="flex items-center gap-1 text-emerald-400 font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Kusursuz (Eksik Yok)
                                  </div>
                                ) : (
                                  <ul className="list-disc pl-4 space-y-1 text-slate-400 max-w-md">
                                    {issuesList.slice(0, 3).map((item, idx) => (
                                      <li key={idx} className="truncate">{item}</li>
                                    ))}
                                    {issuesList.length > 3 && (
                                      <li className="text-indigo-400 font-semibold list-none pl-0 mt-1">
                                        + {issuesList.length - 3} adet daha bulgu mevcut.
                                      </li>
                                    )}
                                  </ul>
                                )}
                              </Tooltip>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {sectionTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-xs text-slate-400">Sayfa {sectionPage} / {sectionTotalPages} ({filteredSections.length} bölüm)</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSectionPage(p => Math.max(1, p - 1))}
                      disabled={sectionPage === 1}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setSectionPage(p => Math.min(sectionTotalPages, p + 1))}
                      disabled={sectionPage === sectionTotalPages}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: API USAGE */}
          {activeTab === "api_usage" && (
            <div className="space-y-6">
              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-3">
                    <Zap className="w-6 h-6 text-amber-400" />
                    <div>
                      <h2 className="text-xl font-bold">Gerçek Zamanlı API Anahtar Durumları</h2>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Ücretsiz tier: <span className="font-bold text-slate-300">{liveKeyStats?.rpmLimit ?? 9} RPM</span> / dk / anahtar · 3.5-flash <span className="font-bold text-blue-300">~18/gün</span> · 2.5-flash <span className="font-bold text-violet-300">~240/gün</span> (PT günü: {liveKeyStats?.pacificDay ?? "—"}).<br/>
                        Sayaçlar canlı motor belleğinden okunur; sunucu yeniden başlayınca günlük sayaç kayıt tablosundan yüklenir. Canlı akış tablosu 5 saniyede bir yenilenir.
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0">
                    <div className="relative">
                      <select
                        value={apiSortMethod}
                        onChange={(e) => setApiSortMethod(e.target.value)}
                        className="appearance-none bg-white/5 border border-white/10 rounded-xl pl-4 pr-10 py-2.5 text-sm font-medium text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 cursor-pointer shadow-sm hover:bg-white/10 transition-all"
                      >
                        <option value="default" className="bg-[#090d16]">Varsayılan Sıralama (Key 1-18)</option>
                        <option value="rpd_asc" className="bg-[#090d16]">Günlük Limiti Azalanlar</option>
                        <option value="rpm_asc" className="bg-[#090d16]">Dakikalık Limiti Azalanlar</option>
                        <option value="errors_desc" className="bg-[#090d16]">En Çok Hata Alanlar (429)</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                        <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {(() => {
                    const apiLogsList = recentApiLogs || []
                    const rpmLimit = liveKeyStats?.rpmLimit ?? 9
                    const rpdLimit = liveKeyStats?.rpdLimit ?? 240
                    const liveKeys = liveKeyStats?.keys ?? []
                    const errorCounts: Record<string, number> = {}
                    apiLogsList.forEach((log: any) => {
                      if (log.status === "RATE_LIMIT_429") {
                        errorCounts[log.apiKey] = (errorCounts[log.apiKey] || 0) + 1
                      }
                    })

                    const entries = liveKeys.length > 0
                      ? liveKeys.map((lk: any) => {
                          const m35 = lk.models?.find((m: any) => m.modelId === "gemini-3.5-flash") || lk.models?.[0]
                          const m25 = lk.models?.find((m: any) => m.modelId === "gemini-2.5-flash")
                          const dailyUsed = Math.max(m35?.rpdUsed ?? 0, m25?.rpdUsed ?? 0)
                          const minuteUsed = Math.max(m35?.rpmUsed ?? 0, m25?.rpmUsed ?? 0)
                          return [lk.keyLabel, {
                            dailySuccess: dailyUsed,
                            minuteSuccess: minuteUsed,
                            dailyLimitHit: errorCounts[lk.keyLabel] || 0,
                            suspended: lk.suspended,
                            models: lk.models,
                          }] as [string, any]
                        })
                      : (systemKeys || []).map((_, idx) => [`Key #${idx + 1}`, { dailySuccess: 0, minuteSuccess: 0, dailyLimitHit: 0, models: [] }])

                    let sorted = [...entries]
                    if (apiSortMethod === "rpd_asc") {
                      sorted.sort((a, b) => b[1].dailySuccess - a[1].dailySuccess)
                    } else if (apiSortMethod === "rpm_asc") {
                      sorted.sort((a, b) => b[1].minuteSuccess - a[1].minuteSuccess)
                    } else if (apiSortMethod === "errors_desc") {
                      sorted.sort((a, b) => b[1].dailyLimitHit - a[1].dailyLimitHit)
                    }

                    const displayLimit = 8
                    const hasMore = sorted.length > displayLimit
                    const displayList = showAllApiKeys ? sorted : sorted.slice(0, displayLimit)

                    return (
                      <>
                        {displayList.map(([key, data]: [string, any]) => {
                          const models: Array<{ modelId: string; rpmUsed: number; rpdUsed: number }> =
                            data.models?.length > 0
                              ? data.models
                              : [
                                  { modelId: "gemini-3.5-flash", rpmUsed: data.minuteSuccess ?? 0, rpdUsed: data.dailySuccess ?? 0 },
                                ]

                          const primary = models.find((m) => m.modelId === "gemini-3.5-flash") ?? models[0]
                          const dailyRemaining = Math.max(0, rpdLimit - (primary?.rpdUsed ?? 0))
                          const minuteRemaining = Math.max(0, rpmLimit - (primary?.rpmUsed ?? 0))
                          const isFull = data.suspended || dailyRemaining <= 0 || minuteRemaining <= 0
                          const statusText = data.suspended ? "Askıda" : dailyRemaining <= 0 ? "Günlük Doldu" : minuteRemaining <= 0 ? "Dk. Doldu" : "Aktif"

                          return (
                            <div
                              key={key}
                              className={`p-4 rounded-xl border transition-all flex flex-col gap-3 min-w-0 ${
                                isFull ? "bg-rose-500/5 border-rose-500/20" : "bg-white/[0.02] border-white/[0.05] hover:border-white/[0.10]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
                                <div className="font-bold text-sm tracking-wide text-slate-200 truncate">{key}</div>
                                <span
                                  className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isFull
                                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                      : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  }`}
                                >
                                  {statusText}
                                </span>
                              </div>

                              <div className="space-y-3">
                                {models.map((m) => {
                                  const modelName = MODEL_LABELS[m.modelId] ?? m.modelId
                                  const is35 = m.modelId === "gemini-3.5-flash"
                                  return (
                                    <div
                                      key={m.modelId}
                                      className={`rounded-lg px-3 py-2.5 space-y-2.5 ${
                                        is35 ? "bg-blue-500/5 border border-blue-500/15" : "bg-violet-500/5 border border-violet-500/15"
                                      }`}
                                    >
                                      <div className={`text-xs font-semibold ${is35 ? "text-blue-300" : "text-violet-300"}`}>
                                        {modelName}
                                      </div>
                                      <QuotaBar
                                        label="Bu dakika"
                                        used={m.rpmUsed}
                                        limit={rpmLimit}
                                        tooltip={`${modelName} — Bu dakikada ${m.rpmUsed} istek atıldı, ${Math.max(0, rpmLimit - m.rpmUsed)} hak kaldı (limit ${rpmLimit}/dk)`}
                                      />
                                      <QuotaBar
                                        label="Bugün"
                                        used={m.rpdUsed}
                                        limit={m.modelId === "gemini-3.5-flash" ? (liveKeyStats?.rpdLimit35 ?? 18) : (liveKeyStats?.rpdLimit ?? 240)}
                                        tooltip={`${modelName} — Bugün ${m.rpdUsed} istek atıldı, ${Math.max(0, rpdLimit - m.rpdUsed)} hak kaldı (limit ${rpdLimit}/gün, PT takvimi)`}
                                      />
                                    </div>
                                  )
                                })}
                              </div>

                              <div className="pt-2 border-t border-white/[0.06] flex justify-between items-center gap-2 text-[10px] text-slate-400">
                                <span>
                                  Bugün 429: <strong className="text-rose-400">{data.dailyLimitHit}</strong>
                                </span>
                                {liveKeyStats?.serverTime && (
                                  <span className="text-[9px] text-slate-500 shrink-0">
                                    {new Date(liveKeyStats.serverTime).toLocaleTimeString("tr-TR")}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {hasMore && (
                          <div className="col-span-full flex justify-center mt-2">
                            <button
                              onClick={() => setShowAllApiKeys(!showAllApiKeys)}
                              className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-semibold transition-colors flex items-center gap-2 text-slate-300"
                            >
                              {showAllApiKeys ? "Daha Az Göster" : `Tüm Anahtarları Göster (${sorted.length})`}
                            </button>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Database className="w-6 h-6 text-indigo-400" />
                    <h2 className="text-xl font-bold">Canlı İstek Akışı</h2>
                    <p className="text-[10px] text-slate-500 mt-1">5 saniyede bir otomatik yenilenir</p>
                  </div>
                  <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 focus-within:border-indigo-500 transition-colors w-full sm:w-64">
                    <Search className="w-4 h-4 text-slate-500 shrink-0" />
                    <input
                      type="text"
                      placeholder="Anahtar veya işlem ara..."
                      value={apiSearch}
                      onChange={(e) => { setApiSearch(e.target.value); setApiPage(1); }}
                      className="bg-transparent w-full text-sm text-white focus:outline-none placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 text-sm">
                        <th className="py-3 px-4 font-medium">Zaman</th>
                        <th className="py-3 px-4 font-medium">Anahtar & Model</th>
                        <th className="py-3 px-4 font-medium">İşlem & Olay Yeri</th>
                        <th className="py-3 px-4 font-medium">Sonuç</th>
                        <th className="py-3 px-4 font-medium text-right">Süre (ms)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const apiLogsList = recentApiLogs || []
                        const filtered = apiLogsList.filter((l: any) => l.apiKey.toLowerCase().includes(apiSearch.toLowerCase()) || l.operation.toLowerCase().includes(apiSearch.toLowerCase()) || (l.courseSlug || "").toLowerCase().includes(apiSearch.toLowerCase()) || (l.courseFullName || "").toLowerCase().includes(apiSearch.toLowerCase()))
                        const paginated = filtered.slice((apiPage - 1) * 10, apiPage * 10)
                        const totalPages = Math.ceil(filtered.length / 10) || 1

                        if (paginated.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-slate-500 text-sm space-y-1">
                                <div>Henüz kayıt yok veya arama sonucu boş.</div>
                                <div className="text-[11px] text-slate-600 max-w-md mx-auto leading-relaxed">
                                  PDF okuma, not, soru ve kart istekleri burada görünür. Yoğunluk beklemeleri gri renkle gösterilir; kırmızı yalnızca gerçek hatalar içindir.
                                </div>
                              </td>
                            </tr>
                          )
                        }

                        return (
                          <>
                            {paginated.map((log: any) => {
                              const logTime = formatApiLogTime(log.createdAt)
                              const [logDay, logClock] = logTime.includes(" · ") ? logTime.split(" · ") : [logTime, ""]
                              return (
                              <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                                <td className="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                                  <div className="font-medium text-slate-300">{logDay}</div>
                                  {logClock && <div className="text-slate-500">{logClock}</div>}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="font-bold text-sm text-slate-200">{log.apiKey}</div>
                                  <div className="inline-flex items-center gap-1.5 mt-0.5 px-2 py-0.5 rounded text-[10px] bg-slate-800/80 text-blue-300 font-mono border border-blue-500/30 shadow-sm">
                                    <Bot className="w-3 h-3 text-blue-400" />
                                    <span>{MODEL_LABELS[log.model] ?? log.model}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-col gap-1.5 min-w-[220px]">
                                    <div className="inline-flex items-center gap-1.5 w-fit px-2.5 py-1 rounded text-xs font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-200">
                                      {getApiOperationLabel(log.operation)}
                                    </div>
                                    <div className="flex flex-col gap-0.5 pl-2 border-l-2 border-indigo-500/30">
                                      {(() => {
                                        const nameToParse = log.courseFullName || log.courseSlug || "";
                                        const parts = nameToParse.includes(" > ") ? nameToParse.split(" > ") : nameToParse.split(" - ");
                                        
                                        let program = "-";
                                        let ders = "-";
                                        let konu = "-";

                                        if (parts.length >= 3) {
                                          program = parts[0];
                                          ders = parts[1];
                                          konu = parts.slice(2).join(" > ");
                                        } else if (parts.length === 2) {
                                          // 2 parçalı yapılarda ilki Ders, ikincisi Konudur
                                          ders = parts[0];
                                          konu = parts[1];
                                        } else {
                                          ders = parts[0] || "-";
                                        }
                                        
                                        return (
                                          <>
                                            {program !== "-" && (
                                              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                                <span className="font-semibold text-slate-400 w-11">Lisans:</span> 
                                                <span className="truncate max-w-[180px]">{program.trim()}</span>
                                              </div>
                                            )}
                                            {ders !== "-" && (
                                              <div className="text-[10px] text-indigo-300 flex items-center gap-1">
                                                <span className="font-semibold text-slate-400 w-11">Ders:</span> 
                                                <Tooltip content={ders.trim()}>
                                                  <span className="truncate max-w-[180px] cursor-help">{ders.trim()}</span>
                                                </Tooltip>
                                              </div>
                                            )}
                                            {konu !== "-" && (
                                              <div className="text-[10px] text-emerald-400/80 flex items-center gap-1">
                                                <span className="font-semibold text-slate-400 w-11">Konu:</span> 
                                                <Tooltip content={konu.trim()}>
                                                  <span className="truncate max-w-[180px] cursor-help">
                                                    {konu.trim().split(' ').map((w: string) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1).toLocaleLowerCase('tr-TR')).join(' ')}
                                                  </span>
                                                </Tooltip>
                                              </div>
                                            )}
                                          </>
                                        )
                                      })()}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-col gap-1 items-start">
                                    {(() => {
                                      const statusTone = getApiStatusTone(log.status)
                                      return (
                                        <>
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${API_STATUS_BADGE_CLASS[statusTone]}`}>
                                      {getApiStatusLabel(log.status)}
                                    </span>
                                    {log.status === 'RATE_LIMIT_429' && (
                                      <div className="max-w-[200px] text-[9px] text-amber-400/90 leading-snug bg-amber-500/5 px-2 py-1.5 rounded border border-amber-500/10 mt-1">
                                        <span className="font-bold block mb-0.5">Kota doldu (429)</span>
                                        Dakikalık, token veya günlük limitlerden biri dolmuş olabilir.
                                      </div>
                                    )}
                                    {log.errorDetail && log.status !== 'SUCCESS' && log.status !== 'RATE_LIMIT_429' && (
                                      <div className={`max-w-[200px] text-[9px] leading-snug px-2 py-1 rounded border mt-1 ${statusTone === 'pending' ? 'text-slate-400/90 bg-slate-500/5 border-slate-500/10' : 'text-rose-400/80 bg-rose-500/5 border-rose-500/10'}`}>
                                        <span className="font-semibold block mb-0.5 opacity-80">{statusTone === 'pending' ? 'Bekleme notu:' : 'Hata detayı:'}</span>
                                        {translateApiErrorDetail(log.errorDetail)}
                                      </div>
                                    )}
                                        </>
                                      )
                                    })()}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right text-xs font-mono text-slate-400">
                                  {log.durationMs ? `${log.durationMs}ms` : "-"}
                                </td>
                              </tr>
                            )})}
                            {totalPages > 1 && (
                              <tr>
                                <td colSpan={5} className="py-3 px-4 border-t border-white/5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">Sayfa {apiPage} / {totalPages} ({filtered.length} kayıt)</span>
                                    <div className="flex gap-2">
                                      <button onClick={() => setApiPage(p => Math.max(1, p - 1))} disabled={apiPage === 1} className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 hover:bg-white/10 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                                      <button onClick={() => setApiPage(p => Math.min(totalPages, p + 1))} disabled={apiPage === totalPages} className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 hover:bg-white/10 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Zaman Tüneli & Rapor Detay Modalı */}
      {mounted && createPortal(
        <AnimatePresence>
          {activeSectionForHistory && (
            <SectionQualityModal
              section={activeSectionForHistory}
              onClose={() => setActiveSectionForHistory(null)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

      <AnimatePresence>
        <ConfirmModal
          isOpen={confirmConfig.isOpen}
          onClose={closeConfirm}
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmText={confirmConfig.confirmText}
          cancelText={confirmConfig.cancelText}
          isDestructive={confirmConfig.isDestructive}
          onConfirm={confirmConfig.onConfirm}
        />
      </AnimatePresence>
    </div>
  )
}
