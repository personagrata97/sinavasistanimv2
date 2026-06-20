export type DocumentProcessingMode = "single" | "multi"

export type DocumentType =
  | "prosedür"
  | "politika"
  | "talimat"
  | "tebliğ"
  | "yönetmelik"
  | "kanun"
  | "generic"

/** Kısa belgeler: bölüm ayırma yerine tek parça not üretimi */
export const SINGLE_SECTION_MAX_PAGES = 30
export const MEVZUAT_SINGLE_SECTION_MAX_PAGES = 60

export interface DocumentProcessingProfile {
  documentType: DocumentType
  mode: DocumentProcessingMode
  noteStyle: string
  /** Kaynak PDF başlık hiyerarşisinin notta aynen korunması gerekir */
  preserveHeadings: boolean
  reason: string
}

/** Başlık sadakati zorunlu belge türleri (prosedür, politika, kanun vb.) */
export const HEADING_PRESERVATION_DOCUMENT_TYPES: readonly DocumentType[] = [
  "prosedür",
  "politika",
  "talimat",
  "tebliğ",
  "yönetmelik",
  "kanun",
] as const

export function requiresHeadingPreservation(documentType: DocumentType): boolean {
  return (HEADING_PRESERVATION_DOCUMENT_TYPES as readonly string[]).includes(documentType)
}

/** Not üretim prompt'una eklenecek başlık sadakati talimatı */
export const HEADING_PRESERVATION_PROMPT = `
🚨 BAŞLIK SADAKATİ KURALI (EN ÖNCELİKLİ — YAPISAL ÖĞRETİM):
Sıfırdan öğreten bir mentör gibi davran: öğrenci kaynak belgenin iskeletini notta birebir görmeli.
- Kaynak PDF'teki TÜM numaralı ana bölüm başlıklarını (örn: "1. AMAÇ VE KAPSAM", "2. DAYANAK", "3. TANIMLAR") kaynak sırasıyla, numaralarını ve metnini AYNEN koruyarak ## Markdown başlığı olarak yaz.
- Alt başlıklar kaynakta varsa (örn: "6.1.", "Madde 5") ### ile aynı sıra ve metinle koru.
- Başlıkları birleştirme, yeniden adlandırma, atlama veya "3-4 konuya" indirgeme KESİNLİKLE YASAK.
- Tek parça (single) modda bile tüm belge TEK not dosyasında; içeride kaynak başlık hiyerarşisi eksiksiz olmalı — düz özet YASAK.
- Her ## başlık altında o bölümün tüm içeriğini öğret: resmi tanımlar birebir, tablolar, süreçler; anlatım akıcı ve eğlenceli olabilir ama yapı sadakati her şeyden önce gelir.
`.trim()

export interface DocumentProcessingCourseInput {
  slug?: string | null
  name?: string | null
  sourceKind?: string | null
  sourceKindLabel?: string | null
  gridGroup?: string | null
  programSlug?: string | null
  aiMode?: string | null
  totalPages?: number
}

function normalizeTurkish(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function haystack(input: DocumentProcessingCourseInput): string {
  return normalizeTurkish(
    [input.slug, input.name, input.sourceKind, input.sourceKindLabel, input.gridGroup]
      .filter(Boolean)
      .join(" "),
  )
}

function isMevzuatProgram(input: DocumentProcessingCourseInput): boolean {
  const { programSlug, aiMode, slug } = input
  return (
    programSlug === "zeliha-mevzuat" ||
    aiMode === "mevzuat" ||
    (typeof slug === "string" && slug.startsWith("zeliha-"))
  )
}

function isInternalMevzuatDoc(input: DocumentProcessingCourseInput): boolean {
  const label = normalizeTurkish(input.sourceKindLabel ?? "")
  const group = normalizeTurkish(input.gridGroup ?? "")
  const kind = normalizeTurkish(input.sourceKind ?? "")
  return (
    label.includes("ic mevzuat") ||
    group.includes("ic mevzuat") ||
    kind.startsWith("internal")
  )
}

function shortDocSingleLimit(input: DocumentProcessingCourseInput): number {
  return isMevzuatProgram(input) ? MEVZUAT_SINGLE_SECTION_MAX_PAGES : SINGLE_SECTION_MAX_PAGES
}

/** Slug/ad/sourceKind üzerinden belge türünü çıkarır (öncelik sırasıyla) */
export function detectDocumentType(input: DocumentProcessingCourseInput): DocumentType {
  const h = haystack(input)
  const kind = normalizeTurkish(input.sourceKind ?? "")

  if (/\bprosedur\w*/.test(h) || kind === "internal-procedure" || kind === "procedure") {
    return "prosedür"
  }
  if (/\bpolitika\w*/.test(h) || kind === "internal-policy" || kind === "policy") {
    return "politika"
  }
  if (/\btalimat\w*/.test(h) || /\binstruction\b/.test(h)) {
    return "talimat"
  }
  if (/\bteblig\b/.test(h)) {
    return "tebliğ"
  }
  if (/\byonetmelik\b/.test(h) || kind === "external-regulation") {
    return "yönetmelik"
  }
  if (/\bkanun(u)?\b|-kanun(u)?(?:-|$)/.test(h) || kind === "external-law") {
    return "kanun"
  }

  if (isInternalMevzuatDoc(input)) {
    return "generic"
  }

  return "generic"
}

const NOTE_STYLES: Record<DocumentType, string> = {
  prosedür:
    "Kurum prosedürü — 1. AMAÇ VE KAPSAM, 2. DAYANAK, 3. TANIMLAR vb. numaralı bölüm başlıkları kaynak sırasıyla ## olarak korunur.",
  politika:
    "Kurum politikası — kaynak başlık hiyerarşisi (kapsam, ilkeler, sorumluluklar vb.) ## ile aynen korunur; tek parça not.",
  talimat:
    "Operasyonel talimat — uygulama adımları ve kontrol noktaları; kaynak bölüm başlıkları ## ile sırayla korunur.",
  tebliğ:
    "Resmi tebliğ — madde/bölüm başlıkları kaynak sırasıyla ## ile korunur; yükümlülükler altında öğretilir.",
  yönetmelik:
    "Yönetmelik — tanım ve madde başlıkları kaynak sırasıyla ## ile korunur.",
  kanun:
    "Kanun metni — madde/bölüm başlıkları kaynak sırasıyla ## ile korunur; tanımlar birebir.",
  generic: "Genel belge — kaynak yapısına uygun not üretimi.",
}

/** Belge profiline göre not üretim prompt'una eklenecek tam rehber metni */
export function getDocumentNoteInstructions(profile: DocumentProcessingProfile): string {
  const parts = [profile.noteStyle]
  if (profile.preserveHeadings) {
    parts.push(HEADING_PRESERVATION_PROMPT)
  }
  return parts.join("\n\n")
}

function resolveMode(
  documentType: DocumentType,
  input: DocumentProcessingCourseInput,
): DocumentProcessingMode {
  const totalPages = input.totalPages ?? 0
  const pageLimit = shortDocSingleLimit(input)

  // Prosedür/politika/talimat: tüm PDF tek not birimi — bölüm başlığı AI tespiti atlanır
  if (documentType === "prosedür" || documentType === "politika" || documentType === "talimat") {
    return "single"
  }

  if (documentType === "tebliğ" || documentType === "yönetmelik" || documentType === "kanun") {
    if (totalPages > 0 && totalPages <= pageLimit && isMevzuatProgram(input)) {
      return "single"
    }
    return "multi"
  }

  if (isInternalMevzuatDoc(input)) {
    return "single"
  }

  if (totalPages > 0 && totalPages <= pageLimit && isMevzuatProgram(input)) {
    return "single"
  }

  if (totalPages > pageLimit) {
    return "multi"
  }

  return isMevzuatProgram(input) ? "single" : "multi"
}

function buildReason(
  documentType: DocumentType,
  mode: DocumentProcessingMode,
  input: DocumentProcessingCourseInput,
): string {
  const slug = input.slug ?? ""
  const totalPages = input.totalPages ?? 0
  const pageLimit = shortDocSingleLimit(input)

  if (mode === "single") {
    if (documentType === "kanun" && totalPages > 0 && totalPages <= pageLimit) {
      return `kısa dış mevzuat (${totalPages} sayfa ≤ ${pageLimit}, slug=${slug})`
    }
    if (documentType !== "generic") {
      return `${documentType} belgesi — tek parça (slug=${slug})`
    }
    if (totalPages > 0) {
      return `kısa belge (${totalPages} sayfa ≤ ${pageLimit}, slug=${slug})`
    }
    if (isInternalMevzuatDoc(input)) {
      return `iç mevzuat belgesi (slug=${slug})`
    }
    return `tek parça modu (slug=${slug})`
  }

  if (totalPages > pageLimit) {
    return `${documentType} — uzun belge (${totalPages} sayfa > ${pageLimit}, slug=${slug})`
  }
  return `${documentType} — çoklu bölüm (slug=${slug})`
}

function normalizeInput(
  slugOrInput: DocumentProcessingCourseInput | string,
  name?: string | null,
  sourceKind?: string | null,
): DocumentProcessingCourseInput {
  if (typeof slugOrInput === "string") {
    return { slug: slugOrInput, name, sourceKind }
  }
  return slugOrInput
}

/** Modül adı/slug'ından belge tipi ve işleme şeklini belirler */
export function getDocumentProcessingProfile(
  slugOrInput: DocumentProcessingCourseInput | string,
  name?: string | null,
  sourceKind?: string | null,
): DocumentProcessingProfile {
  const input = normalizeInput(slugOrInput, name, sourceKind)
  const documentType = detectDocumentType(input)
  const mode = resolveMode(documentType, input)
  const reason = buildReason(documentType, mode, input)

  const preserveHeadings = requiresHeadingPreservation(documentType)

  return {
    documentType,
    mode,
    noteStyle: NOTE_STYLES[documentType],
    preserveHeadings,
    reason,
  }
}

export function shouldUseSingleSectionModeFromProfile(
  input: DocumentProcessingCourseInput,
): boolean {
  return getDocumentProcessingProfile(input).mode === "single"
}

/** İşlem günlüğü: [PROCESS] Prosedür modu: tek parça işlenecek (slug=...) */
export function formatProcessingProfileLog(
  profile: DocumentProcessingProfile,
  slug?: string,
): string {
  const slugPart = slug ?? profile.reason.match(/slug=([^)]+)/)?.[1] ?? "?"
  if (profile.mode === "single") {
    if (profile.documentType === "prosedür") {
      return `Prosedür modu: tek parça işlenecek (slug=${slugPart})`
    }
    if (profile.documentType === "politika") {
      return `Politika modu: tek parça işlenecek (slug=${slugPart})`
    }
    if (profile.documentType === "talimat" || profile.reason.includes("iç mevzuat")) {
      return `İç mevzuat modu: tek parça işlenecek (slug=${slugPart})`
    }
    return `Tek parça modu: ${profile.reason}`
  }
  return `Belge tipi: ${profile.documentType} — çoklu bölüm modu (slug=${slugPart})`
}
