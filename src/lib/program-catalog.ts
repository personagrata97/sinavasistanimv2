/**
 * Tek kaynak: tüm sınav programlarının kullanıcıya görünen adları, alt başlıkları,
 * renkleri ve veritabanı tohum (seed) alanları burada tanımlanır.
 *
 * İsim kalıbı (yeknesak):  KISALTMA — Tam Türkçe Ad
 * Alt satır kalıbı:       Kurum · Sınav yapısı · Soru/süre özeti
 */

import { getExamPartCourseSlugs } from "./course-data"

export type ProgramAiMode = "finance" | "law" | "international_audit" | "language" | "general" | "mevzuat"

export type ProgramKind = "exam" | "professional"

export type ProgramAudience = "public" | "restricted"

export type ProgramIconName =
  | "Shield"
  | "Scale"
  | "Brain"
  | "Award"
  | "ShieldCheck"
  | "ClipboardList"
  | "Heart"

export interface ProgramTheme {
  text: string
  border: string
  cta: string
  gradient: string
  bgAccent: string
}

export interface ProgramCatalogEntry {
  slug: string
  /** Ana kart / sayfa başlığı */
  displayName: string
  /** Kart alt satırı */
  subtitle: string
  /** Veritabanı Program.name — panel ve admin için */
  dbName: string
  /** Veritabanı Program.description */
  dbDescription: string
  aiMode: ProgramAiMode
  icon: ProgramIconName
  theme: ProgramTheme
  ready: boolean
  order: number
  /** exam = sınav hazırlığı, professional = kişisel gelişim (sınav tarihi yok) */
  kind?: ProgramKind
  /** restricted = yalnızca allowedProgramSlugs veya admin */
  audience?: ProgramAudience
}

export const PROGRAM_CATALOG: ProgramCatalogEntry[] = [
  {
    slug: "spl-duzey-3",
    displayName: "SPL Düzey 3 — Sermaye Piyasası Faaliyetleri Lisansı",
    subtitle: "SPL · 12 ders · 25 soru / ders",
    dbName: "SPL Düzey 3 — Sermaye Piyasası Faaliyetleri Lisansı",
    dbDescription: "Sermaye Piyasası Lisanslama Sınavı (Düzey 3). SPL resmi müfredatı, 12 ders, her dersten 25 soru.",
    aiMode: "finance",
    icon: "Shield",
    theme: {
      text: "text-indigo-400",
      border: "hover:border-indigo-500/30",
      cta: "text-indigo-400",
      gradient: "from-indigo-900/40 to-slate-900/40",
      bgAccent: "bg-indigo-500/10",
    },
    ready: true,
    order: 1,
  },
  {
    slug: "masak",
    displayName: "MASAK — Uyum Görevlisi Yetkilendirme Sınavı",
    subtitle: "SPK/SPL · 2 modül · 50 soru / modül",
    dbName: "MASAK — Uyum Görevlisi Yetkilendirme Sınavı",
    dbDescription: "MASAK uyum görevlisi yetkilendirme sınavı. AML/CFT mevzuatı, şüpheli işlem bildirimi ve risk yönetimi.",
    aiMode: "law",
    icon: "Scale",
    theme: {
      text: "text-amber-400",
      border: "hover:border-amber-500/30",
      cta: "text-amber-400",
      gradient: "from-amber-900/40 to-slate-900/40",
      bgAccent: "bg-amber-500/10",
    },
    ready: true,
    order: 2,
  },
  {
    slug: "spl-bagimsiz-denetim",
    displayName: "BSBD — Bilgi Sistemleri Bağımsız Denetim Lisansı",
    subtitle: "SPL · 5 ders · 25 soru / ders",
    dbName: "BSBD — Bilgi Sistemleri Bağımsız Denetim Lisansı",
    dbDescription: "SPL Bilgi Sistemleri Bağımsız Denetim lisans sınavı. BSBD tebliği kapsamında bilgi güvenliği ve denetim.",
    aiMode: "finance",
    icon: "Brain",
    theme: {
      text: "text-emerald-400",
      border: "hover:border-emerald-500/30",
      cta: "text-emerald-400",
      gradient: "from-emerald-900/40 to-slate-900/40",
      bgAccent: "bg-emerald-500/10",
    },
    ready: true,
    order: 3,
  },
  {
    slug: "cisa",
    displayName: "CISA — Bilgi Sistemleri Denetçisi Sertifikası",
    subtitle: "ISACA · 1 oturum · 150 soru",
    dbName: "CISA — Bilgi Sistemleri Denetçisi Sertifikası",
    dbDescription: "ISACA CISA sınavı. Tek oturum, 150 soru, 240 dakika. Notlar Türkçe; soru ve flashcard TR+EN.",
    aiMode: "international_audit",
    icon: "Award",
    theme: {
      text: "text-sky-400",
      border: "hover:border-sky-500/30",
      cta: "text-sky-400",
      gradient: "from-sky-900/40 to-slate-900/40",
      bgAccent: "bg-sky-500/10",
    },
    ready: true,
    order: 4,
  },
  {
    slug: "cia",
    displayName: "CIA — Uluslararası İç Denetçi Sertifikası",
    subtitle: "IIA · 3 parça · 325 soru",
    dbName: "CIA — Uluslararası İç Denetçi Sertifikası",
    dbDescription: "IIA CIA sınavı. Üç parça, çoktan seçmeli. Notlar Türkçe; soru ve flashcard TR+EN.",
    aiMode: "international_audit",
    icon: "ShieldCheck",
    theme: {
      text: "text-violet-400",
      border: "hover:border-violet-500/30",
      cta: "text-violet-400",
      gradient: "from-violet-900/40 to-slate-900/40",
      bgAccent: "bg-violet-500/10",
    },
    ready: true,
    order: 5,
  },
  {
    slug: "smmm",
    displayName: "SMMM — Mali Müşavir Yeterlilik Sınavı",
    subtitle: "TÜRMOB/TESMER · 8 ders · test usulü",
    dbName: "SMMM — Mali Müşavir Yeterlilik Sınavı",
    dbDescription: "TÜRMOB/TESMER Serbest Muhasebeci Mali Müşavir yeterlilik sınavı. 8 ders, test usulü, 2 oturum.",
    aiMode: "finance",
    icon: "ClipboardList",
    theme: {
      text: "text-orange-400",
      border: "hover:border-orange-500/30",
      cta: "text-orange-400",
      gradient: "from-orange-900/40 to-slate-900/40",
      bgAccent: "bg-orange-500/10",
    },
    ready: true,
    order: 6,
  },
  {
    slug: "zeliha-mevzuat",
    displayName: "Zeliha — Mevzuat Gelişim Alanı",
    subtitle: "İhracat kredileri · Bankacılık · Dış ticaret · KVKK · Kişisel gelişim",
    dbName: "Zeliha — Mevzuat Gelişim Alanı",
    dbDescription:
      "İhracat, dış ticaret ve bankacılık mevzuatı uzmanlığı için kanun, rejim, kambiyo, KVKK ve ilgili düzenlemeler. Sınav tarihi yok; not, kart, soru ve konu testi.",
    aiMode: "mevzuat",
    icon: "Heart",
    theme: {
      text: "text-rose-400",
      border: "hover:border-rose-500/30",
      cta: "text-rose-400",
      gradient: "from-rose-900/40 to-slate-900/40",
      bgAccent: "bg-rose-500/10",
    },
    ready: true,
    order: 7,
    kind: "professional",
    audience: "restricted",
  },
  {
    slug: "yds",
    displayName: "YDS — Yabancı Dil Bilgisi Seviye Tespit Sınavı",
    subtitle: "ÖSYM · YDS / YÖKDİL",
    dbName: "YDS — Yabancı Dil Bilgisi Seviye Tespit Sınavı",
    dbDescription: "Yabancı Dil Bilgisi Seviye Tespit Sınavı (YDS) ve YÖKDİL hazırlık programı.",
    aiMode: "language",
    icon: "Brain",
    theme: {
      text: "text-emerald-400",
      border: "hover:border-emerald-500/30",
      cta: "text-emerald-400",
      gradient: "from-emerald-900/40 to-slate-900/40",
      bgAccent: "bg-emerald-500/10",
    },
    ready: false,
    order: 99,
  },
]

export function getProgramBySlug(slug: string): ProgramCatalogEntry | undefined {
  return PROGRAM_CATALOG.find(p => p.slug === slug)
}

export function getReadyPrograms(): ProgramCatalogEntry[] {
  return PROGRAM_CATALOG.filter(p => p.ready).sort((a, b) => a.order - b.order)
}

export function getProgramSeedRows(): Array<{
  slug: string
  name: string
  description: string
  aiMode: ProgramAiMode
}> {
  return PROGRAM_CATALOG.map(p => ({
    slug: p.slug,
    name: p.dbName,
    description: p.dbDescription,
    aiMode: p.aiMode,
  }))
}

/** Katalogda tanımlı slug'ların tam listesi (testler için) */
export const ALL_PROGRAM_SLUGS = PROGRAM_CATALOG.map(p => p.slug)

/** Aktif (hazır) program slug'ları */
export const READY_PROGRAM_SLUGS = getReadyPrograms().map(p => p.slug)

/**
 * Sınav kartı isimlendirme sözlüğü (yeknesak):
 *   • Ders   → SPL, BSBD, SMMM, MASAK (her kart = çalışılacak sınav konusu)
 *   • Parça  → CIA (sınav parçası Part 1/2/3)
 *   • Oturum → CISA (tek oturumda yapılan sınav)
 *   • Modül  → yalnızca MASAK sınav kuralları / deneme ekranında (2 modül); kart etiketinde KULLANILMAZ
 */
export type ProgramCardUnit = "ders" | "parça" | "oturum"

export function getProgramCardUnit(programSlug: string): ProgramCardUnit {
  switch (programSlug) {
    case "cia":
      return "parça"
    case "cisa":
      return "oturum"
    default:
      return "ders"
  }
}

/** Program sayfası üst sayacı — kart birimine göre */
export function getProgramGridLabel(programSlug: string): string {
  if (programSlug === "zeliha-mevzuat") {
    const count = getExamPartCourseSlugs(programSlug).length
    return `${count} Mevzuat Modülü`
  }
  const partSlugs = getExamPartCourseSlugs(programSlug)
  const count = partSlugs.length
  const unit = getProgramCardUnit(programSlug)

  if (unit === "oturum") return "1 Oturum"
  if (unit === "parça") return `${count} Parça`
  return `${count} Ders`
}

/** Tek bir sınav kartının sol üst rozeti */
export function getCourseCardBadge(programSlug: string | undefined, order: number): string {
  if (programSlug === "zeliha-mevzuat") return `Modül ${order}`
  switch (programSlug) {
    case "cia":
      return `Parça ${order}`
    case "cisa":
      return "Oturum"
    case "masak":
      return "Ders"
    default:
      return `Ders ${order}`
  }
}

/** Kart altındaki gezinme metni */
export function getCourseCardCta(programSlug: string | undefined): string {
  if (programSlug === "zeliha-mevzuat") return "Modüle Git"
  switch (programSlug) {
    case "cia":
      return "Parçaya Git"
    case "cisa":
      return "Oturuma Git"
    default:
      return "Derse Git"
  }
}

export function isProfessionalProgram(programSlug: string): boolean {
  return getProgramBySlug(programSlug)?.kind === "professional"
}

/** Sınav hazırlığı vs mevzuat gelişim alanı — kullanıcıya görünen metinler */
export function getStudyNotFoundMessage(programSlug: string): string {
  return isProfessionalProgram(programSlug) ? "Çalışma bulunamadı" : "Ders bulunamadı"
}

export function getStudyListBackLabel(programSlug: string): string {
  return isProfessionalProgram(programSlug) ? "Modül listesine dön" : "Ders listesine dön"
}

export function getUploadModalDescription(programSlug: string): string {
  return isProfessionalProgram(programSlug)
    ? "Bu çalışma için kaynak PDF dosyasını buradan yükleyebilir veya değiştirebilirsiniz."
    : "Ders için kaynak PDF dosyasını buradan yükleyebilir veya değiştirebilirsiniz."
}

export function getPdfPendingLabel(programSlug: string): string {
  return isProfessionalProgram(programSlug) ? "Kaynak PDF yüklenecek" : "Ders notu yüklenecek"
}

export function getCancelProcessMessage(programSlug: string): string {
  return isProfessionalProgram(programSlug)
    ? "Dikkat! Süreci iptal ederseniz, şimdiye kadar başarıyla üretilmiş olan tüm çalışma notları, sorular ve flashcardlar kalıcı olarak silinecektir.\n\nBu işlem geri alınamaz!"
    : "Dikkat! Süreci iptal ederseniz, şimdiye kadar başarıyla üretilmiş olan tüm ders notları, sorular ve flashcardlar kalıcı olarak silinecektir.\n\nBu işlem geri alınamaz!"
}

export function getResetProcessMessage(programSlug: string): string {
  return isProfessionalProgram(programSlug)
    ? "Eski çalışma notları, sorular ve flashcardlar tamamen silinerek işleme sıfırdan başlatılacaktır. Bu işlem geri alınamaz!"
    : "Eski ders notları, sorular ve flashcardlar tamamen silinerek işleme sıfırdan başlatılacaktır. Bu işlem geri alınamaz!"
}

export function getPdfUploadHint(programSlug: string): string {
  return isProfessionalProgram(programSlug)
    ? "Henüz PDF yüklenmedi. Yukarıdaki PDF kartından kaynak belgeyi yükle."
    : "Henüz PDF yüklenmedi. Yukarıdaki PDF kartından ders notunu yükle."
}

export function getMaterialsPreparingDescription(isProfessional: boolean): string {
  return isProfessional
    ? "Bu çalışmanın materyalleri yapay zeka asistanımız tarafından arka planda sizin için hazırlanıyor. Lütfen daha sonra tekrar kontrol edin."
    : "Bu dersin materyalleri yapay zeka asistanımız tarafından arka planda sizin için hazırlanıyor. Lütfen daha sonra tekrar kontrol edin."
}

export function getDefaultNoteTitle(isProfessional?: boolean): string {
  return isProfessional ? "Çalışma Notu" : "Ders Notu"
}

export function getNoNotesToast(isProfessional: boolean): string {
  return isProfessional ? "Henüz çalışma notu yok!" : "Henüz ders notu yok!"
}

export function getStudyBuddyIntro(isProfessional: boolean): string {
  return isProfessional
    ? "Bu çalışmanın tüm bölümlerini okudum ve hafızama aldım. Bana şunları sorabilirsin:"
    : "Bu dersin tüm modüllerini okudum ve hafızama aldım. Bana şunları sorabilirsin:"
}

export function getChatNotReadyReply(isProfessional: boolean): string {
  return isProfessional
    ? "Bu çalışmanın içerikleri henüz hazır değil. Önce PDF yükleyip işlenmesini beklemeniz gerekiyor. İçerikler hazır olduğunda benimle sohbet edebilirsiniz!"
    : "Bu dersin içerikleri henüz hazır değil. Önce PDF yükleyip işlenmesini beklemeniz gerekiyor. İçerikler hazır olduğunda benimle sohbet edebilirsiniz!"
}

export function getApprovedNotesNotFoundMessage(programSlug: string): string {
  return isProfessionalProgram(programSlug)
    ? "Onaylı çalışma notu bulunamadı. Önce bölüm notları %98+ skorla üretilmeli."
    : "Onaylı ders notu bulunamadı. Önce bölüm notları %98+ skorla üretilmeli."
}

/** İşleme durumu — Aşama 2 not üretimi (SPL: Ders / Zeliha: Çalışma) */
export function getNotesGenerationPhaseLabel(
  isProfessional: boolean,
  sectionPrefix: string,
  attempt: number,
): string {
  const phaseText = isProfessional ? "Çalışma Notları üretiliyor" : "Ders Notları Üretiliyor"
  return `${sectionPrefix}. Aşama 2: ${phaseText} (Deneme #${attempt})`
}

/** Veritabanındaki eski SPL metinlerini profesyonel programda kullanıcıya gösterirken düzeltir */
export function adaptProcessingPhaseLabel(phaseLabel: string, programSlug: string): string {
  if (!phaseLabel || !isProfessionalProgram(programSlug)) return phaseLabel
  return phaseLabel
    .replace(/Ders Notları Üretiliyor/g, "Çalışma Notları üretiliyor")
    .replace(/Ders Notları/g, "Çalışma Notları")
    .replace(/Ders notu üretimi/gi, "Çalışma notu üretimi")
    .replace(/ders notu üretiliyor/gi, "çalışma notu üretiliyor")
}

type ProcessLabelCourse = {
  status?: string
  _count?: { questions?: number; flashcards?: number }
  sections?: unknown[]
}

/** PDF kartı ve banner — tutarlı işlem butonu metni */
export function getProcessButtonLabel(course: ProcessLabelCourse, processLock: boolean): string {
  if (processLock) return "Çalışıyor..."
  if (course.status === "ready" || course.status === "completed") return "Yeniden Tara"
  const hasContent =
    (course._count?.questions ?? 0) > 0 ||
    (course._count?.flashcards ?? 0) > 0 ||
    (course.sections?.length ?? 0) > 0
  if (!hasContent && course.status === "uploaded") return "İşleme Başlat"
  return "Devam Ettir"
}

export function getProcessBannerHint(course: ProcessLabelCourse = {}): string {
  const label = getProcessButtonLabel(course, false)
  return `İçerik oluşturmak için PDF kartındaki "${label}" butonuna bas.`
}
