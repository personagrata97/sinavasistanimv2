"use client"

import { FileText, Upload, ChevronRight } from "lucide-react"
import Link from "next/link"

type ProgramUploadGuideProps = {
  programSlug: string
  courses: Array<{
    slug: string
    name: string
    order: number
    status?: string
    uploadFileName?: string
    uploadGuide?: string
  }>
}

export default function ProgramUploadGuide({ programSlug, courses }: ProgramUploadGuideProps) {
  return (
    <div className="mb-10 p-6 rounded-2xl bg-rose-500/5 border border-rose-500/20 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <Upload className="w-5 h-5 text-rose-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-rose-100">PDF Yükleme Rehberi</h2>
          <p className="text-sm text-slate-400 mt-1 leading-relaxed">
            Her modül için aşağıdaki dosya adıyla tek bir PDF yükleyin. Metinleri{" "}
            <span className="text-slate-300">mevzuat.gov.tr</span> veya Resmi Gazete&apos;den güncel (Haziran 2026) alın.
            Yükledikten sonra modüle girip <strong className="text-rose-300">İşleme Başlat</strong> ile içerik üretimini başlatın.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {courses.map(c => (
          <li
            key={c.slug}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-rose-500/20 transition-colors"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="shrink-0 w-7 h-7 rounded-lg bg-rose-500/10 text-rose-400 text-xs font-bold flex items-center justify-center">
                {c.order}
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-200">{c.name}</div>
                {c.uploadFileName && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-300/90 font-mono">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    {c.uploadFileName}
                  </div>
                )}
                {c.uploadGuide && (
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{c.uploadGuide}</p>
                )}
              </div>
            </div>
            <Link
              href={`/program/${programSlug}/${c.slug}`}
              className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-rose-400 hover:text-rose-300 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20"
            >
              Modüle Git <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}
