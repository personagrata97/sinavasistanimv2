import React from "react"
import { motion } from "framer-motion"
import { FileText, ShieldCheck, Bot, AlertCircle, RefreshCw, ChevronRight, Sparkles, Search } from "lucide-react"
import { Modal } from "@/components/course/shared"
import {
  parseQualityIssues,
  deriveQualityStages,
  getScoreRingTone,
  getRingColor,
  getModalStatusLabel,
  getAttemptDisplayLabel,
} from "@/lib/section-quality-gates"

interface SectionQualityModalProps {
  section: {
    id: string
    title: string
    verificationScore: number | null
    verificationIssues: string | null
    processed: boolean
  }
  onClose: () => void
  actions?: React.ReactNode
}

export function SectionQualityModal({ section, onClose, actions }: SectionQualityModalProps) {
  const score = section.verificationScore ?? -1
  const isSkipped = score === -1

  const issuesObj = parseQualityIssues(section.verificationIssues)
  const stages = deriveQualityStages(issuesObj, score, section.processed)
  const isFullyApproved = stages.published || (section.processed && score === 100 && stages.mufettis)

  const ringTone = getScoreRingTone(score, stages, section.processed, isSkipped)
  const ringColor = getRingColor(ringTone)
  const ringBg = isSkipped ? "bg-slate-500/10 text-slate-400 border-slate-500/20" :
                 ringTone === "green" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/5" :
                 ringTone === "amber" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                 "bg-red-500/10 text-red-400 border-red-500/20"

  // Score circle svg parameters
  const size = 110
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circ = radius * 2 * Math.PI
  const displayScore = isSkipped ? 0 : score
  const offset = circ - (displayScore / 100) * circ

  const isGenericEmpty = (s: string) => {
    if (!s || typeof s !== "string") return true;
    const lower = s.toLowerCase().trim();
    return lower === "yok" || lower === "yoktur" || lower === "-" || lower === "bulunmamaktadır" || 
           lower === "tespit edilemedi" || lower === "doğrulama yapılamadı" || lower === "boş" || 
           lower === "none" || lower === "n/a" || lower === "bulunmuyor";
  };

  const allMissingTopics = (issuesObj.missingTopics || issuesObj.missingDetails || []).filter((s: string) => !isGenericEmpty(s))
  const allValidationIssues = (issuesObj.issues || issuesObj.contradictions || []).filter((s: string) => !isGenericEmpty(s))
  const suggestions = issuesObj.suggestions || []
  const attemptHistory = issuesObj.attemptHistory || []
  const actualAttempt = issuesObj.currentAttempt || (attemptHistory.length > 0 ? attemptHistory.length : 1)
  const currentMicroPhase = issuesObj.currentMicroPhase || null
  const isProcessing = !section.processed && currentMicroPhase != null
  const hasMufettisPassed = stages.mufettis
  const kontrolorApproved = stages.kontrolorGroundTruth

  const kontrolorMissing = allMissingTopics.filter((t: string) => !t.includes("[MÜFETTİŞ"))
  const mufettisMissing = allMissingTopics.filter((t: string) => t.includes("[MÜFETTİŞ"))

  const kontrolorIssues = allValidationIssues.filter((t: string) => !t.includes("[MÜFETTİŞ"))
  const mufettisIssues = allValidationIssues.filter((t: string) => t.includes("[MÜFETTİŞ"))

  const hasKontrolorIssues = kontrolorMissing.length > 0 || kontrolorIssues.length > 0 || suggestions.length > 0
  const hasMufettisIssues = (mufettisMissing.length > 0 || mufettisIssues.length > 0) || (issuesObj.auditResult?.missingDetails?.length > 0) || (issuesObj.auditResult?.contradictions?.length > 0)
  const hasAnyIssues = hasKontrolorIssues || hasMufettisIssues

  // Live Sync Stepper Logic
  const strPhase = currentMicroPhase ? currentMicroPhase.toLowerCase() : "";
  const isLiveUretim = isProcessing && (strPhase.includes("üretiliyor") || strPhase.includes("generation"));
  const isLiveKontrolor = isProcessing && (strPhase.includes("kalite kontrolörü") || strPhase.includes("değerlendiriyor") || strPhase.includes("puanlıyor"));
  const isLiveMufettis = isProcessing && (strPhase.includes("müfettiş") || strPhase.includes("denetim"));
  const isLiveYama = isProcessing && (strPhase.includes("cerrahi yama") || strPhase.includes("ast") || strPhase.includes("patch"));

  const isKontrolorPulsing = isLiveKontrolor || (!isProcessing && !isSkipped && !kontrolorApproved && !hasMufettisIssues);
  const isKontrolorCompleted = isSkipped || isLiveMufettis || isLiveYama || kontrolorApproved || hasMufettisIssues;
  
  const isMufettisPulsing = isLiveMufettis || (!isProcessing && kontrolorApproved && !hasMufettisPassed && !hasMufettisIssues);
  const isMufettisCompleted = isSkipped || isLiveYama || (hasMufettisPassed && !isProcessing) || hasMufettisIssues;

  const isYamaPulsing = isLiveYama || (!isProcessing && hasMufettisIssues && !hasMufettisPassed);

  return (
    <Modal
      onClose={onClose}
      maxWidth="lg"
      zIndex={99999}
      title={section.title}
      icon={<FileText className="w-5 h-5" />}
    >
      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider -mt-4 mb-4">
        KONTROLÖR VE MÜFETTİŞ RAPOR DETAYI
      </div>

      {/* Circular Score Ring & Status */}
      <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white/[0.02] border border-white/[0.04] mb-6 relative">
        <div className="relative inline-flex items-center justify-center mb-3">
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={strokeWidth}
              stroke="rgba(255,255,255,0.04)"
              fill="none"
            />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={strokeWidth}
              stroke={ringColor}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circ}
              initial={{ strokeDashoffset: circ }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-3xl font-black tracking-tight text-white">
              {isSkipped ? "—" : `%${score}`}
            </span>
          </div>
        </div>

        {/* Premium Visual Stepper */}
        <div className="w-full max-w-sm mx-auto mb-6 mt-6">
          <div className="flex items-start justify-between relative w-full px-2">
            
            {/* Step 1: Üretim */}
            <div className="flex flex-col items-center gap-2 z-10 w-16">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/50 text-emerald-400 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <FileText className="w-4 h-4" />
              </div>
              <span className="text-[9px] font-black tracking-widest uppercase text-slate-400 text-center">Üretim</span>
            </div>

            {/* Line 1 -> 2 */}
            <div className="flex-1 h-0.5 mt-4 mx-1 bg-white/[0.05] rounded-full relative overflow-hidden">
              <div className="absolute left-0 top-0 h-full bg-emerald-500 transition-all duration-1000" style={{
                width: isSkipped ? "100%" : "100%",
                opacity: isSkipped ? 0.3 : 1,
                filter: isSkipped ? "grayscale(100%)" : "none"
              }} />
            </div>

            {/* Step 2: Kontrolör & Soru Testi */}
            <div className="flex flex-col items-center gap-2 z-10 w-20">
              <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 ${
                isSkipped ? "bg-slate-500/10 border-slate-500/50 text-slate-400" :
                isKontrolorCompleted ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]" :
                isKontrolorPulsing ? "bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)] animate-pulse" :
                "bg-white/[0.02] border-white/[0.05] text-slate-600"
              }`}>
                <Bot className="w-4 h-4" />
              </div>
              <span className={`text-[9px] font-black tracking-widest uppercase text-center leading-tight ${
                isSkipped ? "text-slate-500" :
                isKontrolorCompleted ? "text-emerald-500" :
                isKontrolorPulsing ? "text-amber-500" :
                "text-slate-600"
              }`}>Kontrolör<br/><span className="text-[7px] opacity-70">(+ Ground Truth)</span></span>
            </div>

            {/* Line 2 -> 3 */}
            <div className="flex-1 h-0.5 mt-4 mx-1 bg-white/[0.05] rounded-full relative overflow-hidden">
              <div className="absolute left-0 top-0 h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-1000" style={{
                width: isSkipped ? "100%" : isMufettisCompleted ? "100%" : isMufettisPulsing ? "50%" : "0%",
                opacity: isSkipped ? 0.3 : 1,
                filter: isSkipped ? "grayscale(100%)" : "none"
              }} />
            </div>

            {/* Step 3: Müfettiş */}
            <div className="flex flex-col items-center gap-2 z-10 w-16">
              <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 ${
                isSkipped ? "bg-slate-500/10 border-slate-500/50 text-slate-400" :
                hasMufettisPassed && !isProcessing ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]" :
                isMufettisCompleted ? "bg-red-500/10 border-red-500/50 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.15)]" :
                isMufettisPulsing ? "bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)] animate-pulse" :
                "bg-white/[0.02] border-white/[0.05] text-slate-600"
              }`}>
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className={`text-[9px] font-black tracking-widest uppercase text-center ${
                isSkipped ? "text-slate-500" :
                hasMufettisPassed && !isProcessing ? "text-emerald-500" :
                isMufettisCompleted ? "text-red-500" :
                isMufettisPulsing ? "text-blue-500" :
                "text-slate-600"
              }`}>Müfettiş</span>
            </div>

            {/* Line 3 -> 4 */}
            <div className="flex-1 h-0.5 mt-4 mx-1 bg-white/[0.05] rounded-full relative overflow-hidden">
              <div className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-1000" style={{
                width: isMufettisCompleted && (isYamaPulsing || (!isProcessing && hasMufettisIssues)) ? "100%" : "0%",
                opacity: 1
              }} />
            </div>

            {/* Step 4: Cerrahi Yama */}
            <div className="flex flex-col items-center gap-2 z-10 w-16">
              <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 ${
                isYamaPulsing ? "bg-purple-500/10 border-purple-500/50 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.15)] animate-pulse" :
                (!isProcessing && hasMufettisIssues) ? "bg-purple-500/10 border-purple-500/50 text-purple-400" :
                "bg-white/[0.02] border-white/[0.05] text-slate-600"
              }`}>
                <Sparkles className="w-4 h-4" />
              </div>
              <span className={`text-[9px] font-black tracking-widest uppercase text-center ${
                isYamaPulsing || (!isProcessing && hasMufettisIssues) ? "text-purple-500" :
                "text-slate-600"
              }`}>Cerrahi<br/>Yama</span>
            </div>
          </div>
          
          {/* Status Label (Current Attempt or Pass status) */}
          <div className="mt-5 text-center flex justify-center">
            {(() => {
              const statusLabel = getModalStatusLabel(
                stages,
                section.processed,
                isProcessing,
                isSkipped,
                hasMufettisIssues,
                actualAttempt,
                currentMicroPhase
              )
              const statusTone = isProcessing
                ? "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)] animate-pulse"
                : isSkipped
                  ? "bg-slate-500/5 text-slate-400 border-slate-500/20"
                  : isFullyApproved
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/5"
                    : hasMufettisIssues
                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : kontrolorApproved && !hasMufettisPassed
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              return (
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${statusTone}`}>
                  {statusLabel}
                </div>
              )
            })()}
          </div>
          
          {/* Live Operation Radar */}
          {isProcessing && (
            <div className="mt-4 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 text-left flex items-start gap-3">
              <RefreshCw className="w-5 h-5 text-blue-400 animate-spin shrink-0 mt-0.5" />
              <div>
                <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping"></span>
                  CANLI OPERASYON MERKEZİ
                </h4>
                <p className="text-[11px] text-blue-300/80 font-medium leading-relaxed">
                  Şu anda Arka Plan Yapay Zeka Motoru devrede. Canlı durum: <br />
                  <span className="text-white font-bold">{currentMicroPhase}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {hasKontrolorIssues && (
          <div className={`w-full mt-5 p-4 rounded-xl border space-y-2 text-left ${score === 100 ? "bg-emerald-500/5 border-emerald-500/10" : "bg-amber-500/5 border-amber-500/10"}`}>
            <h4 className={`text-[10px] font-black tracking-wider uppercase flex items-center gap-1.5 ${score === 100 ? "text-emerald-500" : "text-amber-500"}`}>
              <Bot className="w-3.5 h-3.5" />
              KALİTE KONTROLÖRÜ TESPİTLERİ (GENEL KAPSAM VE AKICILIK)
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-2">
              {score === 100 
                ? "Ders notu kusursuz bulundu ancak kaliteyi artırmak için aşağıdaki küçük öneriler not düşüldü:" 
                : "Aşağıdaki eksikler nedeniyle ders notu henüz tam kapasitesine ulaşmadı:"}
            </p>
            <ul className="list-disc pl-4 text-[11px] text-slate-300 space-y-1">
              {kontrolorMissing.map((t: string, idx: number) => (
                <li key={`mt-${idx}`} className="leading-relaxed">
                  <span className="text-amber-500 font-bold">Eksik/Yetersiz:</span> {t}
                </li>
              ))}
              {kontrolorIssues.map((i: string, idx: number) => (
                <li key={`vi-${idx}`} className="leading-relaxed">
                  <span className="text-red-400 font-bold">Bilgi Çelişkisi:</span> {i}
                </li>
              ))}
              {suggestions.map((s: string, idx: number) => (
                <li key={`sug-${idx}`} className="leading-relaxed">
                  <span className="text-emerald-400 font-bold">İyileştirme Önerisi:</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Müfettiş Bulgu Raporu (Sadece hata varsa göster) */}
        {hasMufettisIssues && (
          <div className="w-full mt-4 p-4 rounded-xl bg-red-500/5 border border-red-500/20 space-y-2 text-left animate-pulse">
            <h4 className="text-[10px] font-black tracking-wider text-red-500 uppercase flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              MÜFETTİŞ TESPİTLERİ (KILCAL DETAY KONTROLÜ)
            </h4>
            <p className="text-[11px] text-red-400/80 leading-relaxed mb-2 font-medium">
              Kalite Kontrolörü onayından geçmesine rağmen, Müfettişin kaynak PDF ile satır satır çapraz eşleşmesinde yakaladığı kritik hatalar aşağıdadır:
            </p>
            <ul className="list-disc pl-4 text-[11px] text-slate-300 space-y-1.5">
              {mufettisMissing.map((d: string, idx: number) => (
                <li key={`md-${idx}`} className="leading-relaxed">
                  <span className="text-amber-400 font-bold block mb-0.5">Eksik Detay:</span> {d.replace(/\[(?:MÜFETTİŞ (?:EKSİĞİ|HATASI)|CRITICAL|MEDIUM|LOW)\]\s*/g, "")}
                </li>
              ))}
              {issuesObj.auditResult?.missingDetails?.map((d: string, idx: number) => (
                <li key={`mda-${idx}`} className="leading-relaxed">
                  <span className="text-amber-400 font-bold block mb-0.5">Eksik Detay:</span> {d.replace(/\[(?:MÜFETTİŞ (?:EKSİĞİ|HATASI)|CRITICAL|MEDIUM|LOW)\]\s*/g, "")}
                </li>
              ))}
              
              {mufettisIssues.map((c: string, idx: number) => (
                <li key={`mc-${idx}`} className="leading-relaxed">
                  <span className="text-red-400 font-bold block mb-0.5">Mevzuat/Mantık Hatası:</span> {c.replace(/\[(?:MÜFETTİŞ (?:EKSİĞİ|HATASI)|CRITICAL|MEDIUM|LOW)\]\s*/g, "")}
                </li>
              ))}
              {issuesObj.auditResult?.contradictions?.map((c: string, idx: number) => (
                <li key={`mca-${idx}`} className="leading-relaxed">
                  <span className="text-red-400 font-bold block mb-0.5">Mevzuat/Mantık Hatası:</span> {c.replace(/\[(?:MÜFETTİŞ (?:EKSİĞİ|HATASI)|CRITICAL|MEDIUM|LOW)\]\s*/g, "")}
                </li>
              ))}
            </ul>
            
            {/* Cerrahi Yama İndikatörü */}
            <div className="mt-4 pt-3 border-t border-red-500/20 bg-purple-500/10 p-3 rounded-lg flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1">Cerrahi Yama Aktif</div>
                <div className="text-[10px] text-purple-300/80">Sistem, notları sıfırdan yazmak yerine sadece yukarıdaki eksikleri orijinal kaynak PDF ile doğrulayarak mevcut nota akıllıca zerk ediyor. (AST Injection)</div>
              </div>
            </div>
          </div>
        )}

        {/* Logs & Geçmiş Toggle'ları */}
        <div className="w-full mt-6 space-y-3">
          
          {/* Process Log Accordion */}
          <details className="group rounded-xl overflow-hidden border border-white/[0.04] bg-white/[0.01]">
            <summary className="p-3.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-white/[0.02] flex items-center justify-between transition-colors list-none">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" /> SİSTEM İŞLEM LOGU
              </span>
              <ChevronRight className="w-4 h-4 text-slate-600 transform transition-transform group-open:rotate-90" />
            </summary>
            <div className="p-4 border-t border-white/[0.04] bg-black/20">
              <h4 className={`text-[11px] font-bold flex items-center gap-1.5 mb-2 ${
                isSkipped ? "text-slate-400" :
                isFullyApproved ? "text-emerald-400" :
                kontrolorApproved && !hasMufettisPassed ? "text-blue-400" :
                "text-red-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-ping ${
                  isSkipped ? "bg-slate-400" :
                  isFullyApproved ? "bg-emerald-400" :
                  kontrolorApproved && !hasMufettisPassed ? "bg-blue-400" :
                  "bg-red-400"
                }`} />
                {isSkipped ? "Doğrulama Bypass Edildi" :
                  isFullyApproved ? "Kalite Kontrolörü ve Müfettiş Onay Süreci" :
                  kontrolorApproved && !hasMufettisPassed ? "Kontrolör Onayı Tamam — Müfettiş Bekleniyor" :
                  "Kalite İyileştirme Süreci Devam Ediyor"}
              </h4>
              <p className="text-[11px] text-slate-400 leading-relaxed text-justify mb-3">
                {isSkipped 
                  ? "Bu ders notu, API limitleri veya teknik zorunluluklar sebebiyle çok turlu kalite iyileştirme döngüsüne girmeden tek aşamalı olarak üretilmiştir."
                  : isFullyApproved 
                  ? "Bu ders notu, Kalite Kontrolörü tarafından kaynak dokümandaki yasal süreler ve kavramlar açısından incelenmiş, ardından Müfettiş tarafından teknik ve yasal detay seviyesinde denetlenerek çift aşamalı onaydan geçmiştir."
                  : kontrolorApproved && !hasMufettisPassed
                  ? "Kalite Kontrolörü notu onayladı. Müfettiş derin denetimi henüz tamamlanmadı veya devam ediyor; tam onay için Müfettiş aşamasının geçmesi gerekir."
                  : "Bu ders notu üzerinde Kalite Kontrolörü incelemesi yapılmış olup, tespit edilen eksiklikler veya bilgi hataları nedeniyle not geliştirilme aşamasındadır. Müfettiş denetimine henüz hazır değildir."}
              </p>
              <div className="text-[10px] text-slate-500 font-mono leading-relaxed whitespace-pre-line border-t border-white/[0.04] pt-3">
                [AI-PROCESS-LOG] {isSkipped 
                  ? "API limitleri ve kota kısıtlamaları nedeniyle çok turlu kalite iyileştirme döngüsü bypass edilerek tek aşamada tamamlandı." 
                  : isFullyApproved
                  ? `Kalite Kontrolörü ve Müfettiş analizi başarıyla tamamlandı. Notun müfredat kapsamını eksiksiz karşıladığı, yasal çerçeve ve terimlerin yüksek doğruluk oranıyla aktarıldığı teyit edildi.`
                  : kontrolorApproved && !hasMufettisPassed
                  ? `Kalite Kontrolörü %100 onay verdi. Müfettiş denetimi henüz tam onay aşamasına ulaşmadı.`
                  : `Kalite Kontrolörü incelemesi tamamlandı. Puan: %${score}. Notta ${kontrolorMissing.length} eksik konu ve ${kontrolorIssues.length} bilgi hatası düzeltilmeyi bekliyor.`}
              </div>
            </div>
          </details>

          {/* Kalite İyileştirme Geçmişi (Zaman Tüneli) Accordion */}
          {attemptHistory.length > 0 && (
            <details className="group rounded-xl overflow-hidden border border-white/[0.04] bg-white/[0.01]">
              <summary className="p-3.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-white/[0.02] flex items-center justify-between transition-colors list-none">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-slate-500" /> GELİŞTİRME GEÇMİŞİNİ GÖR ({attemptHistory.length} TUR)
                </span>
                <ChevronRight className="w-4 h-4 text-slate-600 transform transition-transform group-open:rotate-90" />
              </summary>
              <div className="p-4 border-t border-white/[0.04] bg-black/20 grid gap-3">
                {attemptHistory.map((h: any, hIdx: number) => (
                  <div key={hIdx} className="p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.03] flex flex-col gap-2 hover:bg-white/[0.02] transition-colors">
                    {(() => {
                      const hMissing = h.missingTopics || h.missingDetails || [];
                      const hIssues = h.issues || h.contradictions || [];
                      const hSuggestions = h.suggestions || [];
                      
                      const kaliteMissing = hMissing.filter((m: string) => !m.includes("[MÜFETTİŞ"));
                      const groundTruthMissing = kaliteMissing.filter((m: string) => m.includes("Ground Truth Testi Başarısız"));
                      const pureKaliteMissing = kaliteMissing.filter((m: string) => !m.includes("Ground Truth Testi Başarısız"));

                      const mufettisMissing = hMissing.filter((m: string) => m.includes("[MÜFETTİŞ"));
                      
                      const kaliteIssues = hIssues.filter((i: string) => !i.includes("[MÜFETTİŞ"));
                      const groundTruthIssues = kaliteIssues.filter((i: string) => i.includes("Ground Truth Testi Başarısız"));
                      const pureKaliteIssues = kaliteIssues.filter((i: string) => !i.includes("Ground Truth Testi Başarısız"));

                      const mufettisIssues = hIssues.filter((i: string) => i.includes("[MÜFETTİŞ"));

                      const displayScore = h.score;
                      const attemptLabel = getAttemptDisplayLabel(h, section.processed);
                      const isTrulyPerfect = attemptLabel.isFullyApproved;
                      const isKontrolorOnlyPerfect = attemptLabel.isKontrolorOnly;

                      return (
                        <>
                          <div className="flex items-center justify-between border-b border-white/[0.03] pb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-slate-500 font-bold">
                                {h.attempt === 0 ? "İlk Analiz:" : `#${h.attempt}. Tur:`}
                              </span>
                              {isTrulyPerfect ? (
                                <span className="text-emerald-400 font-bold">{attemptLabel.headline}</span>
                              ) : isKontrolorOnlyPerfect ? (
                                <span className="text-blue-400 font-bold">{attemptLabel.headline}</span>
                              ) : h.attempt === 0 ? (
                                <span className="text-amber-400/90 font-bold">Eksikler / Öneriler Tespit Edildi</span>
                              ) : (
                                <span className="text-amber-400/90 font-bold">Eksikler / Öneriler Giderildi</span>
                              )}
                            </div>
                            <span className={`font-black text-xs ${isTrulyPerfect ? 'text-emerald-400' : isKontrolorOnlyPerfect ? 'text-blue-400' : displayScore >= 95 ? 'text-emerald-400' : 'text-slate-400'}`}>%{displayScore}</span>
                          </div>

                          <div className="flex flex-col gap-2 mt-1">
                            {isTrulyPerfect ? (
                              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                                <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" /> SİSTEM ONAY RAPORU
                                </div>
                                <div className="text-[11px] text-emerald-400/80 leading-relaxed font-medium">
                                  Kalite Kontrolörü ve Müfettiş denetimi tamamlandı. Kaynak materyaldeki kavramlar yüksek doğrulukla aktarıldı.
                                </div>
                                {hSuggestions.length > 0 && (
                                  <div className="text-[10px] text-emerald-400/90 mt-2 pt-2 border-t border-emerald-500/10">
                                    <span className="font-bold text-emerald-500/70">Not Düşülen Öneri:</span>
                                    <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                      {hSuggestions.map((m: string, idx: number) => <li key={idx}>{m}</li>)}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            ) : isKontrolorOnlyPerfect ? (
                              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                                <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                  <Bot className="w-3.5 h-3.5" /> KONTROLÖR ONAY RAPORU
                                </div>
                                <div className="text-[11px] text-blue-400/80 leading-relaxed font-medium">
                                  Kalite Kontrolörü %100 onay verdi. Müfettiş denetimi bu turda henüz tamamlanmadı veya devam ediyor.
                                </div>
                                {hSuggestions.length > 0 && (
                                  <div className="text-[10px] text-blue-400/90 mt-2 pt-2 border-t border-blue-500/10">
                                    <span className="font-bold text-blue-500/70">Not Düşülen Öneri:</span>
                                    <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                      {hSuggestions.map((m: string, idx: number) => <li key={idx}>{m}</li>)}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                {(pureKaliteMissing.length > 0 || pureKaliteIssues.length > 0 || hSuggestions.length > 0) && (
                                  <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                    <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                      <Bot className="w-3 h-3" /> KALİTE KONTROLÖRÜ (YAPAY ZEKA) BULGULARI
                                    </div>
                                    {pureKaliteMissing.length > 0 && (
                                      <div className="text-[10px] text-slate-400 mb-1">
                                        <span className="font-bold text-slate-500">Eksik Konular:</span>
                                        <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                          {pureKaliteMissing.map((m: string, idx: number) => <li key={idx}>{m}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                    {pureKaliteIssues.length > 0 && (
                                      <div className="text-[10px] text-red-400/90 mb-1">
                                        <span className="font-bold text-red-500/70">Bilgi Hataları:</span>
                                        <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                          {pureKaliteIssues.map((m: string, idx: number) => <li key={idx}>{m}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                    {hSuggestions.length > 0 && (
                                      <div className="text-[10px] text-amber-400/90">
                                        <span className="font-bold text-amber-500/70">Yapay Zeka Yorumu/Önerisi:</span>
                                        <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                          {hSuggestions.map((m: string, idx: number) => <li key={idx}>{m}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}
                                
                                {(groundTruthMissing.length > 0 || groundTruthIssues.length > 0) && (
                                  <div className="p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
                                    <div className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                      <Search className="w-3 h-3" /> ÇAPRAZ SORGULAMA (GROUND TRUTH) TESTİ
                                    </div>
                                    <div className="text-[9px] text-purple-400/70 mb-2 italic">
                                      Yapay zeka notu yeterli bulsa bile, algoritmamız aşağıdaki kritik soruların cevabını notta bulamadığı için manuel ceza puanı uygulamıştır.
                                    </div>
                                    {groundTruthMissing.length > 0 && (
                                      <div className="text-[10px] text-purple-300/90 mb-1">
                                        <span className="font-bold text-purple-400/80">Bulunamayan Detaylar:</span>
                                        <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                          {groundTruthMissing.map((m: string, idx: number) => <li key={idx}>{m.replace("Eksik Detay (Ground Truth Testi Başarısız): ", "")}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                    {groundTruthIssues.length > 0 && (
                                      <div className="text-[10px] text-red-400/90">
                                        <span className="font-bold text-red-500/70">Hatalar:</span>
                                        <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                          {groundTruthIssues.map((m: string, idx: number) => <li key={idx}>{m.replace("Eksik Detay (Ground Truth Testi Başarısız): ", "")}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}
                              
                              {(mufettisMissing.length > 0 || mufettisIssues.length > 0) && (
                                <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                                  <div className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" /> MÜFETTİŞ BULGULARI
                                  </div>
                                  {mufettisMissing.length > 0 && (
                                    <div className="text-[10px] text-amber-400/90 mb-1">
                                      <span className="font-bold text-amber-500/70">Eksik Detaylar:</span>
                                      <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                        {mufettisMissing.map((m: string, idx: number) => <li key={idx}>{m.replace(/\[(?:MÜFETTİŞ (?:EKSİĞİ|HATASI)|CRITICAL|MEDIUM|LOW)\]\s*/g, "")}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {mufettisIssues.length > 0 && (
                                    <div className="text-[10px] text-red-400/90">
                                      <span className="font-bold text-red-500/70">Bilgi Hataları:</span>
                                      <ul className="list-disc pl-3.5 space-y-0.5 mt-0.5">
                                        {mufettisIssues.map((m: string, idx: number) => <li key={idx}>{m.replace(/\[(?:MÜFETTİŞ (?:EKSİĞİ|HATASI)|CRITICAL|MEDIUM|LOW)\]\s*/g, "")}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-6 border-t border-white/[0.05]">
        {actions}
        <button
          onClick={onClose}
          className="px-6 py-3 rounded-xl font-bold transition-all text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 flex items-center justify-center gap-1.5"
        >
          Kapat
        </button>
      </div>
    </Modal>
  )
}
