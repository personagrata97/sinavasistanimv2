"use client"

import { useState, useEffect, useRef, use } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, Calendar, BookOpen, HelpCircle, Clock, BarChart3,
  Upload, Brain, ChevronRight, Sparkles, Target,
  AlertTriangle, CheckCircle2, Loader2, X, Play, Pause, RotateCcw, Timer, Search,
  FileText, RefreshCw, Download, ClipboardSignature, BarChart2, Lightbulb,
  Scale, TrendingUp, Landmark, Globe, CircleDollarSign, ScrollText, ClipboardList, Globe2, Calculator, Receipt, Rocket, CalendarDays, XCircle, CheckCircle, Flame, Coffee, Zap, ArrowRight, Star, Flag, Award, Trophy, Lock, Layers
} from "lucide-react"
import { getCourseBySlug, updateExamDate, getMockExamResults, saveMockExamResult, getUserStats, updateUserExamDate } from "@/lib/actions"
import { getDaysUntilExam, getUrgencyLevel } from "@/lib/schedule-engine"
import { getCourseBySlug as getStaticCourse } from "@/lib/course-data"
import AchievementsTab, { UserLevelBadge } from "@/components/course/AchievementsTab"
import MockExamTab from "@/components/course/MockExamTab"
import NotesTab from "@/components/course/NotesTab"
import FlashcardsTab from "@/components/course/FlashcardsTab"
import QuestionsTab from "@/components/course/QuestionsTab"
import CoverageTab from "@/components/course/CoverageTab"
import DailyGoalsTab from "@/components/course/DailyGoalsTab"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Modal, EmptyState, LoadingSkeleton, COURSE_TABS, formatTitle } from "@/components/course/shared"
import { Tabs } from "@/components/ui/shared"
import { DatePicker } from "@/components/ui/DatePicker"
import { toast } from "sonner"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import dynamic from "next/dynamic"

const MermaidDiagram = dynamic(() => import("@/components/MermaidDiagram"), { ssr: false })
const ProgressChart = dynamic(() => import("@/components/ProgressChart"), { ssr: false })

const PDF_SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  body { font-family: 'Inter', sans-serif; color: #0f172a; padding: 40px; max-width: 800px; margin: 0 auto; background: #f8fafc; }
  .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 85vh; page-break-after: always; text-align: center; border-left: 12px solid #3b82f6; }
  .cover-badge { font-size:12px; letter-spacing:4px; color:#3b82f6; margin-bottom:16px; font-weight:700; text-transform: uppercase; }
  .cover h1 { font-size:36px; margin-bottom:12px; color: #0f172a; font-weight: 900; max-width: 80%; }
  .cover p { color:#64748b; font-size:14px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
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
    .cover { min-height: 100vh; justify-content: center; border-left: none; }
  }
`;



type BadgeProps = { children: React.ReactNode; variant?: "default" | "success" | "warning" | "danger" | "info"; className?: string }
function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variants = {
    default: "bg-slate-800 text-slate-300 border-slate-700",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    danger: "bg-red-500/10 text-red-400 border-red-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}

// Markdown içeriğindeki yapay emoji ve formatları temizler
const cleanMarkdown = (md: string, removeFirstHeader = false) => {
  if (!md) return "";
  let clean = md;
  
  if (removeFirstHeader) {
    // Sadece jenerik "Bölüm İçeriği" gibi gereksiz yapay zeka başlıklarını gizle
    clean = clean.replace(/^\s*(#+)\s+.*(Bölüm İçeriği).*(\r?\n|$)/i, "");
  }

  // "Sözlüğü [Konu Adı]" vb. bozuk bükümleri "Konu Adı Sözlüğü" olarak düzelt
  clean = clean.replace(/(Sözlüğü|Özeti|Notları|Kılavuzu|Rehberi|Analizi)\s*\[(.*?)\]/g, "$2 $1");

  return clean.trim();
};

// ==================== POMODORO TIMER ====================
function PomodoroTimer() {
  const [mode, setMode] = useState<"work" | "break">("work")
  const [timeLeft, setTimeLeft] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (running && timeLeft > 0) {
      intervalRef.current = setInterval(() => setTimeLeft(t => t - 1), 1000)
    } else if (timeLeft === 0) {
      if (mode === "work") {
        setSessions(s => s + 1)
        setMode("break")
        setTimeLeft(5 * 60)
        toast.success("Mola zamanı! 5 dakika dinlen.")
      } else {
        setMode("work")
        setTimeLeft(25 * 60)
        toast.success("Tekrar çalışma zamanı!")
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, timeLeft, mode])

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  const progress = mode === "work" ? ((25 * 60 - timeLeft) / (25 * 60)) * 100 : ((5 * 60 - timeLeft) / (5 * 60)) * 100

  return (
    <div className={`p-5 rounded-xl border transition-colors ${
      mode === "work" ? "bg-sky-500/5 border-sky-500/10" : "bg-emerald-500/5 border-emerald-500/10"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Timer className={`w-4 h-4 ${mode === "work" ? "text-sky-400" : "text-emerald-400"}`} />
          <span className="text-sm font-semibold">{mode === "work" ? "Çalışma" : "Mola"}</span>
        </div>
        <span className="text-xs text-slate-500">{sessions} oturum tamamlandı</span>
      </div>
      
      <div className="text-center mb-3">
        <span className={`text-4xl font-mono font-bold ${mode === "work" ? "text-sky-400" : "text-emerald-400"}`}>
          {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
        </span>
      </div>

      <div className="w-full h-1.5 bg-white/5 rounded-full mb-4 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-1000 ${
          mode === "work" ? "bg-sky-500" : "bg-emerald-500"
        }`} style={{ width: `${progress}%` }} />
      </div>

      <div className="flex gap-2 justify-center">
        <button
          onClick={() => setRunning(!running)}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            running 
              ? "bg-white/10 text-white hover:bg-white/15" 
              : mode === "work" ? "bg-sky-600 text-white hover:bg-sky-500" : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          {running ? <><Pause className="w-3 h-3 inline mr-1" />Duraklat</> : <><Play className="w-3 h-3 inline mr-1" />Başlat</>}
        </button>
        <button
          onClick={() => { setRunning(false); setTimeLeft(mode === "work" ? 25 * 60 : 5 * 60) }}
          className="px-3 py-2 rounded-lg bg-white/5 text-slate-400 text-xs font-semibold hover:bg-white/10 transition-colors"
        >
          <RotateCcw className="w-3 h-3 inline mr-1" />Sıfırla
        </button>
      </div>
    </div>
  )
}



import { useSession } from "next-auth/react"
import StudyBuddy from "@/components/StudyBuddy"

export default function CourseDetailPage({ params }: { params: Promise<{ programSlug: string, courseSlug: string }> }) {
  const { programSlug, courseSlug } = use(params)
  const slug = courseSlug
  const router = useRouter()
  const { data: session } = useSession()
    const isAdmin = (session?.user as any)?.role === "admin"

  const [course, setCourse] = useState<any>(null)
  const [userStats, setUserStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")
  const [selectedSectionId, setSelectedSectionId] = useState<string | undefined>(undefined)
  const [selectedScrollKeyword, setSelectedScrollKeyword] = useState<string | undefined>(undefined)
  const [showExamDateModal, setShowExamDateModal] = useState(false)
  const [targetMinutes, setTargetMinutes] = useState<number | "">(120)
  // Seviye özelliği kaldırıldı (kullanıcılar PDF yeniden işleme yapamadığı için işlevsizdi)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [examDateInput, setExamDateInput] = useState("")
  const [pastExamResults, setPastExamResults] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [processingStatus, setProcessingStatus] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<any>(null)
  const [searching, setSearching] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const processLockRef = useRef(false) // 🔒 Çift tıklama kilidi
  const [processLock, setProcessLock] = useState(false)

  // 🔒 MERKEZİ PROCESS FONKSİYONU — Tüm process çağrıları BURADAN geçer
  async function triggerProcess(forceRetry: boolean = false) {
    if (processLockRef.current && !forceRetry) {
      console.log("[FRONTEND] ⚠️ Process zaten tetiklendi — çift tıklama engellendi!")
      toast.info("İşlem zaten devam ediyor...")
      return false
    }
    processLockRef.current = true
    setProcessLock(true)
    try {
      const res = await fetch("/api/courses/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, forceRetry }),
      })
      if (res.ok) {
        toast.success(forceRetry ? "Sistem kilidi kırıldı, işlem zorla başlatıldı!" : "İşlem başlatıldı!")
        setTimeout(loadCourse, 1500)
        return true
      } else {
        const data = await res.json()
        toast.error("İşlem başlatılamadı: " + (data.error || data.message || ""))
        processLockRef.current = false
        setProcessLock(false)
        return false
      }
    } catch {
      toast.error("İşlem başlatılırken bağlantı hatası oluştu.")
      processLockRef.current = false
      setProcessLock(false)
      return false
    }
  }

  const staticInfo = getStaticCourse(slug)

  useEffect(() => {
    loadCourse()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [slug])

  // Keyboard shortcuts (1-8 tab geçiş, ← → önceki/sonraki)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Input/textarea'da devre dışı
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return

      // 1-8 tuşları → tab
      const num = parseInt(e.key)
      if (num >= 1 && num <= COURSE_TABS.length) {
        e.preventDefault()
        setActiveTab(COURSE_TABS[num - 1].id)
        return
      }

      // ← → tab arası gezinme
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.metaKey) {
        e.preventDefault()
        const currentIdx = COURSE_TABS.findIndex(t => t.id === activeTab)
        if (currentIdx === -1) return
        const next = e.key === "ArrowRight"
          ? (currentIdx + 1) % COURSE_TABS.length
          : (currentIdx - 1 + COURSE_TABS.length) % COURSE_TABS.length
        setActiveTab(COURSE_TABS[next].id)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeTab])

  // Processing status polling
  useEffect(() => {
    if (course && (course.status === "processing" || course.status === "uploading")) {
      startPolling()
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [course?.status])

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/courses/status?slug=${slug}`)
        const data = await res.json()
        
        // 🚀 GERÇEK ZAMANLI GÜNCELLEME: Her poll adımında ders verilerini de yükle ki canlı kalite skoru / deneme adımları ekranda canlansın!
        setProcessingStatus(data)
        loadCourse()

        if (data.status === "ready" || data.status === "error") {
          clearInterval(pollRef.current!)
          pollRef.current = null
          loadCourse() // Reload to get fresh data (will update UI to error state)
          if (data.status === "ready") {
            toast.success("İşleme tamamlandı! Materyaller hazır.")
          } else {
            toast.error("İşlem başarısız oldu. Lütfen tekrar deneyin.")
          }
        }
      } catch (e) { /* polling failure, ignore */ }
    }, 3000)
  }

  async function loadCourse() {
    const data = await getCourseBySlug(slug)
    setCourse(data)
    
    const stats = await getUserStats()
    setUserStats(stats)

    if (data?.status === "uploading" || data?.status === "processing") {
      processLockRef.current = true
      setProcessLock(true)
    } else {
      processLockRef.current = false
      setProcessLock(false)
    }
    
    // Fallback to course.examDate if user.targetExamDate is not set
    const examDate = stats?.targetExamDate || data?.examDate
    if (examDate) {
      setExamDateInput(new Date(examDate).toISOString().split("T")[0])
    }
    if (stats?.targetHours) {
      setTargetMinutes(Math.round(stats.targetHours * 60))
    }
    const results = data?.id ? await getMockExamResults(data.id) : []
    setPastExamResults(results || [])
    setLoading(false)
  }

  async function handleSetExamDate() {
    if (!examDateInput) return
    const result = await updateUserExamDate(examDateInput)
    if (result.success) {
      toast.success("Sınav tarihi güncellendi!")
      setShowExamDateModal(false)
      
      // Sınav tarihi güncellendiğinde Akıllı Çalışma Programını (Study Plan) tetikle
      if (course?.id) {
        try {
          toast.info("Sana özel akıllı çalışma programı hesaplanıyor...")
          const genRes = await fetch("/api/study-plan/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              courseId: course.id, 
              targetExamDate: examDateInput,
              targetHours: (Number(targetMinutes) || 120) / 60
            })
          })
          if (genRes.ok) {
            toast.success("Akıllı çalışma programı başarıyla oluşturuldu!")
          }
        } catch (e) {
          console.error("Study plan generation error", e)
        }
      }
      
      loadCourse()
    } else {
      toast.error("Hata: " + result.error)
    }
  }

  async function handleResetExamDate() {
    const result = await updateUserExamDate(null)
    if (result.success) {
      toast.success("Sınav tarihi sıfırlandı!")
      setExamDateInput("")
      setShowExamDateModal(false)
      loadCourse()
    } else {
      toast.error("Hata: " + result.error)
    }
  }

  // handleSetLevel kaldırıldı (seviye özelliği devre dışı)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith(".pdf")) {
      toast.error("Sadece PDF dosyaları kabul edilir.")
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append("file", file)
    formData.append("slug", slug)

    try {
      const res = await fetch("/api/courses/upload", {
        method: "POST",
        body: formData,
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`${data.totalPages} sayfa tespit edildi! İşleme başlıyor...`)
        setShowUploadModal(false)
        loadCourse()
        // Arka planda işlemeyi başlat (merkezî kilit ile)
        triggerProcess()
      } else {
        toast.error("Yükleme hatası: " + data.error)
      }
    } catch (err: any) {
      toast.error("Yükleme başarısız: " + err.message)
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] text-white flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Ders Bulunamadı</h2>
          <Link href={`/program/${programSlug}`} className="text-blue-400 hover:underline">Ders listesine dön</Link>
        </div>
      </div>
    )
  }

  const activeExamDate = userStats?.targetExamDate || course.examDate
  const daysLeft = activeExamDate ? getDaysUntilExam(new Date(activeExamDate)) : -1
  const urgency = daysLeft >= 0 ? getUrgencyLevel(daysLeft) : null

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className={`absolute top-[-10%] right-[-10%] w-[35%] h-[35%] rounded-full bg-gradient-to-br ${course.color || "from-blue-600 to-indigo-700"} opacity-10 blur-[150px]`} />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href={`/program/${programSlug}`} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5">
              <ArrowLeft className="w-5 h-5 text-slate-400" />
            </Link>
            <div>
              <div className="flex items-center gap-2 mb-1">
                {(() => {
                  const iconName = course.icon || staticInfo?.icon
                  const IconMap: Record<string, any> = {
                    BookOpen, BarChart3, TrendingUp, Landmark, Globe, RefreshCw, CircleDollarSign, ScrollText, ClipboardList, Globe2, Calculator, Receipt, Scale
                  }
                  const IconComp = iconName && IconMap[iconName] ? IconMap[iconName] : BookOpen
                  return <div className="p-1.5 rounded-lg bg-white/5 border border-white/10"><IconComp className="w-5 h-5 text-slate-300" /></div>
                })()}
                <span className="text-xs font-bold text-slate-600 bg-white/5 px-2 py-0.5 rounded">#{course.order}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold font-outfit leading-tight">{course.name}</h1>
            </div>
          </div>
        </div>

        {/* Status Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {/* Exam Date Card */}
          <div
            onClick={() => setShowExamDateModal(true)}
            className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-all cursor-pointer group"
          >
            <Calendar className="w-5 h-5 text-blue-400 mb-2" />
            {activeExamDate ? (
              <>
                <div className={`text-xl font-bold flex items-center gap-1.5 ${urgency?.color || "text-white"}`}>
                  {(() => {
                    if (!urgency) return null;
                    const IconMap: Record<string, any> = { Clock, AlertTriangle, Zap, Timer, CheckCircle, Coffee };
                    const UrgencyIcon = IconMap[urgency.icon] || Clock;
                    return <UrgencyIcon className="w-5 h-5" />;
                  })()}
                  {daysLeft} gün
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-1">
                  {new Date(activeExamDate).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-slate-400">Tarih Gir</div>
                <div className="text-[11px] text-slate-600 mt-1">Sınav tarihini belirle</div>
              </>
            )}
          </div>

          {/* Seviye kartı kaldırıldı */}

          {/* PDF Upload Card - Processing durumunu burada göster */}
          {isAdmin && (
            <div 
              className={`p-3 rounded-xl border transition-all relative overflow-hidden group ${
                (() => {
                  const sectionWithAction = processingStatus?.sections?.find((s: any) => {
                    try {
                      const issues = typeof s.verificationIssues === "string" ? JSON.parse(s.verificationIssues) : (s.verificationIssues || {});
                      return issues.needsUserAction === true;
                    } catch { return false; }
                  });
                  const isActionNeeded = !!sectionWithAction;

                  if (isActionNeeded) return "bg-rose-500/10 border-rose-500/30 cursor-pointer";
                  if (course.status === "processing") return "bg-blue-500/5 border-blue-500/20 cursor-pointer";
                  if (course.status === "error") return "bg-red-500/5 border-red-500/20 hover:bg-red-500/10 cursor-pointer";
                  return "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] cursor-pointer";
                })()
              }`}
              onClick={() => {
                const sectionWithAction = processingStatus?.sections?.find((s: any) => {
                  try {
                    const issues = typeof s.verificationIssues === "string" ? JSON.parse(s.verificationIssues) : (s.verificationIssues || {});
                    return issues.needsUserAction === true;
                  } catch { return false; }
                });
                
                if (sectionWithAction) {
                  // Click directly opens the NotesTab for that section (if available in sections list)
                  // but we handle NotesTab separately, user can scroll down and see it.
                } else if (course.status !== "processing") {
                  setShowUploadModal(true);
                }
              }}
            >
              {course.status === "processing" ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    {(() => {
                      const sectionWithAction = processingStatus?.sections?.find((s: any) => {
                        try {
                          const issues = typeof s.verificationIssues === "string" ? JSON.parse(s.verificationIssues) : (s.verificationIssues || {});
                          return issues.needsUserAction === true;
                        } catch { return false; }
                      });
                      
                      if (sectionWithAction) return <AlertTriangle className="w-4 h-4 text-rose-500 animate-pulse" />;
                      
                      const label = processingStatus?.phaseLabel || "";
                      if (label.includes("Notları Çıkarılıyor")) return <Brain className="w-4 h-4 animate-pulse text-purple-400" />;
                      if (label.includes("Kontrolör")) return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
                      if (label.includes("Müfettiş")) return <Search className="w-4 h-4 text-amber-400" />;
                      if (label.includes("Flashcard")) return <Layers className="w-4 h-4 text-pink-400" />;
                      if (label.includes("Rotalama")) return <RefreshCw className="w-4 h-4 text-sky-400 animate-spin" />;
                      if (label.includes("Soru Havuzu")) return <HelpCircle className="w-4 h-4 text-indigo-400" />;
                      return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
                    })()}
                    {(() => {
                      const isActionNeeded = !!processingStatus?.sections?.find((s: any) => {
                        try {
                          const issues = typeof s.verificationIssues === "string" ? JSON.parse(s.verificationIssues) : (s.verificationIssues || {});
                          return issues.needsUserAction === true;
                        } catch { return false; }
                      });
                      
                      return isActionNeeded ? (
                        <span className="text-xs font-black tracking-widest text-rose-400 uppercase">ONAY BEKLENİYOR</span>
                      ) : (
                        <span className="text-xs font-bold text-blue-300">İşleniyor</span>
                      );
                    })()}
                  </div>
                  <div className="text-[11px] text-slate-400 mb-1">
                    {(() => {
                      const isActionNeeded = !!processingStatus?.sections?.find((s: any) => {
                        try {
                          const issues = typeof s.verificationIssues === "string" ? JSON.parse(s.verificationIssues) : (s.verificationIssues || {});
                          return issues.needsUserAction === true;
                        } catch { return false; }
                      });
                      
                      if (isActionNeeded) return "Bir bölüm 5 denemede de %100 alamadı, müdahale bekleniyor. Arka planda diğer işlemler devam ediyor.";
                      return processingStatus?.phaseLabel || "Hazırlanıyor...";
                    })()}
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
                      style={{ width: `${Math.min(processingStatus?.progress || 0, 99)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-[10px] text-slate-500">%{Math.min(processingStatus?.progress || 0, 99)}</div>
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={async (e) => {
                          e.stopPropagation()
                          triggerProcess()
                        }}
                        disabled={processLock}
                        className={`text-[10px] whitespace-nowrap px-2 py-0.5 rounded-md border transition-all font-semibold flex items-center gap-1 shadow-sm ${
                          processLock 
                            ? "bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed opacity-50"
                            : "bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border-sky-500/20 hover:border-sky-500/30 cursor-pointer"
                        }`}
                      >
                        {processLock ? (
                          <>
                            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Çalışıyor
                          </>
                        ) : (
                          <>
                            <Play className="w-2.5 h-2.5 fill-current" /> Devam Ettir
                          </>
                        )}
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmAction({
                            title: "Süreci İptal Etmek İstediğinize Emin Misiniz?",
                            message: "Dikkat! Süreci iptal ederseniz, şimdiye kadar başarıyla üretilmiş olan tüm ders notları, sorular ve flashcardlar kalıcı olarak silinecektir.\n\nBu işlem geri alınamaz!",
                            onConfirm: async () => {
                              try {
                                const { reprocessCourse } = await import("@/lib/actions")
                                const res = await reprocessCourse(slug)
                                if (res.success) {
                                  toast.success("Süreç başarıyla iptal edildi.")
                                  loadCourse()
                                } else {
                                  toast.error("Hata: " + res.error)
                                }
                              } catch {}
                            }
                          })
                        }}
                        className="text-[10px] text-slate-400 hover:text-red-400 px-2 py-0.5 rounded-md bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 transition-all font-semibold flex items-center gap-1 shadow-sm"
                      >
                        <X className="w-2.5 h-2.5" /> İptal Et
                      </button>
                    </div>
                  </div>
                </>
              ) : course.status === "error" ? (
                <>
                  <XCircle className="w-5 h-5 text-red-400 mb-2" />
                  <div className="text-sm font-bold text-red-400">İşlem Başarısız</div>
                  <div className="text-[11px] text-red-400/80 mt-1 mb-3">Yapay zeka limitine takıldı.</div>
                  <div className="flex flex-col gap-2 w-full mt-1 px-2">
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          toast.info("İşlem kaldığı yerden devam ettiriliyor...")
                          triggerProcess()
                        }}
                        disabled={processLock}
                        className={`flex-1 justify-center py-1.5 px-2 rounded-md text-[10px] font-bold transition-all flex items-center gap-1.5 shadow-md no-print ${
                          processLock
                            ? "bg-slate-800/40 text-slate-500 border border-slate-850 cursor-not-allowed opacity-50"
                            : "bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white shadow-blue-950/50 cursor-pointer"
                        }`}
                      >
                        <Play className="w-2.5 h-2.5 fill-current" /> Devam Et
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          setConfirmAction({
                            title: "Zorla Devam Ettir",
                            message: "Eğer işlemin donduğundan eminseniz bu butonu kullanın. Eski notlarınız veya başarıyla tamamlanmış bölümleriniz KESİNLİKLE silinmez. Sadece takılı kalan işlem kaldığı yerden zorla yeniden başlatılır.",
                            onConfirm: async () => {
                              triggerProcess(true)
                            }
                          })
                        }}
                        className="flex-1 justify-center py-1.5 px-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:border-amber-500/40 rounded-md text-[10px] font-bold transition-all no-print flex items-center gap-1.5 shadow-sm"
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> Zorla
                      </button>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowUploadModal(true)
                      }}
                      className="w-full justify-center py-1.5 px-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-md text-[10px] font-bold transition-all border border-white/10 hover:border-white/20 no-print flex items-center gap-1.5 shadow-sm"
                    >
                      <RotateCcw className="w-2.5 h-2.5" /> Sıfırla
                    </button>
                  </div>
                </>
              ) : course.totalPages > 0 ? (
                <div className="flex flex-col items-center w-full" onClick={(e) => e.stopPropagation()}>
                  <Upload className="w-5 h-5 text-emerald-400 mb-2" />
                  <div className="text-sm font-bold text-center">{course.totalPages} Sayfa</div>
                  <div className="text-[11px] text-slate-500 font-medium mt-1 mb-3">PDF Hazır</div>
                  <div className="flex flex-wrap gap-2 w-full justify-center">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        toast.info("İşlem başlatılıyor...")
                        triggerProcess()
                      }}
                      disabled={processLock}
                      className={`py-1.5 px-3 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 shadow-md no-print ${
                        processLock
                          ? "bg-slate-800/40 text-slate-500 border border-slate-850 cursor-not-allowed opacity-50"
                          : "bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white shadow-emerald-950/50 cursor-pointer"
                      }`}
                    >
                      <Play className="w-3 h-3 fill-current" /> {course.status === "completed" ? "Yeniden Tara" : "Devam Ettir"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowUploadModal(true)
                      }}
                      className="py-1.5 px-3 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-md text-[10px] font-bold transition-all border border-white/10 hover:border-white/20 no-print flex items-center gap-1 shadow-sm"
                    >
                      <FileText className="w-3 h-3" /> PDF Değiştir
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmAction({
                          title: "Sıfırdan Başlamak İstediğinize Emin Misiniz?",
                          message: "Eski ders notları, sorular ve flashcardlar tamamen silinerek işleme sıfırdan başlatılacaktır. Bu işlem geri alınamaz!",
                          onConfirm: async () => {
                            try {
                              const { reprocessCourse } = await import("@/lib/actions")
                              toast.loading("Eski veriler temizleniyor...")
                              
                              processLockRef.current = false
                              setProcessLock(false)
                              
                              const res = await reprocessCourse(slug)
                              toast.dismiss()
                              if (res.success) {
                                toast.success("Eski veriler temizlendi! Sıfırdan işleme başlıyor...")
                                triggerProcess()
                                loadCourse()
                              } else {
                                toast.error("Hata: " + res.error)
                              }
                            } catch {}
                          }
                        })
                      }}
                      className="py-1.5 px-3 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 rounded-md text-[10px] font-bold transition-all border border-red-500/10 hover:border-red-500/30 no-print flex items-center gap-1 shadow-sm"
                    >
                      <RotateCcw className="w-3 h-3" /> Sıfırdan İşle
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-slate-500 mb-2" />
                  <div className="text-sm font-bold text-slate-400">PDF Bekleniyor</div>
                  <div className="text-[11px] text-slate-600 mt-1">Ders notu yüklenecek</div>
                </>
              )}
            </div>
          )}

          {/* Stats Card */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <Sparkles className="w-5 h-5 text-amber-400 mb-2" />
            <div className="text-sm font-bold">{course._count?.flashcards || 0} Kart · {course._count?.questions || 0} Soru</div>
          </div>
        </div>

        {/* Arama Çubuğu */}
        <div className="relative mb-4">
          <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
            <Search className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder="Notlarda, kartlarda ve sorularda ara..."
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value
                setSearchQuery(val)
                if (val.length < 2) { setSearchResults(null); return }
                // 300ms debounce — her tuşta sunucu çağrısı yerine bekliyoruz
                if ((window as any).__searchTimeout) clearTimeout((window as any).__searchTimeout);
                (window as any).__searchTimeout = setTimeout(async () => {
                  setSearching(true)
                  const { searchCourse } = await import("@/lib/actions")
                  const results = await searchCourse(slug, val)
                  setSearchResults(results)
                  setSearching(false)
                }, 300)
              }}
              className="bg-transparent w-full text-sm text-slate-300 focus:outline-none placeholder:text-slate-600"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setSearchResults(null) }} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
            {searching && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
          </div>
          
          {/* Arama Sonuçları */}
          {searchResults && (searchResults.notes.length > 0 || searchResults.questions.length > 0) && (
            <div className="absolute z-50 left-0 right-0 top-full mt-2 bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl max-h-96 overflow-y-auto p-3 space-y-2">
              {searchResults.notes.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider px-2 mb-1">📝 Notlar ({searchResults.notes.length})</div>
                  {searchResults.notes.slice(0, 5).map((r: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { setActiveTab("notes"); setSearchQuery(""); setSearchResults(null) }}
                      className="w-full text-left p-3 rounded-xl hover:bg-white/5 transition-colors"
                    >
                      <div className="text-xs font-bold text-blue-400">{r.sectionTitle}</div>
                      <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{r.snippet}</div>
                    </button>
                  ))}
                </div>
              )}
              {searchResults.questions.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider px-2 mb-1 mt-2">❓ Sorular ({searchResults.questions.length})</div>
                  {searchResults.questions.slice(0, 5).map((r: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { setActiveTab("questions"); setSearchQuery(""); setSearchResults(null) }}
                      className="w-full text-left p-3 rounded-xl hover:bg-white/5 transition-colors"
                    >
                      <div className="text-xs font-bold text-emerald-400">{r.sectionTitle}</div>
                      <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{r.text}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {searchResults && searchResults.notes.length === 0 && searchResults.questions.length === 0 && searchQuery.length >= 2 && (
            <div className="absolute z-50 left-0 right-0 top-full mt-2 bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl p-6 text-center">
              <div className="text-sm text-slate-500">Sonuç bulunamadı</div>
            </div>
          )}
        </div>

        {/* Tab Navigation (Merkezi Bileşen) */}
        <Tabs 
          tabs={COURSE_TABS} 
          activeTab={activeTab} 
          onChange={(t) => { setActiveTab(t); setSelectedScrollKeyword(undefined); setSelectedSectionId(undefined); }} 
          className="mb-8" 
        />

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
          >
            <ErrorBoundary name={activeTab}>
              {activeTab === "overview" && (
                <OverviewTab 
                  course={course} 
                  processingStatus={processingStatus} 
                  pastExamResults={pastExamResults} 
                  isAdmin={isAdmin} 
                  onNavigateToSection={(sectionId, keyword) => {
                    setSelectedSectionId(sectionId);
                    if (keyword) setSelectedScrollKeyword(keyword);
                    setActiveTab("notes");
                  }}
                />
              )}
              {activeTab === "notes" && (
                <NotesTab 
                  course={course} 
                  slug={slug} 
                  isAdmin={isAdmin} 
                  onReloadCourse={loadCourse} 
                  initialSectionId={selectedSectionId} 
                  initialScrollKeyword={selectedScrollKeyword}
                  processingStatus={processingStatus}
                />
              )}
              {activeTab === "flashcards" && <FlashcardsTab slug={slug} courseName={course.name} />}
              {activeTab === "questions" && <QuestionsTab slug={slug} courseName={course.name} />}
              {activeTab === "coverage" && <CoverageTab slug={slug} />}
              {activeTab === "mock_exam" && <MockExamTab slug={slug} programSlug={programSlug} courseName={course.name} pastExamResults={pastExamResults} onReloadCourse={loadCourse} processingStatus={processingStatus} />}
              {activeTab === "achievements" && <AchievementsTab />}
              {activeTab === "goals" && <DailyGoalsTab course={course} slug={slug} hasExamDate={!!activeExamDate} onSetExamDate={() => setShowExamDateModal(true)} />}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Exam Date Modal */}
      <AnimatePresence>
        {showExamDateModal && (
          <Modal onClose={() => setShowExamDateModal(false)} overflowVisible={true}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-indigo-400" /> Sınav Tarihi ve Plan</h3>
            <p className="text-sm text-slate-400 mb-6">Sınav tarihini ve günlük ortalama çalışma sürenizi belirleyin. Sistem buna uygun bir program oluşturacaktır.</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">Hedef Sınav Tarihi</label>
              <DatePicker 
                value={examDateInput} 
                onChange={(val) => setExamDateInput(val)} 
                placeholder="Sınav tarihi seçin..." 
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-300 mb-2">Günlük Çalışma Süresi (Dakika)</label>
              <div className="relative flex items-center">
                <Clock className="absolute left-4 w-5 h-5 text-indigo-400" />
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={targetMinutes}
                  onChange={(e) => setTargetMinutes(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full pl-12 pr-16 py-4 rounded-xl bg-[#1e293b] border border-slate-700 text-white font-medium focus:outline-none focus:border-indigo-500/50 transition-all"
                  placeholder="Örn: 45"
                />
                <span className="absolute right-4 text-slate-500 font-medium">dk</span>
              </div>
            </div>
            <div className="flex gap-3">
              {activeExamDate && (
                <button
                  onClick={handleResetExamDate}
                  className="flex-1 py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 font-bold transition-all duration-200"
                >
                  Sıfırla
                </button>
              )}
              <button
                onClick={handleSetExamDate}
                className={`py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold transition-colors ${activeExamDate ? 'flex-1' : 'w-full'}`}
              >
                Kaydet
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Seviye modalı kaldırıldı */}

      {/* Upload Modal (sadece admin) */}
      <AnimatePresence>
        {isAdmin && showUploadModal && (
          <Modal onClose={() => setShowUploadModal(false)}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-400" /> PDF Yükle / Değiştir</h3>
            <p className="text-sm text-slate-400 mb-6">
              Ders için kaynak PDF dosyasını buradan yükleyebilir veya değiştirebilirsiniz.
            </p>
            <label className="block w-full p-8 rounded-xl border-2 border-dashed border-white/10 hover:border-blue-500/50 transition-colors cursor-pointer text-center">
              {uploading ? (
                <div className="flex items-center justify-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="text-slate-400">Yükleniyor...</span>
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <div className="text-sm font-medium text-slate-400">PDF dosyanızı buraya sürükleyin</div>
                  <div className="text-xs text-slate-600 mt-1">veya tıklayarak seçin</div>
                </>
              )}
              <input type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" disabled={uploading} />
            </label>
          </Modal>
        )}
        
        {confirmAction && (
          <Modal onClose={() => setConfirmAction(null)}>
            <div className="text-center p-2 relative z-10">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-red-500">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              
              <h3 className="text-base font-bold text-white mb-2">{confirmAction.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-6 whitespace-pre-line">{confirmAction.message}</p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/[0.08] hover:border-white/15 font-semibold transition-all text-xs shadow-sm flex items-center justify-center gap-1.5"
                >
                  Vazgeç
                </button>
                <button
                  onClick={() => {
                    confirmAction.onConfirm();
                    setConfirmAction(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold transition-all text-xs shadow-md shadow-red-950/50 flex items-center justify-center gap-1.5"
                >
                  Evet, Eminim
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <StudyBuddy courseId={course.id} />
    </div>
  )
}


// ==================== TAB COMPONENTS ====================

function OverviewTab({ 
  course, 
  processingStatus, 
  pastExamResults, 
  isAdmin, 
  onNavigateToSection 
}: { 
  course: any; 
  processingStatus: any; 
  pastExamResults?: any[]; 
  isAdmin?: boolean; 
  onNavigateToSection?: (sectionId: string, keyword?: string) => void;
}) {
  const isProcessing = course.status === "processing" || course.status === "uploading"

  return (
    <div className="space-y-6">
      {/* ========== SINAV HAZIRLIK ENDEKSİ ========== */}
      {(course._count?.questions > 0 || course._count?.flashcards > 0) && (() => {
        const totalSections = course.sections?.length || 0
        const sectionsWithNotes = course.sections?.filter((s: any) => s.notes)?.length || 0
        const notesCoverage = totalSections > 0 ? Math.round((sectionsWithNotes / totalSections) * 100) : 0

        const totalCards = course._count?.flashcards || 0
        const masteredCards = course.sections?.reduce((sum: number, s: any) => sum, 0) || 0 // will be updated from flashcards

        const examResults = pastExamResults || []
        const avgExamScore = examResults.length > 0 
          ? Math.round(examResults.reduce((s: number, r: any) => s + r.score, 0) / examResults.length)
          : 0
        const lastExamScore = examResults.length > 0 ? examResults[examResults.length - 1]?.score || 0 : 0

        // Hazırlık Endeksi: Not kapsamı %30 + Deneme ortalaması %40 + İçerik varlığı %30
        const contentReady = (course._count?.questions > 0 ? 15 : 0) + (course._count?.flashcards > 0 ? 15 : 0)
        const readinessScore = Math.min(100, Math.round(
          (notesCoverage * 0.30) + 
          (avgExamScore * 0.40) + 
          contentReady
        ))

        const getReadinessColor = (score: number) => {
          if (score >= 80) return "text-emerald-400"
          if (score >= 60) return "text-amber-400"
          if (score >= 40) return "text-orange-400"
          return "text-red-400"
        }
        const getReadinessLabel = (score: number) => {
          if (score >= 80) return "Sınava Hazırsın!"
          if (score >= 60) return "İyi yoldasın"
          if (score >= 40) return "Daha çok çalış"
          if (score > 0) return "Acil çalışma gerekli"
          return "Henüz başlanmadı"
        }

        return (
          <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-6">
              {/* Circular Progress */}
              <div className="relative w-24 h-24 shrink-0">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${readinessScore * 2.64} 264`} className={getReadinessColor(readinessScore)} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-2xl font-bold ${getReadinessColor(readinessScore)}`}>{readinessScore}</span>
                  <span className="text-[9px] text-slate-500">PUAN</span>
                </div>
              </div>
              {/* Details */}
              <div className="flex-1">
                <h3 className="text-sm font-bold text-white mb-1">Sınav Hazırlık Endeksi</h3>
                <p className={`text-xs font-semibold mb-3 ${getReadinessColor(readinessScore)}`}>{getReadinessLabel(readinessScore)}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Not Kapsamı</span>
                    <span className="font-bold text-slate-300">%{notesCoverage}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Deneme Ort.</span>
                    <span className="font-bold text-slate-300">{avgExamScore > 0 ? avgExamScore : "—"}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Soru Bankası</span>
                    <span className="font-bold text-slate-300">{course._count?.questions || 0}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Son Deneme</span>
                    <span className={`font-bold ${lastExamScore >= 60 ? "text-emerald-400" : lastExamScore > 0 ? "text-red-400" : "text-slate-500"}`}>
                      {lastExamScore > 0 ? lastExamScore : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Materyaller hazır */}
      {(course._count?.questions > 0 || course._count?.flashcards > 0) && (
        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <div>
            <span className="text-sm text-emerald-300 font-medium">
              {course._count?.questions || 0} soru ve {course._count?.flashcards || 0} kart hazır.
            </span>
            <span className="text-xs text-slate-500 ml-2">Sekmelerden çalışmaya başla.</span>
          </div>
        </div>
      )}

      {/* Seviye & XP Rozeti */}
      <UserLevelBadge />

      {/* 💡 Günün Kavramı */}
      {course.sections && course.sections.filter((s: any) => s.notes).length > 0 && (() => {
        // Notların içinden sadece "Gerçek Kavram Tanımları" (Terim-Tanım-Örnek) ayıkla
        interface HapBilgi {
          type: 'concept';
          title: string;
          content: string;
          hint?: string;
          sectionTitle: string;
          sectionId: string;
        }

        const completeTurkishSentence = (text: string): string => {
          let trimmed = text.trim();
          if (!trimmed) return "";

          // Eğer zaten uygun bir noktalama işaretiyle bitiyorsa dokunma (nokta, ünlem, soru işareti vb.)
          if (/[.?!]$/.test(trimmed)) {
            return trimmed;
          }

          // Sondaki virgülü temizle
          let base = trimmed.replace(/,$/, '').trim();

          const words = base.split(/\s+/);
          const lastWord = words[words.length - 1];
          if (!lastWord) return trimmed;

          const lowerLast = lastWord.toLowerCase();

          const replacements: Record<string, string> = {
            "varlıkları": "varlıklardır",
            "varlığı": "varlığıdır",
            "faaliyetleri": "faaliyetleridir",
            "faaliyeti": "faaliyetidir",
            "işlemleri": "işlemleridir",
            "işlemi": "işlemidir",
            "suçları": "suçlarıdır",
            "suçu": "suçudur",
            "cezası": "cezasıdır",
            "cezaları": "cezalarıdır",
            "yükümlülüğü": "yükümlülüğüdür",
            "yükümlülükleri": "yükümlülükleridir",
            "süreleri": "süreleridir",
            "süresi": "süresidir",
            "limiti": "limitidir",
            "limitleri": "limitleridir",
            "cüzdanı": "cüzdanıdır",
            "cüzdanları": "cüzdanlarıdır",
            "fonu": "fonudur",
            "hizmeti": "hizmetidir",
            "hizmetleri": "hizmetleridir",
            "kurumu": "kurumudur",
            "kurumları": "kurumlarıdır",
            "kuruluşu": "kuruluşudur",
            "kuruluşları": "kuruluşlarıdır",
            "ortaklığı": "ortaklığıdır",
            "ortaklıkları": "ortaklıklarıdır",
            "şirketi": "şirketidir",
            "şirketleri": "şirketleridir",
            "piyasası": "piyasasıdır",
            "piyasaları": "piyasalarıdır",
            "aracı": "aracıdır",
            "araçları": "araçlarıdır",
            "sistemi": "sistemidir",
            "sistemleri": "sistemleridir",
            "süreci": "sürecidir",
            "süreçleri": "süreçleridir",
            "esasları": "esaslarıdır",
            "esası": "esasıdır",
            "tanımı": "tanımıdır",
            "tanımları": "tanımlarıdır",
            "kriterleri": "kriterleridir",
            "kriteri": "kriteridir",
            "değerleri": "değerleridir",
            "değeri": "değeridir"
          };

          let replaced = false;
          for (const [key, replacement] of Object.entries(replacements)) {
            if (lowerLast === key) {
              const isUpper = lastWord === lastWord.toUpperCase();
              words[words.length - 1] = isUpper ? replacement.toUpperCase() : replacement;
              base = words.join(" ") + ".";
              replaced = true;
              break;
            }
          }

          if (!replaced) {
            if (lowerLast.endsWith("ları")) {
              words[words.length - 1] = lastWord + "dır";
              base = words.join(" ") + ".";
              replaced = true;
            } else if (lowerLast.endsWith("leri")) {
              words[words.length - 1] = lastWord + "dir";
              base = words.join(" ") + ".";
              replaced = true;
            }
          }

          if (!replaced && trimmed.endsWith(",")) {
            return base + ".";
          }

          return base;
        };

        const parseHapBilgi = (line: string, secTitle: string, secId: string): HapBilgi | null => {
          const t = line.trim();
          if (t.length < 10) return null;

          // Sadece "- **" veya "* **" ile başlayan kavram tanımlarını çekiyoruz
          const isConcept = /^[*\-\s]*\*\*/.test(t);
          if (isConcept) {
            const termMatch = t.match(/\*\*(.*?)\*\*/);
            if (termMatch) {
              let title = termMatch[1].trim();
              title = title.replace(/[:：\-\s]+$/, '').trim();
              
              // Sınavda kesin çıkar, tuzak vb. yapay ifadeleri başlıktan temizle
              title = title
                .replace(/Tuzakları/g, "Detayları")
                .replace(/Tuzak/g, "Detay")
                .replace(/tuzakları/g, "detayları")
                .replace(/tuzak/g, "detay");

              let rest = t.substring(termMatch.index! + termMatch[0].length).trim();
              rest = rest.replace(/^[:：\s\-–—]+/, '').trim();

              // EĞER başlık çok kısaysa (örneğin sadece tek harf bold yapılmışsa: **İ**zleme)
              // Gerçek başlığı ve tanımı iki nokta (:) karakterine göre ayırarak yeniden kuruyoruz.
              if (title.length <= 2 && t.includes(":")) {
                const colonIndex = t.indexOf(":");
                const beforeColon = t.substring(0, colonIndex).replace(/\*/g, "").trim();
                const afterColon = t.substring(colonIndex + 1).trim();
                
                title = beforeColon.replace(/^[\-\s+]+/, "").trim();
                rest = afterColon;
              }

              let content = rest;
              let hint: string | undefined = undefined;
              
              const separatorMatch = rest.match(/→\s*💡|💡|→/);
              if (separatorMatch) {
                const sepIndex = separatorMatch.index!;
                content = rest.substring(0, sepIndex).trim();
                hint = rest.substring(sepIndex + separatorMatch[0].length)
                  .replace(/^[\s*+\-_:\(\)]+/, '')
                  .replace(/[\s*+\-_:\(\)]+$/, '')
                  .trim();
              }

              // Türkçe yarım cümleleri otomatik tamamla
              content = completeTurkishSentence(content);

              const lowerTitle = title.toLowerCase();
              const isInvalidTitle = 
                lowerTitle.startsWith("soru") || 
                lowerTitle.startsWith("cevap") || 
                lowerTitle.startsWith("test") || 
                lowerTitle.startsWith("örnek") ||
                lowerTitle.startsWith("şema") ||
                lowerTitle.startsWith("tablo") ||
                lowerTitle.includes("bölüm") ||
                lowerTitle.includes("açılımı") ||
                lowerTitle.includes("karşılığı") ||
                lowerTitle.includes("benzetme") ||
                lowerTitle.includes("senaryo");

              // Kısa ve kuru liste kırıntılarını elemek için gerçek tanımların en az 50 karakter olmasını şart koşuyoruz
              if (content.length > 50 && !isInvalidTitle) {
                return {
                  type: 'concept',
                  title,
                  content,
                  hint,
                  sectionTitle: secTitle,
                  sectionId: secId
                };
              }
            }
          }
          return null;
        };

        const allHapBilgiler: HapBilgi[] = [];
        course.sections.forEach((sec: any) => {
          if (!sec.notes) return;

          const isGlossarySec = sec.title.includes("Kısaltmalar") || sec.title.includes("Terimler") || sec.title.includes("Kılavuzu");

          if (isGlossarySec) {
            // Split by "### 🔑" to extract glossary terms!
            const parts = sec.notes.split("### 🔑");
            parts.forEach((part: string) => {
              const lines = part.trim().split("\n");
              if (lines.length < 2) return;

              // First line is the term heading (e.g. "SPK (Sermaye Piyasası Kurulu)")
              let title = lines[0].trim();
              if (!title || title.length > 100 || title.toLowerCase().includes("terimler sözlüğü")) return;

              // Clean title
              title = title.replace(/[:：\-\s]+$/, '').trim();

              // Find the "Açılımı veya Resmi Tanımı" or the first bullet point as content
              let content = "";
              let hint = "";

              lines.slice(1).forEach((l: string) => {
                const lt = l.trim();
                if (lt.startsWith("- **Açılımı") || lt.startsWith("- **Resmi") || lt.startsWith("* **Açılımı") || lt.startsWith("* **Resmi")) {
                  content = lt.replace(/^[-*\s]*\*\*.*?\*\*/, "").replace(/^[:：\s\-–—]+/, "").trim();
                } else if (lt.includes("💡") || lt.includes("Benzetme") || lt.includes("benzetme")) {
                  hint = lt.replace(/^[-*\s]*\*\*.*?\*\*/, "").replace(/^[:：\s\-–—]+/, "").replace(/^[💡\s]+/, "").trim();
                }
              });

              if (content && content.length > 20) {
                // complete sentence
                content = completeTurkishSentence(content);

                allHapBilgiler.push({
                  type: 'concept',
                  title,
                  content,
                  hint: hint || undefined,
                  sectionTitle: sec.title,
                  sectionId: sec.id
                });
              }
            });
          } else {
            // Standard line-by-line processing for other sections
            const lines = sec.notes.split("\n");
            lines.forEach((line: string) => {
              const parsed = parseHapBilgi(line, sec.title, sec.id);
              if (parsed) {
                allHapBilgiler.push(parsed);
              }
            });
          }
        });

        if (allHapBilgiler.length === 0) return null;

        // Deterministik seçim (tarihe göre her gün farklı hap bilgi)
        const today = new Date();
        const dayIndex = (today.getFullYear() * 366 + today.getMonth() * 31 + today.getDate()) % allHapBilgiler.length;
        const chosenHap = allHapBilgiler[dayIndex];
        
        const containerBg = "from-amber-500/5 to-orange-500/5 border-amber-500/15";
        const iconBg = "bg-amber-500/10";
        const iconColor = "text-amber-400";
        const titleColor = "text-amber-300";
        const badgeText = "GÜNÜN KAVRAMI";
        const IconComponent = Lightbulb;

        return (
          <motion.div
            onClick={() => onNavigateToSection?.(chosenHap.sectionId, chosenHap.title)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className={`p-5 rounded-xl bg-gradient-to-r ${containerBg} border flex flex-col gap-4 relative overflow-hidden group cursor-pointer hover:border-white/10 active:scale-[0.99] transition-all`}
          >
            {/* Arka plan parlama efekti */}
            <div className="absolute -right-16 -top-16 w-32 h-32 rounded-full filter blur-[40px] opacity-10 group-hover:opacity-20 transition-opacity duration-500 bg-amber-500" />

            <div className="flex items-center gap-3 relative z-10">
              <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center transition-transform group-hover:scale-105 duration-300`}>
                <IconComponent className={`w-5 h-5 ${iconColor}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-extrabold tracking-wider uppercase ${titleColor}`}>{badgeText}</span>
                </div>
                <div className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{chosenHap.sectionTitle}</div>
              </div>
              <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-slate-400 shrink-0 ml-auto" />
            </div>

            <div className="relative z-10 flex flex-col gap-2.5">
              <h4 className={`text-base font-extrabold tracking-tight ${titleColor}`}>
                {chosenHap.title}
              </h4>
              <div className="text-sm text-slate-300 leading-relaxed font-normal markdown-body-compact">
                <ReactMarkdown>{chosenHap.content}</ReactMarkdown>
              </div>

              {chosenHap.hint && (
                <div className="mt-2 p-3.5 rounded-lg bg-slate-900/40 border border-slate-800/60 flex items-start gap-2.5 backdrop-blur-[2px]">
                  <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Lightbulb className="w-3 h-3 text-amber-400" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Akılda Kalıcı Benzetme / Pratik Örnek</span>
                    <div className="text-xs text-slate-300 italic font-medium leading-relaxed markdown-body-compact">
                      <ReactMarkdown>{`"${chosenHap.hint}"`}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        );
      })()}

      {/* PDF yüklü ama henüz işlenmemiş */}
      {isAdmin && course.totalPages > 0 && course._count?.questions === 0 && course._count?.flashcards === 0 && course.status !== "processing" && (
        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 flex items-center gap-3">
          <Upload className="w-5 h-5 text-blue-400" />
          <div className="flex-1">
            <span className="text-sm text-blue-300 font-medium">PDF yüklendi ({course.totalPages} sayfa). </span>
            <span className="text-xs text-slate-400">İçerik oluşturmak için PDF kartına tıklayıp "Tekrar İşle" butonuna bas.</span>
          </div>
        </div>
      )}

      {/* PDF yüklenmemiş */}
      {isAdmin && !course.pdfPath && course.totalPages === 0 && (
        <div className="p-4 rounded-xl bg-slate-500/5 border border-slate-500/20 flex items-center gap-3">
          <Upload className="w-5 h-5 text-slate-400" />
          <span className="text-sm text-slate-400">Henüz PDF yüklenmedi. Yukarıdaki PDF kartından ders notunu yükle.</span>
        </div>
      )}

      {/* Gelişim Grafiği (Eğer geçmiş sonuç varsa) */}
      {pastExamResults && pastExamResults.length > 0 && (
        <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <h3 className="text-sm font-semibold mb-4 text-slate-300 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-sky-400" /> Deneme Sınavı Gelişimin</h3>
          <div className="flex items-end gap-2 h-32 mt-4">
            {pastExamResults.slice(-10).map((r, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-2 group relative">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 bg-white/10 px-2 py-1 rounded text-xs whitespace-nowrap">
                  Puan: {r.score}
                </div>
                <div 
                  className={`w-full max-w-[24px] rounded-t-sm transition-all ${
                    r.score >= 80 ? "bg-emerald-500" :
                    r.score >= 60 ? "bg-amber-400" :
                    r.score >= 50 ? "bg-orange-400" : "bg-red-500"
                  }`} 
                  style={{ height: `${Math.max(5, r.score)}%` }}
                />
                <div className="text-[10px] text-slate-500">{i + 1}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {course.sections.length === 0 && !isProcessing ? (
        <EmptyState
          tabId="overview"
          title="İçerik Hazırlanıyor"
          description="Bu dersin materyalleri yapay zeka asistanımız tarafından arka planda sizin için hazırlanıyor. Lütfen daha sonra tekrar kontrol edin."
        />
      ) : course.sections.length > 0 ? (
        <>
          <div className="space-y-3">
            {course.sections
              .filter((section: any) => !section.title.toLowerCase().includes("kaynakça") && !section.title.toLowerCase().includes("kaynaklar"))
              .map((section: any, i: number) => {
              // 🚀 GERÇEK ZAMANLI VERİ SENKRONİZASYONU (Ön bellek kilit koruması): 
              // Next.js Server Action Router Cache'i bypass etmek için veriyi doğrudan HTTP Polling API'den alıyoruz!
              const liveSec = processingStatus?.sections?.find((s: any) => s.id === section.id);
              const isSectionProcessed = liveSec ? liveSec.processed : section.processed;
              const currentVerificationScore = liveSec ? liveSec.verificationScore : section.verificationScore;
              const currentVerificationIssues = liveSec ? liveSec.verificationIssues : section.verificationIssues;

              return (
                <div
                  key={section.id}
                  className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-400">
                      <FileText className="w-4 h-4" />
                    </span>
                    <div>
                      <h4 className="text-sm font-bold">{formatTitle(section.title, i, section.notes, section.module)}</h4>
                      {isAdmin && <p className="text-[11px] text-slate-500">Sayfa {section.pageStart}-{section.pageEnd}</p>}
                    </div>
                  </div>
                  <div>
                    {isSectionProcessed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : isProcessing ? (
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-slate-700" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}


