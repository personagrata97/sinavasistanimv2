"use client"

import { useState, useTransition, useEffect } from "react"
import { Users, Activity, Target, Clock, ShieldAlert, Flame, AlertTriangle, CheckCircle2, BookOpen, Check, ChevronLeft, ChevronRight, Search, ShieldCheck, FileText, AlertCircle, Sparkles, X, Database, Zap, RefreshCw } from "lucide-react"
import { resolveQuestion } from "@/lib/actions"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Modal } from "@/components/course/shared"
import { Tooltip, ProgressRing } from "@/components/ui/shared"
import { SectionQualityModal } from "@/components/admin/SectionQualityModal"

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
  systemKeys?: string[]
}

type TabType = "users" | "reported" | "quality" | "api_usage"

export default function AdminClient({ users, reportedQuestions, sectionsQuality, stats, apiLogs, systemKeys }: AdminClientProps) {
  const [activeTab, setActiveTab] = useState<TabType>("users")
  const [userSearch, setUserSearch] = useState("")
  const [questionSearch, setQuestionSearch] = useState("")
  const [sectionSearch, setSectionSearch] = useState("")
  const [apiSearch, setApiSearch] = useState("")
  const [apiSortMethod, setApiSortMethod] = useState("default")
  const [isRefreshing, setIsRefreshing] = useState(false)
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
  const itemsPerPage = 5

  const [activeSectionForHistory, setActiveSectionForHistory] = useState<any | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  const [isPending, startTransition] = useTransition()

  // Handle reported question resolution
  const handleResolve = async (id: string) => {
    if (confirm("Bu sorunun hatalı işaretini kaldırmak istediğinize emin misiniz?")) {
      startTransition(async () => {
        const res = await resolveQuestion(id)
        if (res.success) {
          router.refresh()
        } else {
          alert("Hata: " + res.error)
        }
      })
    }
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
              const apiLogsList = apiLogs || []
              const totalReqs = apiLogsList.length
              const total429 = apiLogsList.filter(l => l.status === "RATE_LIMIT_429").length
              
              const keyUsage = apiLogsList.filter(l => l.status === "SUCCESS").reduce((acc: Record<string, number>, log) => {
                if (!acc[log.apiKey]) acc[log.apiKey] = 0
                acc[log.apiKey]++
                return acc
              }, {})
              
              const activeSystemKeys = systemKeys || []
              const keysOverQuota = activeSystemKeys.filter((key, idx) => {
                const masked = `Key #${idx + 1}`
                return (keyUsage[masked] || 0) >= 1500
              }).length
              
              const deadKeysCount = activeSystemKeys.filter((key, idx) => {
                const masked = `Key #${idx + 1}`
                return apiLogsList.some((l: any) => l.apiKey === masked && l.status === "FORBIDDEN_403")
              }).length
              
              const healthyKeysCount = Math.max(0, activeSystemKeys.length - keysOverQuota - deadKeysCount)

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
                        let issuesObj: any = {}
                        try {
                          issuesObj = JSON.parse(sec.verificationIssues || "{}")
                        } catch {
                          issuesObj = {}
                        }

                        const score = sec.verificationScore ?? -1
                        const isOK = score >= 95
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
                                      issuesObj.auditResult?.passed 
                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" 
                                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    }`}>
                                      Müfettiş: {issuesObj.auditResult?.passed ? "GEÇTİ" : "KALDI"}
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
                        Sistem her başarılı işlemde <span className="font-bold text-slate-300">Dakikalık 15 İstek (RPM)</span>, <span className="font-bold text-slate-300">Dakikalık 1 Milyon Token (TPM)</span> ve <span className="font-bold text-slate-300">Günlük 1500 İstek (RPD)</span> limitinden düşer.<br/>
                        Kota Aşımı (429) yapay zeka servisinin o anahtara ait dakikalık (istek/token) veya günlük işlem limitinin dolduğunu, <span className="text-rose-400 font-bold">Yetkisiz Erişim (403)</span> ise anahtarın servis tarafından iptal edildiğini veya kısıtlandığını gösterir.
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
                
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                  {(() => {
                    const apiLogsList = apiLogs || []
                    const activeKeys = systemKeys || []
                    const keyStats: Record<string, any> = {}
                    const oneMinAgo = new Date(Date.now() - 60 * 1000).getTime()
                    
                    activeKeys.forEach((key, idx) => {
                      const maskedKey = `Key #${idx + 1}`
                      keyStats[maskedKey] = { total: 0, dailySuccess: 0, dailyLimitHit: 0, minuteSuccess: 0, model: "gemini-3.5-flash" }
                    })

                    apiLogsList.forEach((log: any) => {
                      if (!keyStats[log.apiKey]) {
                        keyStats[log.apiKey] = { total: 0, dailySuccess: 0, dailyLimitHit: 0, minuteSuccess: 0, model: log.model }
                      }
                      keyStats[log.apiKey].total += 1
                      keyStats[log.apiKey].model = log.model || keyStats[log.apiKey].model
                      
                      const isRecent = new Date(log.createdAt).getTime() > oneMinAgo
                      
                      if (log.status === "SUCCESS") {
                        keyStats[log.apiKey].dailySuccess += 1
                        if (isRecent) keyStats[log.apiKey].minuteSuccess += 1
                      } else if (log.status === "RATE_LIMIT_429") {
                        keyStats[log.apiKey].dailyLimitHit += 1
                      }
                    })
                    
                    let entries = Object.entries(keyStats)
                    
                    if (apiSortMethod === "rpd_asc") {
                      entries.sort((a, b) => b[1].dailySuccess - a[1].dailySuccess) // Most success = least remaining
                    } else if (apiSortMethod === "rpm_asc") {
                      entries.sort((a, b) => b[1].minuteSuccess - a[1].minuteSuccess)
                    } else if (apiSortMethod === "errors_desc") {
                      entries.sort((a, b) => b[1].dailyLimitHit - a[1].dailyLimitHit)
                    }

                    return entries.map(([key, data]: [string, any]) => {
                      const dailyRemaining = Math.max(0, 1500 - data.dailySuccess)
                      const minuteRemaining = Math.max(0, 15 - data.minuteSuccess)
                      const isFull = dailyRemaining <= 0 || minuteRemaining <= 0
                      const statusText = dailyRemaining <= 0 ? "Günlük Doldu" : (minuteRemaining <= 0 ? "Dk. Doldu" : "Aktif")
                      
                      return (
                        <div key={key} className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${isFull ? 'bg-rose-500/5 border-rose-500/20' : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.1]'}`}>
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <div className="font-bold text-sm tracking-wide text-slate-200">{key}</div>
                              <div className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[9px] bg-slate-800/80 text-blue-300 font-mono border border-blue-500/20 shadow-sm"><Sparkles className="w-2.5 h-2.5 text-blue-400" />
                                {data.model.replace("gemini-", "").replace("-flash", "")}
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded text-[10px] font-bold shadow-sm ${isFull ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                              {statusText}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center mt-auto gap-4">
                            {/* Günlük (RPD) Dairesel Gösterge */}
                            <Tooltip content={`Günlük Kalan İstek: ${dailyRemaining} / 1500`}>
                              <div className="flex flex-col items-center flex-1 cursor-help">
                                <ProgressRing 
                                  progress={Math.max(0, (dailyRemaining / 1500) * 100)} 
                                  size={46} 
                                  strokeWidth={5} 
                                  color={dailyRemaining <= 0 ? "#f43f5e" : dailyRemaining < 300 ? "#f59e0b" : "#3b82f6"} 
                                />
                                <div className="text-[10px] font-bold text-slate-400 mt-1.5 tracking-wider">RPD</div>
                              </div>
                            </Tooltip>

                            <div className="w-px h-8 bg-white/[0.08]" />
                            
                            {/* Dakikalık (RPM) Dairesel Gösterge */}
                            <Tooltip content={`Dakikalık Kalan İstek: ${minuteRemaining} / 15`}>
                              <div className="flex flex-col items-center flex-1 cursor-help">
                                <ProgressRing 
                                  progress={Math.max(0, (minuteRemaining / 15) * 100)} 
                                  size={46} 
                                  strokeWidth={5} 
                                  color={minuteRemaining <= 0 ? "#f43f5e" : minuteRemaining < 3 ? "#f59e0b" : "#10b981"} 
                                />
                                <div className="text-[10px] font-bold text-slate-400 mt-1.5 tracking-wider">RPM</div>
                              </div>
                            </Tooltip>
                          </div>
                          
                          <div className="mt-4 pt-3 border-t border-white/[0.05] flex justify-between items-center text-[10px] text-slate-400">
                            <span className="flex gap-2">Başarılı: <strong className="text-emerald-400">{data.dailySuccess}</strong></span>
                            <span className="flex gap-2 text-rose-400">429 Hata: <strong>{data.dailyLimitHit}</strong></span>
                          </div>
                          <div className="mt-2 text-[9px] text-indigo-400/80 text-center font-medium bg-indigo-500/10 py-1 rounded">
                            1M TPM Limiti Aktif
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Database className="w-6 h-6 text-indigo-400" />
                    <h2 className="text-xl font-bold">Canlı İstek Akışı</h2>
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
                        const apiLogsList = apiLogs || []
                        const filtered = apiLogsList.filter((l: any) => l.apiKey.toLowerCase().includes(apiSearch.toLowerCase()) || l.operation.toLowerCase().includes(apiSearch.toLowerCase()) || (l.courseSlug || "").toLowerCase().includes(apiSearch.toLowerCase()))
                        const paginated = filtered.slice((apiPage - 1) * 10, apiPage * 10)
                        const totalPages = Math.ceil(filtered.length / 10) || 1

                        if (paginated.length === 0) {
                          return <tr><td colSpan={5} className="py-8 text-center text-slate-500 text-sm">Henüz kayıt yok.</td></tr>
                        }

                        return (
                          <>
                            {paginated.map((log: any) => (
                              <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                                <td className="py-3 px-4 text-xs text-slate-400">
                                  {new Date(log.createdAt).toLocaleTimeString("tr-TR")}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="font-bold text-sm text-slate-200">{log.apiKey}</div>
                                  <div className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-800/80 text-blue-300 font-mono border border-blue-500/20 shadow-sm"><Sparkles className="w-3 h-3 text-blue-400" />
                                    {log.model}
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-col gap-1.5 min-w-[220px]">
                                    <div className="inline-flex items-center gap-1.5 w-fit px-2 py-0.5 rounded text-[10px] font-bold bg-white/5 border border-white/10 text-slate-300">
                                      {log.operation === 'verification' ? <><ShieldCheck className="w-3 h-3 text-emerald-400" /> DOĞRULAMA (MÜFETTİŞ)</> : 
                                       log.operation === 'generation' ? <><FileText className="w-3 h-3 text-blue-400" /> DERS NOTU ÜRETİMİ</> : 
                                       log.operation === 'notes_generation' ? <><FileText className="w-3 h-3 text-blue-400" /> DERS NOTU ÜRETİMİ</> :
                                       log.operation === 'question_generation' ? <><Target className="w-3 h-3 text-purple-400" /> SORU HAVUZU ÜRETİMİ</> :
                                       log.operation === 'flashcard' ? <><Zap className="w-3 h-3 text-amber-400" /> BİLGİ KARTI ÜRETİMİ</> : 
                                       log.operation === 'flashcard_generation' ? <><Zap className="w-3 h-3 text-amber-400" /> BİLGİ KARTI ÜRETİMİ</> : 
                                       log.operation === 'ocr_extraction' ? <><Search className="w-3 h-3 text-indigo-400" /> PDF OKUMA (OCR)</> :
                                       log.operation.toUpperCase()}
                                    </div>
                                    <div className="flex flex-col gap-0.5 pl-2 border-l-2 border-indigo-500/30">
                                      {(() => {
                                        const nameToParse = log.courseFullName || log.courseSlug || "";
                                        const parts = nameToParse.includes(" > ") ? nameToParse.split(" > ") : nameToParse.split(" - ");
                                        const program = parts.length > 2 ? parts[0] : (parts.length === 2 ? parts[0] : (nameToParse || "-"));
                                        const ders = parts.length > 2 ? parts[1] : (parts.length === 2 ? parts[1] : "-");
                                        const konu = parts.length > 2 ? parts.slice(2).join(" > ") : "-";
                                        
                                        return (
                                          <>
                                            <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                              <span className="font-semibold text-slate-400 w-11">Lisans:</span> 
                                              <span className="truncate max-w-[180px]">{program.trim()}</span>
                                            </div>
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
                                                  <span className="truncate max-w-[180px] cursor-help">{konu.trim()}</span>
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
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : log.status === 'RATE_LIMIT_429' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                      {log.status === 'SUCCESS' ? 'BAŞARILI' : log.status === 'RATE_LIMIT_429' ? 'KOTA AŞIMI (429)' : log.status === 'FORBIDDEN_403' ? 'YETKİSİZ ERİŞİM (403)' : log.status === 'SERVER_ERROR_503' ? 'SUNUCU HATASI (503)' : log.status}
                                    </span>
                                    {log.status === 'RATE_LIMIT_429' && (
                                      <div className="max-w-[200px] text-[9px] text-amber-400/90 leading-snug bg-amber-500/5 px-2 py-1.5 rounded border border-amber-500/10 mt-1">
                                        <span className="font-bold block mb-0.5">⚠️ Neden 429 Aldı?</span>
                                        Şu 3 limitten biri doldu:<br/>
                                        <span className="text-amber-200">- Dakikada 15 İstek (RPM)</span><br/>
                                        <span className="text-amber-200">- Dakikada 1M Token (TPM)</span><br/>
                                        <span className="text-amber-200">- Günde 1500 İstek (RPD)</span>
                                      </div>
                                    )}
                                    {log.errorDetail && log.status !== 'SUCCESS' && log.status !== 'RATE_LIMIT_429' && (
                                      <div className="max-w-[200px] text-[9px] text-rose-400/80 leading-snug bg-rose-500/5 px-2 py-1 rounded border border-rose-500/10 mt-1">
                                        <span className="font-semibold block mb-0.5 opacity-80">Hata Detayı:</span>
                                        {log.errorDetail}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right text-xs font-mono text-slate-400">
                                  {log.durationMs ? `${log.durationMs}ms` : "-"}
                                </td>
                              </tr>
                            ))}
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
    </div>
  )
}
