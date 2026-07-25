import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { BookOpen, Target, Brain, ArrowRight, Flame, ShieldCheck, Sparkles, Dumbbell, Crown, Diamond, Zap, FileText, ClipboardList, CheckCircle, Award, Trophy, Medal, Star } from "lucide-react"
import { getUserStats, getPrograms, getUserAchievements, getWeeklyLeaderboard, getDailyTasks } from "@/lib/actions"
import { getProgramBySlug, PROGRAM_CATALOG } from "@/lib/program-catalog"
import { resolveProgramIcon } from "@/lib/program-icons"
import UserMenu from "@/components/UserMenu"
import DailyTasksList from "@/components/DailyTasksList"
import ProgressChart from "@/components/ProgressChart"

const PROGRAM_UI: Record<string, { icon: any; gradient: string; accentText: string; accentBorder: string; bgAccent: string; href: string; ready: boolean }> =
  Object.fromEntries(
    PROGRAM_CATALOG.map(p => [
      p.slug,
      {
        icon: resolveProgramIcon(p.icon),
        gradient: p.theme.gradient,
        accentText: p.theme.text,
        accentBorder: p.theme.border,
        bgAccent: p.theme.bgAccent,
        href: `/program/${p.slug}`,
        ready: p.ready,
      },
    ])
  )

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")

  const [stats, programs, userGamification, leaderboard, dailyTasks] = await Promise.all([
    getUserStats(),
    getPrograms(),
    getUserAchievements(),
    getWeeklyLeaderboard(),
    getDailyTasks()
  ])
  const user = session.user as any

  // Get last 10 mock exams across all courses for the chart
  const recentExams = await prisma.userMockExamResult.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" }, // chronological for chart
    take: 10,
    include: { course: { select: { slug: true } } }
  })

  const chartData = recentExams.map((e, idx) => ({
    name: `Deneme ${idx + 1}`,
    puan: e.score,
    tarih: new Date(e.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
  }))

  return (
    <main className="min-h-screen bg-[#020617] text-white" role="main" aria-label="Dashboard">
      {/* Background glows */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[35%] h-[35%] rounded-full bg-indigo-900/15 blur-[180px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[30%] h-[30%] rounded-full bg-slate-800/20 blur-[160px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 space-y-12">
        
        {/* Ana Sayfaya Dönüş */}
        <nav aria-label="Üst gezinme" className="mb-2">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg" aria-label="Sınav seçim sayfasına dön">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Sınav Seçimine Dön
          </Link>
        </nav>
        {/* Welcome + Streak */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3">Merhaba, {user.name || "Öğrenci"} <Sparkles className="w-8 h-8 text-sky-400" /></h1>
            <p className="text-slate-400">Çalışmalarına kaldığın yerden devam et.</p>
            
            {(() => {
              const lastActive = stats?.lastActiveAt ? new Date(stats.lastActiveAt) : null
              const today = new Date()
              const isStreakAtRisk = stats && stats.currentStreak > 0 && lastActive && lastActive.toDateString() !== today.toDateString()
              if (isStreakAtRisk) {
                return (
                  <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
                    <Flame className="w-5 h-5 text-red-400 animate-pulse" />
                    <div>
                      <div className="text-sm font-bold text-red-400">Serin Kırılmak Üzere!</div>
                      <div className="text-xs text-red-300/80">Bugün hiç ders çalışmadın. Serini kurtarmak için hemen bir flashcard çöz.</div>
                    </div>
                  </div>
                )
              }
              return null
            })()}
          </div>
          
          <div className="flex items-center gap-3">
            {stats && stats.currentStreak > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-orange-500/10 border border-orange-500/20 shadow-[0_0_20px_rgba(249,115,22,0.1)]">
                <Flame className="w-5 h-5 text-orange-400" />
                <div>
                  <div className="text-sm font-bold text-orange-400">{stats.currentStreak} Günlük Seri</div>
                  <div className="text-xs text-orange-500/70">Harika gidiyorsun!</div>
                </div>
              </div>
            )}

            {user.role === "admin" && (
              <Link href="/admin" className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-300">Yönetici</span>
              </Link>
            )}

            <UserMenu />
          </div>
        </div>

        {/* İstatistikler */}
        <section aria-label="İstatistikler" className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
            <Target className="w-5 h-5 text-indigo-400 mb-2" />
            <div className="text-2xl font-bold">{stats?._count?.mockResults || 0}</div>
            <div className="text-xs text-slate-500 mt-1">Deneme Sınavı</div>
          </div>
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
            <BookOpen className="w-5 h-5 text-emerald-400 mb-2" />
            <div className="text-2xl font-bold">{programs.length}</div>
            <div className="text-xs text-slate-500 mt-1">Eğitim Programı</div>
          </div>
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
            <Flame className="w-5 h-5 text-orange-400 mb-2" />
            <div className="text-2xl font-bold">{stats?.currentStreak || 0}</div>
            <div className="text-xs text-slate-500 mt-1">Gün Serisi</div>
          </div>
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
            <Brain className="w-5 h-5 text-purple-400 mb-2" />
            <div className="text-2xl font-bold">{stats?._count?.questionAnswers || 0}</div>
            <div className="text-xs text-slate-500 mt-1">Çözülen Soru</div>
          </div>
        </section>

        {/* Alt Bölüm: Programlar + Gamification/Sosyal */}
        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* SOL: Eğitim Programları & Görevler */}
          <div className="lg:col-span-2 space-y-8">
            <DailyTasksList initialTasks={dailyTasks} />
            
            <div>
              <h2 className="text-xl font-bold mb-6">Kayıtlı Programlarım</h2>
              <div className="grid md:grid-cols-2 gap-6">
              {programs.filter(p => PROGRAM_UI[p.slug]?.ready).map((program) => {
                const ui = PROGRAM_UI[program.slug]
                const catalog = getProgramBySlug(program.slug)
                const IconComp = ui.icon
                const title = catalog?.displayName ?? program.name
                const subtitle = catalog?.subtitle ?? program.description

                return (
                  <Link href={ui.href} key={program.id}>
                    <div className={`group relative p-7 rounded-3xl bg-gradient-to-br ${ui.gradient} border border-white/5 ${ui.accentBorder} transition-all overflow-hidden h-full`}>
                      <div className={`absolute top-0 right-0 w-28 h-28 ${ui.bgAccent} rounded-bl-full`} />
                      <IconComp className={`w-7 h-7 ${ui.accentText} mb-5`} />
                      <h3 className="text-xl font-bold mb-1">{title}</h3>
                      <p className="text-slate-400 text-sm mb-6 line-clamp-2">{subtitle}</p>
                      <div className={`flex items-center gap-2 ${ui.accentText} font-semibold text-sm group-hover:gap-4 transition-all`}>
                        Eğitime Devam Et <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </Link>
                )
              })}
              </div>
            </div>
          </div>

          {/* SAĞ: Gamification & Liderlik & Grafik */}
          <div className="space-y-8">
            
            {/* Gelişim Grafiği (Progress Chart) */}
            {chartData.length > 0 && (
              <div>
                <h2 className="text-xl font-bold mb-6">Gelişim Trendi</h2>
                <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.05] h-64">
                  <ProgressChart data={chartData} passingScore={60} />
                </div>
              </div>
            )}

            {/* Seviye & XP */}
            <div>
              <h2 className="text-xl font-bold mb-6">Seviyen</h2>
              <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.05]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
                      <span className="text-xl font-black">{userGamification?.level || 1}</span>
                    </div>
                    <div>
                      <div className="text-sm text-slate-400">Toplam XP</div>
                      <div className="text-xl font-bold font-mono text-sky-400">{userGamification?.totalXP || 0}</div>
                    </div>
                  </div>
                  {(userGamification as any)?.currentStreak > 0 && (
                    <div className="px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/20 text-orange-400 flex items-center gap-2 shadow-[0_0_15px_rgba(249,115,22,0.15)]">
                      <Flame className="w-4 h-4" />
                      <span className="font-bold text-sm">{(userGamification as any).currentStreak} Gün Seri</span>
                    </div>
                  )}
                </div>
                
                {/* Level Progress */}
                <div className="mt-6">
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-slate-500">Seviye {userGamification?.level || 1}</span>
                    <span className="text-slate-400 font-medium">{(userGamification as any)?.currentLevelXp || 0} / {(userGamification as any)?.xpForNextLevel || 100} XP</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-1000 relative"
                      style={{ width: `${Math.min(100, (((userGamification as any)?.currentLevelXp || 0) / ((userGamification as any)?.xpForNextLevel || 1)) * 100)}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Rozetler */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Kazanılan Rozetler</h2>
                <span className="text-sm font-bold text-slate-500">{userGamification?.achievements?.length || 0} Adet</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {userGamification?.achievements?.slice(0, 8).map((badge) => {
                  const IconMap: Record<string, any> = {
                    "🎯": Target, "📝": FileText, "📚": BookOpen, "🦾": Dumbbell, "👑": Crown, 
                    "💎": Diamond, "🔥": Flame, "💪": Dumbbell, "⚡": Zap, "🃏": FileText, 
                    "🧠": Brain, "📋": ClipboardList, "✅": CheckCircle, "🏆": Trophy, "💯": Medal
                  }
                  const BadgeComp = IconMap[badge.icon] || Award
                  
                  return (
                    <div key={badge.key} className="group relative aspect-square rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-indigo-500/30 transition-colors flex items-center justify-center cursor-pointer">
                      <div className="text-2xl filter drop-shadow-md group-hover:scale-110 transition-transform">
                        <BadgeComp className="w-6 h-6 text-indigo-400" />
                      </div>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-3 py-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-xl border border-white/10">
                        <div className="font-bold mb-0.5">{badge.title}</div>
                        <div className="text-slate-300">{badge.description}</div>
                      </div>
                    </div>
                  )
                })}
                {(!userGamification?.achievements || userGamification.achievements.length === 0) && (
                  <div className="col-span-4 p-4 text-center rounded-2xl bg-white/[0.01] border border-white/[0.02] border-dashed text-slate-500 text-sm">
                    Henüz rozet kazanmadın. Soru çözmeye başla!
                  </div>
                )}
              </div>
            </div>

            {/* Liderlik Tablosu */}
            <div>
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                Haftanın Liderleri <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-slate-300 font-medium tracking-wider">TOP 5</span>
              </h2>
              <div className="p-2 rounded-3xl bg-white/[0.02] border border-white/[0.05]">
                {leaderboard && leaderboard.length > 0 ? (
                  leaderboard.slice(0, 5).map((l, i) => (
                    <div key={l.userId} className={`flex items-center justify-between p-3 rounded-2xl transition-colors ${l.userId === user.id ? 'bg-indigo-500/10 border border-indigo-500/20' : 'hover:bg-white/[0.02]'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          i === 0 ? 'bg-amber-400 text-amber-900 shadow-[0_0_10px_rgba(251,191,36,0.3)]' :
                          i === 1 ? 'bg-slate-300 text-slate-800' :
                          i === 2 ? 'bg-amber-700 text-amber-100' :
                          'bg-white/5 text-slate-400'
                        }`}>
                          {i + 1}
                        </div>
                        <div>
                          <div className={`text-sm font-bold ${l.userId === user.id ? 'text-indigo-400' : 'text-slate-200'}`}>
                            {l.name} {l.userId === user.id && "(Sen)"}
                          </div>
                          <div className="text-xs text-slate-500">{l.questionsAnswered} soru, {l.correctAnswers} doğru</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-white">{l.xpEarned} XP</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Bu hafta henüz kimse çalışmadı. İlk sen ol!
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
