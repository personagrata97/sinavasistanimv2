"use client"

import { Fragment } from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { ChevronRight, Flame, BookOpen, BarChart3, TrendingUp, Landmark, Globe, RefreshCw, CircleDollarSign, ScrollText, ClipboardList, Globe2, Calculator, Receipt, Scale, ShieldCheck, Monitor, Code, Server } from "lucide-react"
import { getDaysUntilExam, getUrgencyLevel } from "@/lib/schedule-engine"
import { getCourseCardBadge, getCourseCardCta } from "@/lib/program-catalog"
import { courseHasUploadedPdf } from "@/lib/course-upload-meta"

const COURSE_ICON_MAP: Record<string, any> = {
  BookOpen, BarChart3, TrendingUp, Landmark, Globe, RefreshCw,
  CircleDollarSign, ScrollText, ClipboardList, Globe2, Calculator, Receipt, Scale,
  ShieldCheck, Monitor, Code, Server
}

export default function CourseGrid({ courses, stats, programName, programSubtitle, programSlug, gridCountLabel, isProfessional, backHref }: { courses: any[]; stats: any; programName?: string; programSubtitle?: string; programSlug?: string; gridCountLabel?: string; isProfessional?: boolean; backHref?: string }) {
  // Progress hesaplamaları kaldırıldı çünkü sistemin PDF işleme durumunu gösteriyordu, kullanıcı ilerlemesini değil.

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-4">
          <Link href={backHref ?? "/dashboard"} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{programName || "Sınav Programı"}</h1>
              {programSubtitle && (
                <p className="text-sm text-slate-500 mt-1">{programSubtitle}</p>
              )}
              {stats?.currentStreak > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/20 border border-orange-500/20 text-orange-400 text-xs font-bold shadow-[0_0_15px_rgba(249,115,22,0.2)]">
                  <Flame className="w-3 h-3" />
                  <span>{stats.currentStreak} Günlük Seri</span>
                </div>
              )}
            </div>
            <p className="text-slate-400 text-sm mt-1">{gridCountLabel ?? `${courses.length} Ders`}</p>
          </div>
        </div>

      </div>

      {/* Course Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {courses.map((course, i) => {
          const prevGroup = i > 0 ? courses[i - 1]?.gridGroup : undefined
          const showGroupHeader = Boolean(course.gridGroup && course.gridGroup !== prevGroup)
          const daysLeft = !isProfessional && course.examDate ? getDaysUntilExam(new Date(course.examDate)) : -1
          const urgency = daysLeft >= 0 ? getUrgencyLevel(daysLeft) : null

          const statusConfig: Record<string, { label: string; color: string }> = {
            not_started: { label: "Başlanmadı", color: "text-slate-500" },
            uploaded: { label: "PDF Yüklendi", color: "text-emerald-400" },
            uploading: { label: "Yükleniyor", color: "text-amber-400" },
            processing: { label: "İşleniyor", color: "text-blue-400" },
            paused: { label: "Duraklatıldı", color: "text-amber-400" },
            ready: { label: "Hazır", color: "text-emerald-400" },
            error: { label: "Hata Oluştu", color: "text-red-400" },
          }
          const currentStatus =
            course.sectionCount === 0
              ? course.status === "processing" || course.status === "uploading"
                ? course.status
                : courseHasUploadedPdf(course)
                  ? "uploaded"
                  : "not_started"
              : course.status
          const status = statusConfig[currentStatus] || statusConfig.not_started

          return (
            <Fragment key={course.slug}>
              {showGroupHeader && (
                <div className="col-span-full mb-1 mt-2 flex items-center gap-3">
                  <h2 className="text-sm font-semibold tracking-wide text-fuchsia-300/90 uppercase">
                    {course.gridGroup}
                  </h2>
                  <div className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/30 to-transparent" />
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
              <Link href={
                course.isGroupLanding && course.groupPath
                  ? `/program/${programSlug || "spl-duzey-3"}/${course.groupPath}`
                  : `/program/${programSlug || "spl-duzey-3"}/${course.slug}`
              }>
                <div className="group relative p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/10 transition-all duration-300 cursor-pointer h-full">
                  {/* Top gradient accent */}
                  <div className={`absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r ${course.color} rounded-b-full opacity-50 group-hover:opacity-100 transition-opacity`} />

                  {/* Course number + icon */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const IconComp = course.icon && COURSE_ICON_MAP[course.icon] ? COURSE_ICON_MAP[course.icon] : BookOpen
                        return (
                          <div className={`p-2 rounded-xl bg-gradient-to-br ${course.color} bg-opacity-10 border border-white/[0.06]`} style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <IconComp className="w-4.5 h-4.5 text-slate-300" />
                          </div>
                        )
                      })()}
                      <span className="text-xs font-semibold text-slate-600 bg-white/5 px-2 py-1 rounded">
                        {getCourseCardBadge(programSlug, course.order)}
                      </span>
                      {course.sourceKindLabel && (
                        <span
                          className={`text-[10px] font-semibold px-2 py-1 rounded border ${
                            course.sourceKindLabel === "Dış mevzuat"
                              ? "text-sky-300/90 bg-sky-500/10 border-sky-500/20"
                              : "text-amber-300/90 bg-amber-500/10 border-amber-500/20"
                          }`}
                        >
                          {course.sourceKindLabel}
                        </span>
                      )}
                    </div>
                    {urgency && (
                      <div className={`text-xs font-semibold ${urgency.color} bg-white/5 px-2.5 py-1 rounded`}>
                        {daysLeft} gün kaldı
                      </div>
                    )}
                  </div>

                  {/* Course name */}
                  <h3 className="text-base font-semibold mb-2 group-hover:text-sky-400 transition-colors leading-tight line-clamp-2 min-h-[2.5rem]">
                    {course.name}
                  </h3>

                  {/* Description */}
                  <p className="text-xs text-slate-500 mb-4 line-clamp-2 min-h-[2rem]">
                    {course.description}
                  </p>

                  {/* Stats */}
                  <div className="flex items-center gap-3 mb-4 text-[11px] text-slate-500">
                    <span>{course.sectionCount} Bölüm</span>
                    <span>•</span>
                    <span>{course.flashcardCount} Kart</span>
                    <span>•</span>
                    <span>{course.questionCount} Soru</span>
                  </div>

                  {/* Status */}
                  <div className="mb-3">
                    <span className={status.color + " font-bold text-[11px]"}>{status.label}</span>
                  </div>

                  {/* CTA */}
                  <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 group-hover:text-sky-400 transition-colors">
                    {course.isGroupLanding ? "KVKK Modüllerine Git" : getCourseCardCta(programSlug)} <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </Link>
            </motion.div>
            </Fragment>
          )
        })}
      </div>
    </>
  )
}
