/** Admin paneli: ham işlem kodu → okunabilir Türkçe etiket */

export const API_OPERATION_LABELS: Record<string, string> = {
  section_titles_text: "PDF bölüm başlıkları tespiti",
  section_titles_multimodal: "PDF bölüm başlıkları (görsel okuma)",
  ocr_extraction: "PDF okuma (OCR)",
  ocr_extraction_chunk: "PDF okuma (OCR)",
  notes_generation: "Ders notu üretimi",
  generation: "Ders notu üretimi",
  question_generation: "Soru havuzu üretimi",
  flashcard: "Bilgi kartı üretimi",
  flashcard_generation: "Bilgi kartı üretimi",
  kontrolor: "Kalite kontrol (Kontrolör)",
  ground_truth: "Çapraz test (Ground Truth)",
  mufettis: "Derin denetim (Müfettiş)",
  cerrahi_yama: "Cerrahi yama (AST)",
  verification: "Doğrulama (eski)",
}

export function getApiOperationLabel(operation: string): string {
  const key = operation.trim().toLowerCase()
  if (API_OPERATION_LABELS[key]) return API_OPERATION_LABELS[key]
  if (API_OPERATION_LABELS[operation]) return API_OPERATION_LABELS[operation]
  return operation.replace(/_/g, " ")
}

export const API_STATUS_LABELS: Record<string, string> = {
  SUCCESS: "Başarılı",
  RATE_LIMIT_429: "Kota aşımı (429)",
  FORBIDDEN_403: "Yetkisiz erişim (403)",
  SERVER_ERROR_503: "Sunucu hatası (503)",
  TIMEOUT: "Zaman aşımı",
  WAITING: "Bekleniyor (yoğunluk)",
  REQUEST: "Devam ediyor",
  /** Eski kayıtlar / kullanıcı ifadesi — aslında devam eden istek */
  "İSTEK GÖNDERİLDİ": "Devam ediyor",
  ERROR: "Hata",
}

/** Eski kayıtlar için REQUEST → nötr “devam ediyor” */
export function getApiStatusLabel(status: string): string {
  return API_STATUS_LABELS[status] ?? status
}

export type ApiStatusTone = "success" | "warning" | "pending" | "error"

export function getApiStatusTone(status: string): ApiStatusTone {
  if (status === "SUCCESS") return "success"
  if (status === "RATE_LIMIT_429") return "warning"
  if (status === "WAITING" || status === "REQUEST" || status === "İSTEK GÖNDERİLDİ") return "pending"
  return "error"
}

export const API_STATUS_BADGE_CLASS: Record<ApiStatusTone, string> = {
  success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  pending: "bg-slate-500/10 text-slate-400 border border-slate-500/20",
  error: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
}
