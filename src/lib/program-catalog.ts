/**
 * Tek kaynak: tüm sınav programlarının kullanıcıya görünen adları, alt başlıkları,
 * renkleri ve veritabanı tohum (seed) alanları burada tanımlanır.
 *
 * İsim kalıbı (yeknesak):  KISALTMA — Tam Türkçe Ad
 * Alt satır kalıbı:       Kurum · Sınav yapısı · Soru/süre özeti
 */

import { getExamPartCourseSlugs } from "./course-data"

export type ProgramAiMode = "finance" | "law" | "international_audit" | "language" | "general"

export type ProgramIconName =
  | "Shield"
  | "Scale"
  | "Brain"
  | "Award"
  | "ShieldCheck"
  | "ClipboardList"

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
  const partSlugs = getExamPartCourseSlugs(programSlug)
  const count = partSlugs.length
  const unit = getProgramCardUnit(programSlug)

  if (unit === "oturum") return "1 Oturum"
  if (unit === "parça") return `${count} Parça`
  return `${count} Ders`
}

/** Tek bir sınav kartının sol üst rozeti */
export function getCourseCardBadge(programSlug: string | undefined, order: number): string {
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
  switch (programSlug) {
    case "cia":
      return "Parçaya Git"
    case "cisa":
      return "Oturuma Git"
    default:
      return "Derse Git"
  }
}
