import axios from "axios"
import { randomUUID } from "node:crypto"
import { prisma } from "./prisma"
import { isCancelled } from "@/lib/process-registry"
import { isGlossarySectionTitle } from "./glossary-utils"
import { type DocumentType, requiresHeadingPreservation } from "./document-processing-profile"
import { MAX_CHUNK_OCR_ATTEMPTS } from "./quota-guard"
import { dedupFlashcards, dedupQuestions } from "@/lib/content-dedup"
import { extractExamInventory, type ExamInventoryItem } from "./ocr-post-processor"

/** PDF görsel okuma (extractPerfectMarkdownOCR, ocr_extraction_chunk) — 3.5 Flash, ~20 RPD/key */
export const OCR_MODEL = "gemini-3.5-flash"

/** Tüm API anahtarlarının günlük kotası doldu — yeniden denemek aynı gün işe yaramaz. */
export class ApiQuotaExhaustedError extends Error {
  readonly kind: "daily" | "all_keys"

  constructor(message: string, kind: "daily" | "all_keys" = "daily") {
    super(message)
    this.name = "ApiQuotaExhaustedError"
    this.kind = kind
  }
}

/** OCR parçası 429 sonrası yeniden deneme limiti aşıldı — ders duraklatılmalı */
export class OcrChunkRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OcrChunkRateLimitError"
  }
}

/** Google 429 yanıtından geçici mi (dakika) günlük mü ayrımı */
function parseGoogleQuotaError(e: unknown): {
  isDaily: boolean
  isMinute: boolean
  retrySecs: number
  message: string
} {
  const err = e as { response?: { data?: { error?: { message?: string; details?: unknown[] } } }; message?: string }
  const message = err.response?.data?.error?.message || err.message || ""
  const m = message.toLowerCase()
  let isDaily = false
  let isMinute = false
  let retrySecs = 0

  const retryMatch = m.match(/retry in ([\d.]+)s/)
  if (retryMatch) retrySecs = Math.ceil(parseFloat(retryMatch[1]))

  for (const raw of err.response?.data?.error?.details || []) {
    const d = raw as { ["@type"]?: string; violations?: Array<{ quotaId?: string }>; retryDelay?: string }
    if (d["@type"]?.includes("QuotaFailure")) {
      for (const v of d.violations || []) {
        const qid = (v.quotaId || "").toLowerCase()
        if (qid.includes("perday") || qid.includes("per_day")) isDaily = true
        if (qid.includes("perminute") || qid.includes("per_minute") || qid.includes("rpm")) isMinute = true
      }
    }
    if (d["@type"]?.includes("RetryInfo") && d.retryDelay) {
      const rm = String(d.retryDelay).match(/([\d.]+)s/)
      if (rm) retrySecs = Math.max(retrySecs, Math.ceil(parseFloat(rm[1])))
    }
  }

  // Google bazen günlük kotada bile "retry in 18s" yazar — kısa bekleme = geçici limit
  if (retrySecs > 0 && retrySecs <= 120) {
    isMinute = true
    isDaily = false
  }

  if (!isDaily && !isMinute && (m.includes("429") || m.includes("quota"))) {
    isMinute = true
  }

  // Google bazen 429'da "retry in Xs" vermez — dakikalık limit için makul varsayılan
  if (isMinute && retrySecs === 0 && (m.includes("429") || m.includes("quota"))) {
    retrySecs = 20
  }

  return { isDaily, isMinute, retrySecs, message }
}

function isDailyQuotaErrorMessage(msg: string): boolean {
  return parseGoogleQuotaError({ response: { data: { error: { message: msg } } } }).isDaily
}

async function writeApiUsageLog(data: {
  apiKey: string
  keyIndex?: number | null
  model: string
  operation: string
  stage?: string | null
  courseSlug?: string | null
  sectionId?: string | null
  status: string
  errorDetail?: string | null
  durationMs?: number | null
}): Promise<void> {
  try {
    await prisma.apiUsageLog.create({ data })
    return
  } catch (err) {
    console.error("[AI_ENGINE] ApiUsageLog create failed, raw SQL fallback:", err)
  }
  try {
    const id = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO ApiUsageLog (id, apiKey, keyIndex, model, operation, stage, courseSlug, sectionId, status, errorDetail, durationMs, createdAt)
      VALUES (
        ${id},
        ${data.apiKey},
        ${data.keyIndex ?? null},
        ${data.model},
        ${data.operation},
        ${data.stage ?? null},
        ${data.courseSlug ?? null},
        ${data.sectionId ?? null},
        ${data.status},
        ${data.errorDetail ?? null},
        ${data.durationMs ?? null},
        ${new Date().toISOString()}
      )
    `
  } catch (err2) {
    console.error("[AI_ENGINE] ApiUsageLog raw SQL fallback failed:", err2)
  }
}

function parseKeyIndexFromLog(apiKey: string | null | undefined, keyIndex: number | null | undefined): number | null {
  if (keyIndex != null && keyIndex >= 0) return keyIndex
  const m = apiKey?.match(/Key\s*#(\d+)/i)
  return m ? parseInt(m[1], 10) - 1 : null
}

// ==================== AI ENGINE SETUP ====================

// ==================== REAL-TIME UI STATUS LOGGING ====================
let activeSectionIdForStatus: string | null = null

export function setActiveSectionIdForStatus(id: string | null) {
  activeSectionIdForStatus = id
}

export async function updateActiveSectionMicroPhase(phase: string) {
  if (!activeSectionIdForStatus) return
  try {
    const section = await prisma.section.findUnique({
      where: { id: activeSectionIdForStatus },
      select: { verificationIssues: true }
    })
    if (section) {
      let issuesObj: any = {}
      try {
        issuesObj = JSON.parse(section.verificationIssues || "{}")
      } catch (e) {}
      issuesObj.currentMicroPhase = phase
      await prisma.section.update({
        where: { id: activeSectionIdForStatus },
        data: { verificationIssues: JSON.stringify(issuesObj) }
      })
    }
  } catch (e) {
    // Ignore database write locks gracefully
  }
}

// PRIMARY: Gemini (High Quota & Quality) — Multi-key rotation
const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
const geminiKeys = (process.env.GEMINI_API_KEYS || geminiKey || "").split(",").filter(k => k.trim())
let currentKeyIndex = geminiKeys.length > 0 ? Math.floor(Math.random() * geminiKeys.length) : 0 // Aktif key index'i (Rastgele başlangıç)
const suspendedKeys = new Map<number, number>() // keyIndex → suspendedAt timestamp
const SUSPENDED_KEY_TTL_MS = 65 * 1000 // 65 saniye — Google'ın dakikalık sayacı ~60sn'de sıfırlanır

// ==================== PROAKTİF RPM + GÜNLÜK (RPD) SAYACI ====================
// Her (key + MODEL) için dakika ve gün bazında istek sayısını tutar — 429 yemeden ÖNCE limiti aşmayı engeller.
// ⚠️ ÖNEMLİ: 3.5 Flash ve 2.5 Flash AYRI kota havuzlarıdır → sayaç anahtarı (keyIndex|modelId|...) bazındadır.
//   Bu sayede tek bir key, 3.5 için ayrı 2.5 için ayrı RPM/RPD hakkına sahip olur (kapasite ~2 kat artar).
// NOT: Sayaçlar BELLEKTE tutulur (module-level Map). Sunucu yeniden başlarsa GÜNLÜK sayaç da SIFIRLANIR.
//   (İleride kalıcılık için `apiUsageLog` tablosundan beslenebilir; bu turda bellek-içi yeterli.)
const keyMinuteCounters = new Map<string, number>() // "keyIndex|modelId|minuteKey" → count
const keyDailyCounters = new Map<string, number>()  // "keyIndex|modelId|ptDayKey" → count

// Dakikalık limit (RPM): ücretsiz tier 5 RPM (Google AI Studio teyitli). .env: GEMINI_RPM_LIMIT
const RPM_LIMIT = Number(process.env.GEMINI_RPM_LIMIT ?? 5)
// Günlük limit (RPD): her iki model de 20 RPD/key (Google AI Studio teyitli, Haziran 2026)
const RPD_LIMIT = Number(process.env.GEMINI_RPD_LIMIT ?? 20)

function getModelRpdLimit(modelId: string): number {
  if (modelId === "gemini-3.5-flash") {
    return Number(process.env.GEMINI_RPD_LIMIT_35 ?? 20)
  }
  return RPD_LIMIT
}

function getMinuteKey(): string {
  const now = new Date()
  return `${now.getHours()}:${now.getMinutes()}`
}

// ⚠️ Google RPD'yi PASİFİK saatiyle (America/Los_Angeles) gece yarısı sıfırlar.
// Gün anahtarını YEREL saatle DEĞİL, PT tarihine göre üret — yoksa günlük pencere kayar.
function getPacificDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date()) // "YYYY-MM-DD" (PT günü)
}

function getKeyRpmCount(keyIndex: number, modelId: string): number {
  const k = `${keyIndex}|${modelId}|${getMinuteKey()}`
  return keyMinuteCounters.get(k) || 0
}

function getKeyDailyCount(keyIndex: number, modelId: string): number {
  const k = `${keyIndex}|${modelId}|${getPacificDayKey()}`
  return keyDailyCounters.get(k) || 0
}

let dailyCountersHydrated = false
let hydratedRecordCount = 0
const serverStartedAt = new Date().toISOString()

/** Sunucu yeniden başladığında bellek sayacını bugünkü ApiUsageLog ile senkronize et. */
async function ensureDailyCountersHydrated(): Promise<void> {
  if (dailyCountersHydrated) return
  dailyCountersHydrated = true
  try {
    const pacificDay = getPacificDayKey()
    const minuteKey = getMinuteKey()
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const logs = await prisma.apiUsageLog.findMany({
      where: { createdAt: { gte: since } },
      select: { keyIndex: true, apiKey: true, model: true, createdAt: true, status: true },
    })
    let loaded = 0
    for (const log of logs) {
      // Sadece gerçekten tüketilen istekler sayılır — 429 geçici reddir, günlük kotayı doldurmaz
      if (log.status !== "SUCCESS") continue
      const idx = parseKeyIndexFromLog(log.apiKey, log.keyIndex)
      if (idx == null) continue

      const logDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(log.createdAt)
      if (logDay === pacificDay) {
        const dk = `${idx}|${log.model}|${pacificDay}`
        keyDailyCounters.set(dk, (keyDailyCounters.get(dk) || 0) + 1)
        loaded++
      }

      const logMinuteKey = `${log.createdAt.getHours()}:${log.createdAt.getMinutes()}`
      if (logMinuteKey === minuteKey) {
        const mk = `${idx}|${log.model}|${minuteKey}`
        keyMinuteCounters.set(mk, (keyMinuteCounters.get(mk) || 0) + 1)
      }
    }
    hydratedRecordCount = loaded
    if (loaded > 0) {
      console.log(`[AI_ENGINE] 📊 Kota sayaçları DB'den yüklendi (${loaded} kayıt, PT günü: ${pacificDay})`)
    }
  } catch (e) {
    console.warn("[AI_ENGINE] Kota sayacı DB senkronu atlandı:", e)
  }
}

// Tüm key'ler bu model için GÜNLÜK kotasını doldurduysa true → dakika beklemek çözmez, üst katmana bırak.
function allKeysDailyExhausted(modelId: string): boolean {
  if (geminiKeys.length === 0) return false
  for (let i = 0; i < geminiKeys.length; i++) {
    if (getKeyDailyCount(i, modelId) < getModelRpdLimit(modelId)) return false
  }
  return true
}

// Hem dakikalık hem günlük sayacı TEK noktada artırır + eski anahtarları temizler (bellek sızıntısı önleme).
function recordKeyUsage(keyIndex: number, modelId: string): void {
  const minuteKey = getMinuteKey()
  const dayKey = getPacificDayKey()

  const mk = `${keyIndex}|${modelId}|${minuteKey}`
  keyMinuteCounters.set(mk, (keyMinuteCounters.get(mk) || 0) + 1)

  const dk = `${keyIndex}|${modelId}|${dayKey}`
  keyDailyCounters.set(dk, (keyDailyCounters.get(dk) || 0) + 1)

  // Eski dakika sayaçlarını temizle (sadece bu dakikaya ait olanları tut)
  const minuteKeysToDelete: string[] = []
  keyMinuteCounters.forEach((_, key) => {
    if (!key.endsWith(`|${minuteKey}`)) minuteKeysToDelete.push(key)
  })
  minuteKeysToDelete.forEach(key => keyMinuteCounters.delete(key))

  // Eski gün sayaçlarını temizle (sadece bugünün PT gününe ait olanları tut)
  const dayKeysToDelete: string[] = []
  keyDailyCounters.forEach((_, key) => {
    if (!key.endsWith(`|${dayKey}`)) dayKeysToDelete.push(key)
  })
  dayKeysToDelete.forEach(key => keyDailyCounters.delete(key))
}

/** pdf-engine / section-detector gibi doğrudan axios çağrıları — ApiUsageLog + canlı RPM/RPD sayacı */
export async function logDirectGeminiApiCall(args: {
  apiKey: string
  model: string
  operation: string
  stage?: string | null
  courseSlug?: string | null
  status: string
  errorDetail?: string | null
  durationMs?: number | null
}): Promise<void> {
  const trimmed = args.apiKey.trim()
  const keyIndex = geminiKeys.findIndex((k) => k.trim() === trimmed)
  const masked = keyIndex >= 0 ? `Key #${keyIndex + 1}` : "Key #?"
  if (args.status === "SUCCESS" && keyIndex >= 0) {
    recordKeyUsage(keyIndex, args.model)
  }
  await writeApiUsageLog({
    apiKey: masked,
    keyIndex: keyIndex >= 0 ? keyIndex : null,
    model: args.model,
    operation: args.operation,
    stage: args.stage ?? null,
    courseSlug: args.courseSlug ?? null,
    status: args.status,
    errorDetail: args.errorDetail ?? null,
    durationMs: args.durationMs ?? null,
  })
}

/** Admin paneli: motorun gerçek RPM/RPD sayaçlarını döndürür (bellek-içi, anlık). */
export async function getLiveApiKeyStats() {
  await ensureDailyCountersHydrated()
  const modelIds = ["gemini-3.5-flash", "gemini-2.5-flash"] as const
  const keys = geminiKeys.map((_, idx) => {
    const suspended = suspendedKeys.has(idx)
    const suspendedAt = suspendedKeys.get(idx)
    return {
      keyIndex: idx,
      keyLabel: `Key #${idx + 1}`,
      suspended,
      suspendedUntil: suspended && suspendedAt ? new Date(suspendedAt + SUSPENDED_KEY_TTL_MS).toISOString() : null,
      models: modelIds.map((modelId) => ({
        modelId,
        rpmUsed: getKeyRpmCount(idx, modelId),
        rpmLimit: RPM_LIMIT,
        rpmRemaining: Math.max(0, RPM_LIMIT - getKeyRpmCount(idx, modelId)),
        rpdUsed: getKeyDailyCount(idx, modelId),
        rpdLimit: getModelRpdLimit(modelId),
        rpdRemaining: Math.max(0, getModelRpdLimit(modelId) - getKeyDailyCount(idx, modelId)),
      })),
    }
  })
  return {
    rpmLimit: RPM_LIMIT,
    rpdLimit: RPD_LIMIT,
    rpdLimit35: getModelRpdLimit("gemini-3.5-flash"),
    pacificDay: getPacificDayKey(),
    keyCount: geminiKeys.length,
    serverTime: new Date().toISOString(),
    serverStartedAt,
    hydratedFromDb: hydratedRecordCount > 0,
    hydratedRecordCount,
    keys,
  }
}

// Her key'in kendi fileUri'si (PDF multimodal için — her key kendi projesindeki dosyaya erişir)
let activeFileUrisMap: Record<string, string> = {}
export function setFileUrisMap(map: Record<string, string>) { activeFileUrisMap = map }

export function getActiveFileUri(apiKey: string): string | undefined {
  const trimmed = apiKey.trim()
  const keyIndex = geminiKeys.findIndex((k) => k.trim() === trimmed)
  if (keyIndex >= 0) return activeFileUrisMap[String(keyIndex)]
  return undefined
}

function getSecondsUntilKeyAvailable(modelId: string): number {
  const now = Date.now()
  let maxSuspendedWaitSec = 0
  for (let i = 0; i < geminiKeys.length; i++) {
    if (suspendedKeys.has(i)) {
      const remainingMs = SUSPENDED_KEY_TTL_MS - (now - suspendedKeys.get(i)!)
      if (remainingMs > 0) {
        maxSuspendedWaitSec = Math.max(maxSuspendedWaitSec, Math.ceil(remainingMs / 1000))
      }
    }
  }
  const secsUntilNextMinute = 60 - new Date().getSeconds() + 2
  // 429 sonrası key ~65 sn askıda — sadece dakika sınırını beklemek yetmez
  return Math.max(maxSuspendedWaitSec, secsUntilNextMinute, 5)
}

function getNextGeminiKey(modelId: string): string | null {
  if (geminiKeys.length === 0) return null

  // Tüm key'ler arasından en uygununu seç: askıda olmayan VE (bu model için) günlük + dakikalık limiti dolmamış
  let bestIdx = -1
  let bestRpm = Infinity
  
  for (let i = 0; i < geminiKeys.length; i++) {
    const idx = (currentKeyIndex + i) % geminiKeys.length
    
    // Askıdaki key'leri kontrol et
    if (suspendedKeys.has(idx)) {
      if ((Date.now() - suspendedKeys.get(idx)!) > SUSPENDED_KEY_TTL_MS) {
        console.log(`[AI_ENGINE] 🔓 Key #${idx + 1} askı süresi doldu, yeniden aktif edildi.`)
        suspendedKeys.delete(idx)
      } else {
        continue // Hâlâ askıda
      }
    }

    // GÜNLÜK (RPD) limiti: bu (key, model) bugün dolduysa O GÜN için ATLA (dakika beklemek çözmez)
    if (getKeyDailyCount(idx, modelId) >= getModelRpdLimit(modelId)) {
      continue
    }
    
    // Bu key'in bu dakikadaki (bu model için) kullanım sayısını kontrol et
    const rpm = getKeyRpmCount(idx, modelId)
    if (rpm >= RPM_LIMIT) {
      continue // Bu key bu dakika dolmuş, atla
    }
    
    // En az kullanılan key'i tercih et (yükü eşit dağıt)
    if (rpm < bestRpm) {
      bestRpm = rpm
      bestIdx = idx
    }
  }
  
  if (bestIdx === -1) return null // Tüm key'ler ya askıda ya bu dakika ya da bugün (bu model için) dolu
  
  currentKeyIndex = bestIdx
  return geminiKeys[bestIdx].trim()
}

function purgeExpiredSuspensions(): void {
  const now = Date.now()
  suspendedKeys.forEach((at, idx) => {
    if (now - at > SUSPENDED_KEY_TTL_MS) suspendedKeys.delete(idx)
  })
}

/** getNextGeminiKey null dönerse (gerçek günlük dolu değilse) süresi dolmuş askıları temizle; gerekirse zorla dene. */
function getNextGeminiKeyWithFallback(modelId: string, consecutiveWaits: number): string | null {
  purgeExpiredSuspensions()
  const key = getNextGeminiKey(modelId)
  if (key) return key
  if (allKeysDailyExhausted(modelId)) return null

  if (consecutiveWaits >= 1) {
    let bestIdx = -1
    let bestRpm = Infinity
    for (let i = 0; i < geminiKeys.length; i++) {
      if (getKeyDailyCount(i, modelId) >= getModelRpdLimit(modelId)) continue
      const rpm = getKeyRpmCount(i, modelId)
      if (rpm < bestRpm) {
        bestRpm = rpm
        bestIdx = i
      }
    }
    if (bestIdx >= 0) {
      suspendedKeys.delete(bestIdx)
      currentKeyIndex = bestIdx
      console.log(`[AI_ENGINE] 🔓 Zorla Key #${bestIdx + 1} seçildi (${consecutiveWaits} bekleme sonrası, RPM: ${bestRpm})`)
      return geminiKeys[bestIdx].trim()
    }
  }
  return null
}

function rotateToNextKey(modelId: string): string | null {
  if (geminiKeys.length <= 1) return null

  // Mevcut key'i atla, sonraki en uygun key'i bul
  currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length
  
  // getNextGeminiKey zaten en uygununu seçecek
  const result = getNextGeminiKey(modelId)
  if (result) {
    console.log(`[AI_ENGINE] 🔑 Key rotasyonu: Key #${currentKeyIndex + 1}/${geminiKeys.length}'e geçildi (RPM: ${getKeyRpmCount(currentKeyIndex, modelId)}/${RPM_LIMIT}, RPD: ${getKeyDailyCount(currentKeyIndex, modelId)}/${RPD_LIMIT})`)
    updateActiveSectionMicroPhase(`🔑 Key rotasyonu: Key #${currentKeyIndex + 1}/${geminiKeys.length} deniyor...`).catch(() => {})
  }
  return result
}

export function getAvailableGeminiKey(modelId: string): string | null {
  return getNextGeminiKeyWithFallback(modelId, 1);
}

export function suspendGeminiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  const keyIndex = geminiKeys.findIndex((k) => k.trim() === trimmed)
  if (keyIndex >= 0) {
    suspendedKeys.set(keyIndex, Date.now())
  }
}

export async function withApiRetry<T>(
  operationName: string,
  modelId: string,
  maxRetries: number,
  fn: (apiKey: string) => Promise<T>
): Promise<T> {
  let attempt = 0
  let currentKey = getAvailableGeminiKey(modelId)
  
  if (!currentKey) {
    throw new Error(`[AI_ENGINE] Boşta API anahtarı bulunamadı (${operationName} için).`)
  }

  while (true) {
    try {
      const res = await fn(currentKey)
      // İstek başarılı olduğunda da bir sonraki istek için anahtarı rotasyona al
      rotateToNextKey(modelId)
      return res
    } catch (e: unknown) {
      attempt++
      const msg = e instanceof Error ? e.message : String(e)
      const is503 = msg.includes("503") || msg.includes("Service Unavailable") || msg.includes("500") || msg.includes("502") || msg.includes("fetch failed") || msg.includes("socket hang up") || msg.toLowerCase().includes("timeout") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("EAI_AGAIN")
      const is429 = msg.includes("429") || msg.includes("quota")
      const is403 = msg.includes("403") || msg.includes("Forbidden") || msg.includes("PERMISSION_DENIED")
      
      console.warn(`[AI_ENGINE] ⚠️ ${operationName} hatası (Deneme ${attempt}/${maxRetries}): ${msg.substring(0, 100)}`)
      
      if (attempt >= maxRetries) {
        console.error(`[AI_ENGINE] ❌ ${operationName} maksimum deneme limitine ulaştı.`)
        throw e
      }
      
      if (is503 || is429 || is403) {
        if (!is503 && currentKey) {
          suspendGeminiKey(currentKey)
        }
        const prevKeyIndex = currentKey ? geminiKeys.findIndex(k => k.trim() === currentKey!.trim()) : -1;
        const nextKey = rotateToNextKey(modelId)
        if (nextKey) currentKey = nextKey
        const newKeyIndex = currentKey ? geminiKeys.findIndex(k => k.trim() === currentKey!.trim()) : -1;

        // ApiUsageLog'a key rotasyon olayını kaydet (Soru 12 - Kalan Adım 3)
        writeApiUsageLog({
          apiKey: `Key #${prevKeyIndex + 1} -> Key #${newKeyIndex + 1}`,
          keyIndex: prevKeyIndex >= 0 ? prevKeyIndex : null,
          model: modelId,
          operation: "KEY_ROTATION",
          stage: operationName,
          status: is503 ? "SERVER_ERROR_503" : is429 ? "RATE_LIMIT_429" : "FORBIDDEN_403",
          errorDetail: `Hata nedeniyle rotasyon yapıldı: ${msg.substring(0, 200)}`,
        }).catch(err => console.error("[AI_ENGINE] Rotation log write failed:", err));

        const waitMs = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s...
        console.log(`[AI_ENGINE] 🔄 ${waitMs/1000}s bekleniyor ve key rotasyonu yapılıyor...`)
        await new Promise(r => setTimeout(r, waitMs))
      } else {
        throw e
      }
    }
  }
}

// ==================== EXAM INTELLIGENCE ====================

// Sınav bilgileri ve MUTLAK KURALLAR - tüm AI promptlarında kullanılacak
export function getExamIntelligence(aiMode: string, courseName: string = "") {
  let modeSpecificRules = ""

  const normalizedCourse = courseName.toLowerCase();
  const isSecurity = normalizedCourse.includes("güvenlik") || normalizedCourse.includes("bilgi sistem") || normalizedCourse.includes("security");
  const isMasak = normalizedCourse.includes("masak") || normalizedCourse.includes("uyum görev");

  if (isSecurity) {
    modeSpecificRules = `
SINAV TİPİ/DERS KAPSAMI: ${courseName ? courseName.toUpperCase() : "BİLGİ SİSTEMLERİ VE GÜVENLİK SINAVI"}
- Bilgi güvenliği, siber güvenlik, ağ güvenliği, şifreleme, yetkilendirme (DAC, MAC, RBAC) konularına odaklan.
- Kritik teknik standartlara (ISO/IEC 27001, COBIT, ITIL vb.) ve BT bağımsız denetim esaslarına çok dikkat et.
- Teknik kavramları (DMZ, WAF, MFA, SSO, IDS/IPS, Sızma Testleri, SOME vb.) gerçekçi BT senaryoları ile açıkla.
- Soru ve pratik örneklerde kesinlikle finansal türev ürünleri (opsiyon, vadeli işlem) veya MASAK kara para aklama mevzuatını karıştırma! Bu tamamen siber güvenlik ve bilgi sistemleri altyapı yönetimi dersidir.
`
  } else if (aiMode === "mevzuat") {
    const moduleLabel = getCourseModuleLabel(courseName)
    modeSpecificRules = `
MEVZUAT UZMANLIĞI — ${moduleLabel}
- Bu içerik sınav hazırlığı değil; iş hayatında mevzuat uygunluğu ve kişisel gelişim içindir.
- Kanun maddesi, süre, yetkili merci, idari para cezası, yaptırım ve istisnaları kaynak metne sadık yaz.
- Vaka tabanlı sorular: "Bu işlem mevzuata uygun mu?", "Hangi merci onaylar?", "Süre kaç gün?", "Hangi belge gerekir?"
- Kambiyo, ithalat/ihracat rejimi, gümrük, transfer fiyatı ve KVKK konularını birbirine karıştırma.
- Örnek, hikâye, benzetme ve vaka senaryoları YALNIZCA "${moduleLabel}" modülü ve kaynak metindeki kavramlarla sınırlı olmalı. Başka modülün kanun/kavramlarını veya SPL/SPK kalıp örneklerini (ihraççı, pay senedi, portföy vb.) KULLANMA.
- İhracat kredisi, alıcı kredisi ve DİR senaryolarını SADECE bu modülün konusu gerçekten bunları kapsıyorsa kullan.
- Örnek ve vaka senaryolarında belirli bir banka/kurum ticari adını zorunlu kılma; kaynak metinde geçmiyorsa kurum adı uydurma.
`
  } else if (isMasak || aiMode === "law") {
    modeSpecificRules = `
SINAV TİPİ/DERS KAPSAMI: ${courseName ? courseName.toUpperCase() : "HUKUK VE MEVZUAT SINAVI"}
- Kanun maddelerine, süre kısıtlamalarına (örn: 30 gün içinde), yetkili mercilere (örn: Kurul, Bakanlık) çok dikkat et.
- Vaka tabanlı (case study) sorularda kanun ihlali olup olmadığını sorgula.
- "Aşağıdakilerden hangisi idari para cezası gerektirir?" tarzı ezber + mantık soruları üret.
- ⚠️ KESİN KURAL: Banka şubesinde Uyum Görevlisi çalışmaz! Uyum Görevlisi Genel Müdürlük bünyesinde yer alır. Şube çalışanları şüpheli durumu doğrudan MASAK'a değil, kendi kurumlarındaki Uyum Görevlisine bildirir. MASAK'a resmi Şüpheli İşlem Bildirimi (ŞİB) gönderim yetkisi sadece Uyum Görevlisine aittir. Hikaye ve senaryolarda bu yasal raporlama hiyerarşisine %100 uyacaksın!
`
  } else if (aiMode === "language") {
    modeSpecificRules = `
SINAV TİPİ/DERS KAPSAMI: ${courseName ? courseName.toUpperCase() : "YABANCI DİL SINAVI"}
- Yabancı dil kelimelerinin Türkçe karşılıklarına, eş anlamlılarına ve örnek cümlelerine odaklan.
- Okuma parçalarında ana fikir (main idea), çıkarım (inference) ve yazarın tutumu (attitude) gibi soru tarzları üret.
- Gramer kurallarını bağlam içinde sor.
`
  } else if (aiMode === "finance") {
    modeSpecificRules = `
SINAV TİPİ/DERS KAPSAMI: ${courseName ? courseName.toUpperCase() : "FİNANS/LİSANS SINAVI"}
- Her modülde çoktan seçmeli, 5 şıklı sorular.
- Hesaplama soruları ("X formülüne göre sonuç nedir?") ve formüller çok önemli.
- Finansal kavramlar (Forward, Futures, Opsiyon vb.) arası ince farkları vurgula.
- Resmi terimleri ASLA değiştirme (pay, izahname, ihraççı, SPK vb.)
`
  } else {
    modeSpecificRules = `
SINAV TİPİ/DERS KAPSAMI: ${courseName ? courseName.toUpperCase() : "GENEL AKADEMİK VEYA KURUMSAL SINAV"}
- Metindeki temel kavramları, tarihleri ve süreçleri vurgula.
- Bilgiyi ölçen çoktan seçmeli 5 şıklı (A,B,C,D,E) sorular üret.
`
  }

  return `
${modeSpecificRules}

⚠️⚠️⚠️ MUTLAK KURAL - DOĞRULUK GARANTİSİ:
1. SADECE aşağıda verilen kaynak metinde bulunan bilgileri kullan.
2. Kaynak metinde OLMAYAN hiçbir bilgi, terim, rakam, tarih, oran veya kural ÜRETME.
3. ⚠️ KESİN KURAL: GEREKSİZ GİRİŞ/ÇIKIŞ CÜMLELERİ KESİNLİKLE YASAKTIR: "İşte notlarınız", "Başarılar dilerim", "Önemli noktalar şunlardır" gibi yapay zeka gevezelikleri KESİNLİKLE YAPMAYIN. Doğrudan bilgiye girin.
- META KELİMELER YASAKTIR: Cümlelerinizde "Kaynak metinde...", "Bu PDF'te...", "Orijinal dokümana göre...", "Sunulan metin...", "Ders notunda..." gibi dışarıdan okunduğunda yapay duran kalıpları KESİNLİKLE KULLANMAYIN. Sanki o kitabı doğrudan siz yazmışsınız gibi birinci ağızdan otoriter ve net olun.
- 🛠️ OCR VE HARF HATALARI KURALI (ÇOK KRİTİK): Optik okuma kaynaklı saçma boşlukları (örn: "W ireless F idelity", "B anka") GERÇEK BİR HATA SANIP ASLA UYARI DÜŞMEYİN, bunları sessizce "Wireless Fidelity" olarak düzeltin.
- ⚠️ GERÇEK YAZIM/BİLGİ HATASI (INLINE) KURALI: Sadece kurumun orijinal metnindeki "gerçek" harf hatalarını veya yasal çelişkileri (örn: "Asynchronous" yazması gerekirken "Asynchrous" yazması) KESİNLİKLE yakalayın ve vurgulayın. Ancak bu uyarıyı KESİNLİKLE belgenin en altına toplu bir liste olarak ("Ekstra Dikkat Edilmesi Gereken Hususlar" vb.) YAZMAYIN. İlgili kavramın/kısaltmanın açıklandığı cümlenin veya tablodaki satırın hemen yanına iliştirin (satır içi uyarı). Uyarıyı şu profesyonel şablonla verin: "(⚠️ Önemli Detay: ${courseName ? `${courseName.split(">")[0]?.trim()} kaynak notlarında` : "Sınavın kaynak notlarında"} bu terim [Hatalı Hal] olarak geçmektedir, ancak literatürdeki/mevzuattaki doğrusu [Doğru Hal] şeklindedir.)"
4. Bir formül veya rakam kaynak metinde yoksa, onu soru/not/karta KOYMA.
5. "Kesin çıkar", "muhakkak sorulur" gibi doğrulanamayan ifadeler KULLANMA.
6. Günlük hayattan verilecek örnekler ve hikayeler (senaryolar) mantıksal kurallara, finansal ve hukuki gerçekliğe %100 uygun olmalıdır. Örnekler hem akılda kalıcı hem de mantıken/hukuken kusursuz olmalıdır.
7. Örneklerde, hikayelerde veya sorularda geçen aktörlere KESİNLİKLE Türkçe şahıs isimleri (Ahmet Bey, Ayşe Hanım vb.) VERME. Bunun yerine HER ZAMAN gerçekçi kurumsal unvanlar ve tüzel kişilik isimleri kullan (örn. "Alfa Portföy AŞ Uyum Müdürü", "Beta Bankası İç Denetim Uzmanı", "Gama Faktoring AŞ Müşterisi"). KESİNLİKLE "Bay X, Bayan A, C şahsı, A müşterisi" gibi jenerik harfler veya yabancı kalıplar da KULLANMA. Aktörler adam gibi, gerçekçi bir kurum adı taşısın (örn: "Deniz Faktoring AŞ", "Anadolu Sigorta", "Merkez Bankası Uzmanı").
8. 📄 SAYFA NUMARALARI OFFSET AÇIKLAMASI: Sana iletilen sayfa aralıkları (örn: Sayfa 15-22), PDF dosyasının fiziksel sayfa indeksleridir. PDF içindeki basılı sayfa numaraları (sayfa altındaki sayılar) kapak/içindekiler gibi kısımlardan ötürü birkaç sayfa farklı (offsetli) olabilir. Analizini yaparken basılı numara yerine fiziksel sayfa sıralamasını/indeksini baz al.
9. 📐 MATEMATİKSEL FORMÜLLER VE HESAPLAMALAR: Eğer kaynak metinde herhangi bir matematiksel formül, denklem, oran veya sayısal hesaplama geçiyorsa, bunları ön yüzde kusursuz görünmesi için MUTLAK KESİNLİKLE standart LaTeX formatında yazacaksın (satır içi formüller için $...$, bağımsız büyük formüller için $$...$$ kullan). Örn: $$E = m \\cdot c^2$$ veya $a^2 + b^2 = c^2$.
10. 🛡️ EKSİKSİZ VE KAPSAMLI TANIM: Eğer kaynak metinde bir kurumun, kavramın veya sürecin istisnaları, alt dalları veya bankacılık dışı denetlediği şirketler (örn: Faktoring, Leasing, Finansman Şirketleri) açıkça yazıyorsa, bunları özetlerken veya kart üretirken ASLA atlama. Sadece adından yola çıkarak (örn: "BDDK = sadece bankalar") sığ bir tanım yapma. Kaynak metinde geçen TÜM görevlerini ve denetlediği TÜM şirket tiplerini kapsayan exhaustive (kapsamlı) bir tanım yaz.
11. 🇹🇷 DİL SAFİYETİ: İngilizce terimleri Türkçe karşılıklarıyla yaz. "Critical" yerine "kritik", "comprehensive" yerine "kapsamlı", "key" yerine "kilit/önemli" kullan. Puanlama veya değerlendirme etiketleri tamamen Türkçe olmalı (Önem Derecesi: Yüksek/Orta/Düşük). Teknik kısaltmalar (ISO, COBIT vb.) ise aynen kalabilir.
12. 📊 TABLO KURALI: Eğer ürettiğin içerik 'Kısaltmalar' veya kavram sözlüğü ise, bunu ASLA madde işaretli liste olarak yazma. KESİNLİKLE Markdown tablosu (Örn: | Kısaltma | Anlamı |) kullan.
13. 🗂️ KATEGORİLİ TABLO KURALI: Eğer 'Kısaltmalar' üretiyorsan, bunları mutlaka mantıklı alt başlıklara (Örn: "🏢 Düzenleyici Kurumlar", "🌐 Ağ Protokolleri" vb.) böl. Ancak her alt başlığın altında KESİNLİKLE ayrı bir Markdown tablosu oluştur. Kaynak metindeki TÜM kısaltmaları EKSİKSİZ olarak bu tablolara aktar. Hiçbir kısaltmayı atlamak, özetlemek veya "vb." diyerek kesmek KESİNLİKLE YASAKTIR.
${courseName ? `14. 🎯 ALAN UYUMU (ÖRNEK/HİKÂYE): Örnek, benzetme, vaka senaryosu ve mini quiz "${getCourseModuleLabel(courseName)}" dersinin kapsamıyla birebir uyumlu olmalı. Başka ders/modül alanından hazır kalıp örnek kullanma; kaynak metinde olmayan olay/rakam/kural uydurma.` : ""}
`
}

/** "Program > Ders" formatından ders/modül adını çıkarır */
export function getCourseModuleLabel(courseName: string): string {
  const trimmed = courseName.trim()
  if (!trimmed) return "ilgili ders"
  const parts = trimmed.split(">")
  return parts[parts.length - 1]?.trim() || trimmed
}

export function getDisciplineExamples(
  isSecurity: boolean,
  isMasak: boolean,
  aiMode: string = "general",
  courseName: string = "",
) {
  if (isSecurity) {
    return {
      disciplineName: "bilgi güvenliği ve denetim",
      analogies: `
  * CISA (Bilgi Sistemleri Denetçisi) için: "BT sistemlerinin röntgenini çeken uluslararası yeminli mali müşavir yetki belgesi" (finansal defterler yerine bilgisayar altyapılarını bağımsız denetler).
  * WAF (Web Application Firewall) için: "Apartman kapısında duran ve sadece daire sakinlerinin tanıdığı davetlilere izin verip, şüpheli hareketleri olan yabancıları engelleyen bina güvenlik görevlisi."
  * DMZ (Demilitarized Zone) için: "Apartman lobisi; apartmanın dış kapısından giren herkesin (ziyaretçilerin) ulaşabildiği ama dairelerin içine doğrudan girmelerini engelleyen ortak ara bekleme alanı."
  * MFA (Çok Faktörlü Kimlik Doğrulama) için: "Hem apartman dış kapısı anahtarı hem de cep telefonuna gelen SMS şifresi ile açılan çift kilitli çelik kasa sistemi."
      `,
      stories: `
  Örn: "X Kurumunun Sistem Yöneticisi, şirketin veri merkezine girmek istedi → Yetkilendirme kontrolü → Parmak izi okutma + şifre → MFA doğrulaması yapıldı."
  Örn: "Zararlı bir yazılım, WAF arkasındaki sunucuya SQL enjeksiyon saldırısı denedi → WAF şüpheli karakteri engelledi → Log kaydı alındı."
  Örn: "Bir aracı kurumun BT Uzmanı, kritik şifreleri şifrelemeden sakladı → Sızma testinde zafiyet tespit edildi → ISO 27001 uygunsuzluk raporu yazıldı."
      `,
      akrostiş: `Örn: "BGA → Bütünlük, Gizlilik, Erişilebilirlik (Bilgi güvenliğinin 3 temel sacayağı CIA)"`,
      quiz: `
  🧪 Kendini Test Et: Yetkilendirme modellerinden hangisinde nesnelere erişim hakları sadece merkezi bir idari otorite tarafından belirlenir ve kullanıcılar bunu devredemez?
  <details>
  <summary>💡 Cevabı Göster</summary>
  Cevap: MAC (Mandatory Access Control - Zorunlu Erişim Kontrolü)
  </details>
      `,
      labelExample: `(Örn: "## Ağ Güvenliği Altyapısı [Güvenlik Mimarisi]" veya "## ISO/IEC 27001 Standartları [Bilgi Güvenliği Yönetimi]")`
    };
  } else if (isMasak) {
    return {
      disciplineName: "MASAK uyum ve AML",
      analogies: `
  * Uyum Görevlisi için: "Kurumun yasalara uygun hareket ettiğini denetleyen baş hukuk ve uyum kontrolörü."
  * ŞİB (Şüpheli İşlem Bildirimi) için: "Mali suçları engellemek için doğrudan devlet otoritesine gönderilen acil şüpheli durum ihbar mektubu."
  * KYC (Müşterinin Tanınması) için: "Bankada hesap açarken müşterinin kimliğini, gelir kaynağını ve mesleğini titizlikle doğrulayan güvenlik protokolü."
      `,
      stories: `
  Örn: "Bir banka müşterisi şubeye 50.000 TL nakit yatırdı → Gişe görevlisinin şüphesi → ŞİB kontrolü → Uyum Görevlisine raporlama."
  Örn: "Bir müşteri kuyumcudan 80.000 TL'lik altın aldı → Kuyumcu kimlik sorar mı? → EVET çünkü 75.000 TL sınırını aştı → Kimlik tespiti ve teyidi yapıldı."
  Örn: "Alfa İthalat AŞ offshore şirket kurdu, parayı 3 ülkeden dolaştırdı → Ayrıştırma aşaması → MASAK tespit etti → Sonuç: Ağır ceza yaptırımı."
      `,
      akrostiş: `Örn: "YAB → Yerleştirme, Ayrıştırma, Bütünleştirme (Kara para aklamanın 3 aşaması)"`,
      quiz: `
  🧪 Kendini Test Et: Kimlik tespiti yapılmadan işlem yapılabilecek istisna durum hangisidir?
  <details>
  <summary>💡 Cevabı Göster</summary>
  Cevap: Hayat sigortası poliçelerinde yıllık prim tutarı belirlenen limiti aşamadığında
  </details>
      `,
      labelExample: `(Örn: "## Şüpheli İşlem Bildirimi [Uyum Yönetimi]" veya "## 5549 Sayılı Kanun [Hukuki Çerçeve]")`
    };
  } else if (aiMode === "mevzuat" || aiMode === "law") {
    const moduleLabel = getCourseModuleLabel(courseName)
    return {
      disciplineName: moduleLabel,
      analogies: `
  * Benzetmeleri YALNIZCA "${moduleLabel}" modülündeki ve kaynak metindeki kavramlara üret.
  * Konu dışı SPL/SPK kalıp örnekleri (ihraççı, pay senedi, portföy, vadeli işlem) KESİNLİKLE YASAK.
  * Örnek: KVKK modülünde veri sorumlusu/açık rıza; kambiyo modülünde ihracat bedeli/döviz; gümrük modülünde beyan/rejim — ders adına uygun terimler kullan.
  * Somut Benzetme Şablonu (KVKK için): "Veri Sorumlusu için: Dershanedeki öğrenci kayıtlarını tutan ve bu verilerin nasıl işleneceğine karar veren dershane sahibi (Veri Sorumlusu), bu verileri sisteme giren memur ise Veri İşleyendir."
      `,
      stories: `
  Örnek format (içerik "${moduleLabel}" kapsamından ve kaynak metinden türetilmeli):
  Örn: "[Kaynak metindeki kural] → [Gerçekçi kurumsal aktör] → [Merci / süre / belge] → [Sonuç]"
  Örn: Senaryodaki rakam, süre ve merci bilgileri kaynak metinde geçmeli; uydurma yasak.
      `,
      akrostiş: `Sadece kaynak metindeki sıralı maddeler anlamlı kısaltma oluşturuyorsa kullan; zorlama.`,
      quiz: `
  🧪 Kendini Test Et: "${moduleLabel}" kapsamındaki bir kural/süre/merci sorusu (kaynak metne dayalı).
  <details>
  <summary>💡 Cevabı Göster</summary>
  Cevap: (Kaynak metindeki doğru bilgi)
  </details>
      `,
      labelExample: `(Örn: "## [Konu Başlığı] [${moduleLabel}]")`
    };
  } else if (aiMode === "finance") {
    return {
      disciplineName: "finans ve kurumsal yönetim",
      analogies: `
  * Pay Senedi için: "Bir şirketin mülkiyet ortaklığını simgeleyen tapu senedi benzeri değerli evrak."
  * Portföy Çeşitlendirmesi için: "Tüm yumurtaları aynı sepete koymamak; riski dağıtmak için farklı enstrümanlara yatırım yapmak."
  * Somut Benzetme Şablonu (Muhasebe için): "Maddi Duran Varlıklar için: Şirketin faaliyetlerinde kullanılmak üzere alınan ve hemen satılmayan bina, makine veya taşıtlar (Maddi Duran Varlıklar), satılmak için alınan mallar ise Stoklardır."
      `,
      stories: `
  Örn: "Gama Portföy AŞ fon yöneticisi parayı hisse senetleri arasında paylaştırdı → Risk dağılımı → Bir hisse düşerken diğeri yükseldi → Portföy değeri korundu."
  Örn: "Beta İhracat AŞ borsada vadeli işlem kontratı satın aldı → Hedge (korunma) amaçlı → Kur dalgalanmalarından etkilenmedi."
      `,
      akrostiş: `Örn: "FDR → Fiyat, Değer, Risk (Yatırım kararlarının 3 ana unsuru)"`,
      quiz: `
  🧪 Kendini Test Et: Bir yatırımcının mevcut fiyat riskinden korunmak amacıyla ters yönde pozisyon almasına ne ad verilir?
  <details>
  <summary>💡 Cevabı Göster</summary>
  Cevap: Hedge (Riskten Korunma)
  </details>
      `,
      labelExample: `(Örn: "## Portföy Yönetimi [Yatırım Stratejileri]" veya "## Sermaye Piyasası Kanunu [Yasal Mevzuat]")`
    };
  } else {
    const moduleLabel = getCourseModuleLabel(courseName)
    return {
      disciplineName: moduleLabel || "akademik ders",
      analogies: `
  * Benzetmeleri YALNIZCA "${moduleLabel}" dersindeki kavramlara üret; kaynak metindeki terimleri kullan.
  * Başka program/ders alanından hazır kalıp örnek (finans, MASAK, BT vb.) KULLANMA.
      `,
      stories: `
  Örn: "[Ders kapsamındaki kural/süreç] → [Gerçekçi kurumsal aktör] → [Kaynak metindeki sonuç]"
      `,
      akrostiş: `Sadece kaynak metindeki sıralı maddeler anlamlı kısaltma oluşturuyorsa kullan.`,
      quiz: `
  🧪 Kendini Test Et: "${moduleLabel}" kapsamında kaynak metne dayalı kısa bir soru.
  <details>
  <summary>💡 Cevabı Göster</summary>
  Cevap: (Kaynak metindeki doğru bilgi)
  </details>
      `,
      labelExample: `(Örn: "## [Konu Başlığı] [${moduleLabel}]")`
    };
  }
}

// ==================== HELPERS ====================

export function extractCleanJson(raw: string): any {
  // Temizlik: BOM, kontrol karakterleri, thinking bloğu
  let cleaned = raw
    .replace(/^\uFEFF/, '')           // BOM kaldır
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Kontrol karakterleri
    .replace(/<think>[\s\S]*?<\/think>/g, '')       // Thinking bloğu
    .trim()

  // Markdown code block varsa içini al
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim()
  }

  // Trailing comma düzelt: ,] → ] ve ,} → }
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')

  // Direkt parse dene
  try { return JSON.parse(cleaned) } catch { }

  // JSON array bul
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    const arr = arrayMatch[0].replace(/,\s*([}\]])/g, '$1')
    try { return JSON.parse(arr) } catch { }
  }

  // JSON object bul
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    const obj = jsonMatch[0].replace(/,\s*([}\]])/g, '$1')
    try { return JSON.parse(obj) } catch { }
  }

  // Son çare: JSON key'lerini düzelt (TEK TIRNAK SORUNU — Türkçe kesme işaretlerini koruyarak)
  try {
    // Sadece JSON yapısal tek tırnakları değiştir (key-value pattern), metin içindeki kesme işaretlerini koru
    const fixed = cleaned
      .replace(/(?<=[:,\[{]\s*)'([^']*?)'(?=\s*[,}\]:])/g, '"$1"') // value pozisyonundaki tek tırnakları değiştir
      .replace(/'(\w+)'\s*:/g, '"$1":') // key pozisyonundaki tek tırnakları değiştir
    return JSON.parse(fixed)
  } catch { }

  // Yarım kesilmiş JSON array kurtarma (maxOutputTokens sınırına çarpınca oluyor)
  if (cleaned.startsWith('[')) {
    // Son tamamlanmış objeyi bul: }  ardından , veya ] 
    const lastCompleteObj = cleaned.lastIndexOf('}')
    if (lastCompleteObj > 0) {
      const truncated = cleaned.substring(0, lastCompleteObj + 1) + ']'
      try {
        const result = JSON.parse(truncated)
        if (Array.isArray(result) && result.length > 0) {
          console.warn(`[JSON_RECOVERY] Yarım kesilmiş JSON kurtarıldı: ${result.length} öğe`)
          return result
        }
      } catch { }
    }
  }

  throw new Error("AI cevabı geçerli bir JSON formatında değil.")
}

// ==================== PRISTINE MARKDOWN OCR (GÖZCÜ KATMANI) ====================

/** OCR parçaları arasındaki örtüşen metni birleştirir (sayfa sınırında kesilen tablolar için). */
export function stitchOcrMarkdownChunks(previous: string, next: string): string {
  const prev = previous.trim()
  const nxt = next.trim()
  if (!prev) return nxt
  if (!nxt) return prev

  const minOverlap = 20
  const maxSearch = Math.min(4000, prev.length, nxt.length)
  for (let len = maxSearch; len >= minOverlap; len--) {
    const suffix = prev.slice(-len)
    if (nxt.startsWith(suffix)) {
      return prev + nxt.slice(len)
    }
  }

  const prevLines = prev.split("\n")
  const nextLines = nxt.split("\n")

  const lastPrevLine = prevLines[prevLines.length - 1]?.trim()
  const firstNextLine = nextLines[0]?.trim()
  if (lastPrevLine && firstNextLine && lastPrevLine.length > 10 && lastPrevLine === firstNextLine) {
    return [...prevLines.slice(0, -1), ...nextLines].join("\n")
  }

  const maxLineCheck = Math.min(30, prevLines.length, nextLines.length)
  for (let n = maxLineCheck; n >= 1; n--) {
    const tail = prevLines.slice(-n).join("\n").trim()
    const head = nextLines.slice(0, n).join("\n").trim()
    if (tail.length > 10 && tail === head) {
      return [...prevLines.slice(0, -n), ...nextLines].join("\n")
    }
  }

  // ==================== ESNEK (FUZZY) DİKİŞ KATMANI ====================
  // Katı eşleşmeler başarısız olursa, boşluk ve noktalama sapmalarını yok sayan
  // esnek bir temiz dize karşılaştırması yaparız. Yanlış eşleşmeleri önlemek için
  // minimum esnek eşleşme uzunluğunu 100 karakter olarak sınırlarız.
  const cleanForStitch = (str: string) => str.toLowerCase().replace(/[^a-z0-9ıışşğğüüööçç]/gi, "")
  const minFuzzyOverlap = 100
  const maxFuzzySearch = Math.min(2000, prev.length, nxt.length)
  for (let len = maxFuzzySearch; len >= minFuzzyOverlap; len--) {
    const suffix = prev.slice(-len)
    const prefix = nxt.slice(0, len)
    if (cleanForStitch(suffix) === cleanForStitch(prefix)) {
      console.log(`[STITCH] 🩹 Esnek Dikiş (Fuzzy) başarılı: ${len} karakterlik örtüşme dikildi.`)
      return prev + nxt.slice(len)
    }
  }

  return prev + "\n\n" + nxt
}

export async function cleanupStaleOcrFiles(apiKey: string): Promise<void> {
  try {
    const { GoogleAIFileManager } = await import("@google/generative-ai/server");
    const fileManager = new GoogleAIFileManager(apiKey.trim());
    const listResponse = await fileManager.listFiles({ pageSize: 100 });
    const files = listResponse.files || [];
    for (const file of files) {
      if (file.displayName && file.displayName.startsWith("ocr_temp_chunk_")) {
        console.log(`[OCR_CLEANUP] 🧹 Buluttaki eski geçici dosya siliniyor: ${file.name} (${file.displayName})`);
        try {
          await fileManager.deleteFile(file.name);
        } catch (delErr: any) {
          console.error(`[OCR_CLEANUP] ❌ Buluttaki dosya silinemedi: ${file.name}, Hata: ${delErr.message}`);
        }
      }
    }
  } catch (err: any) {
    console.error(`[OCR_CLEANUP] ⚠️ Eski dosya temizliği sırasında hata oluştu (gözardı ediliyor): ${err.message}`);
  }
}

export async function extractPerfectMarkdownOCR(
  pdfPath: string,
  pageStart: number,
  pageEnd: number,
  courseName: string = "PDF Okuma (OCR)",
  options?: { onProgress?: (message: string) => void | Promise<void>; logCourseSlug?: string },
): Promise<string> {
  await ensureDailyCountersHydrated()
  const onProgress = options?.onProgress
  const logCourseSlug = options?.logCourseSlug ?? courseName.substring(0, 150)
  const report = async (msg: string) => {
    if (onProgress) await onProgress(msg)
  }
  const { PDFDocument } = await import('pdf-lib');
  const fsPromises = await import('fs/promises');

  const prompt = `Ekteki PDF dosyasını detaylıca okuyup kusursuz bir Markdown metnine çevir.
Kurallar:
1. Hiçbir cümleyi, tabloyu veya listeyi atlama. Her detayı koru.
2. Tabloları düzgün Markdown tablolarına dönüştür.
3. Görseller veya şemalar varsa, bunları "[GÖRSEL İÇERİKLER]" başlığı altında olabildiğince detaylı metne dök.
4. "İşte metin", "Tamamdır" gibi cevaplar yazma, sadece çevrilmiş markdown metnini ver.

[SINAV ENVANTERİ]
Bu sayfalardan sınavda sorulabilecek HER unsuru numaralı liste hâlinde çıkar.
Her satır TEK bir sınanabilir birim olmalı. Kategori etiketi ve kısa arama ANAHTARI içermeli:
- TANIM| terim = kaynaktaki resmi tanım cümlesi | ANAHTAR: arama_terimi
- SAYI| neyin değeri = değer (örn: bildirim süresi = 10 gün) | ANAHTAR: 10 gün
- ISTISNA| hangi kural + kimin için geçerli değil | ANAHTAR: istisna_konusu
- AYRIM| kavram A ≠ kavram B (karıştırılma riski olanlar) | ANAHTAR: kavram_A
- ADIM| prosedürün sıralı adımı | ANAHTAR: adım_tanımı
- LISTE| madde madde sayılan grup (kurumlar, belge türleri vb.) | ANAHTAR: grup_adı
- CEZA| yaptırım türü = miktarı/süresi | ANAHTAR: ceza_miktarı

⛔ Yorum yapma, açıklama yazma, örnek uydurma.
⛔ Sayfada geçmeyen hiçbir şeyi envantere ekleme.
⛔ Sayfada geçen HİÇBİR sınanabilir unsuru atlama.
[/SINAV ENVANTERİ]`;

  const pdfBytes = await fsPromises.readFile(pdfPath);
  const originalPdf = await PDFDocument.load(pdfBytes);
  const totalOriginalPages = originalPdf.getPageCount();

  const startIdx = Math.max(0, pageStart - 1);
  const endIdx = Math.min(totalOriginalPages - 1, pageEnd - 1);
  const totalPagesToExtract = endIdx - startIdx + 1;

  if (totalPagesToExtract <= 0) {
    throw new Error("Geçersiz sayfa aralığı.");
  }

  // Kısa belgeler (≤20 sayfa): örtüşme yok, daha büyük parça — 16 sayfa = 2 OCR çağrısı
  const CHUNK_SIZE = totalPagesToExtract <= 20 ? 8 : 5;
  const PAGE_OVERLAP = totalPagesToExtract <= 20 ? 0 : 2;
  const MIN_OCR_ATTEMPT_GAP_MS = 3000;
  const stride = CHUNK_SIZE - PAGE_OVERLAP;
  let finalMarkdown = "";

  for (let i = 0; i < totalPagesToExtract; i += stride) {
    const chunkStartIdx = startIdx + i;
    const chunkEndIdx = Math.min(endIdx, chunkStartIdx + CHUNK_SIZE - 1);
    const chunkPageCount = chunkEndIdx - chunkStartIdx + 1;

    console.log(`[MARKDOWN_OCR] Chunk işleniyor: Sayfa ${chunkStartIdx + 1} - ${chunkEndIdx + 1} (${chunkPageCount} sayfa, örtüşme: ${PAGE_OVERLAP} sayfa)`);
    await report(`PDF Metne Çevriliyor — sayfa ${chunkStartIdx + 1}-${chunkEndIdx + 1}`);
    updateActiveSectionMicroPhase(`🚀 Markdown OCR: Sayfa ${chunkStartIdx + 1}-${chunkEndIdx + 1} metne çevriliyor...`).catch(() => {})

    const newPdf = await PDFDocument.create();
    const pageIndicesToCopy = Array.from({length: chunkPageCount}, (_, k) => chunkStartIdx + k);
    const copiedPages = await newPdf.copyPages(originalPdf, pageIndicesToCopy);
    for (const page of copiedPages) {
      newPdf.addPage(page);
    }
    const chunkPdfBytes = await newPdf.save();
    const chunkBase64 = Buffer.from(chunkPdfBytes).toString('base64');

    let chunkSuccess = false;
    let chunkResult = "";
    let lastOcrError = "";
    let lastOcrAttemptAt = 0;
    let rotatedKeysCount = 0;
    const maxRotations = geminiKeys.length; // Tüm key'leri dene, asla 3.5-flash'tan vazgeçme

    for (let chunkAttempt = 1; chunkAttempt <= MAX_CHUNK_OCR_ATTEMPTS && !chunkSuccess; chunkAttempt++) {
      if (chunkAttempt > 1) {
        const backoffMs = Math.min(20_000 * Math.pow(2, chunkAttempt - 2), 120_000);
        await report(
          `Yoğunluk sınırı — ${Math.round(backoffMs / 1000)} sn bekleniyor (deneme ${chunkAttempt}/${MAX_CHUNK_OCR_ATTEMPTS})`,
        );
        updateActiveSectionMicroPhase(`⏱️ OCR Yoğunluk Sınırı: ${Math.round(backoffMs / 1000)}sn bekleniyor...`).catch(() => {})
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      rotatedKeysCount = 0; // Her deneme turunda rotasyonu sıfırla — tüm key'ler tekrar denensin
      const activeModel = OCR_MODEL;

      const currentKey = getNextGeminiKeyWithFallback(activeModel, 0);
      if (!currentKey) {
        if (allKeysDailyExhausted(activeModel)) {
          console.error(`[AI_ENGINE] ⛔ Tüm projelerin GÜNLÜK (RPD) kotası doldu — yarın PT gece yarısı sıfırlanır`);
          throw new ApiQuotaExhaustedError(
            "Google günlük API limiti doldu. Pasifik saatiyle gece yarısı sıfırlanır; yarın Devam Ettir ile yeniden başlatın.",
            "daily",
          );
        }
        const waitSec = getSecondsUntilKeyAvailable(activeModel);
        await writeApiUsageLog({
          apiKey: "Key #—",
          model: activeModel,
          operation: "ocr_extraction_chunk",
          stage: "ocr",
          courseSlug: logCourseSlug,
          status: "WAITING",
          errorDetail: `${waitSec} sn bekleniyor (anahtar dinleniyor)`,
          durationMs: 0,
        });
        await report(`Anahtarlar dinleniyor — ${waitSec} sn`);
        updateActiveSectionMicroPhase(`⏱️ Anahtarlar dinleniyor: ${waitSec}sn bekleniyor...`).catch(() => {})
        chunkAttempt--;
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }

      let uploadedFile: any = null;
      let fileManagerInstance: any = null;
      let tempChunkPath = "";

      try {
        const path = await import('path');
        const tmpDir = path.join(process.cwd(), "tmp_chunks");
        await fsPromises.mkdir(tmpDir, { recursive: true });
        tempChunkPath = path.join(tmpDir, `ocr_temp_chunk_${Date.now()}_${chunkStartIdx}_${chunkEndIdx}.pdf`);
        await fsPromises.writeFile(tempChunkPath, chunkPdfBytes);

        const { GoogleAIFileManager } = await import("@google/generative-ai/server");
        const fileManager = new GoogleAIFileManager(currentKey.trim());
        fileManagerInstance = fileManager;

        // Run garbage collector on this key BEFORE upload to keep it clean
        await cleanupStaleOcrFiles(currentKey);

        console.log(`[MARKDOWN_OCR] 📤 Sayfa ${chunkStartIdx + 1}-${chunkEndIdx + 1} buluta yükleniyor...`);
        updateActiveSectionMicroPhase(`📤 Sayfa ${chunkStartIdx + 1}-${chunkEndIdx + 1} buluta yükleniyor (Key #${currentKeyIndex + 1})...`).catch(() => {})
        const uploadResult = await fileManager.uploadFile(tempChunkPath, {
          mimeType: "application/pdf",
          displayName: `ocr_temp_chunk_${Date.now()}_${chunkStartIdx}_${chunkEndIdx}`,
        });
        uploadedFile = uploadResult.file;
        console.log(`[MARKDOWN_OCR] 📤 Bulut yüklemesi başarılı: ${uploadedFile.uri}`);
        updateActiveSectionMicroPhase(`📤 Bulut yüklemesi başarılı: OCR yapılıyor (Key #${currentKeyIndex + 1})...`).catch(() => {})
      } catch (uploadErr: any) {
        console.warn(`[MARKDOWN_OCR] ⚠️ Bulut yüklemesi başarısız oldu, Base64 (inlineData) fallback devreye giriyor: ${uploadErr.message}`);
      }

      const headers = { "Content-Type": "application/json", "x-goog-api-key": currentKey };
      const body = {
        contents: [
          {
            parts: [
              uploadedFile
                ? {
                    fileData: {
                      mimeType: "application/pdf",
                      fileUri: uploadedFile.uri
                    }
                  }
                : {
                    inlineData: {
                      mimeType: "application/pdf",
                      data: chunkBase64
                    }
                  },
              { text: prompt }
            ]
          }
        ],
        generationConfig: { temperature: 0.0, maxOutputTokens: 32768 }
      };

      const startTime = Date.now()
      const logKeyIndex = currentKeyIndex
      try {
        const sinceLastAttempt = Date.now() - lastOcrAttemptAt
        if (lastOcrAttemptAt > 0 && sinceLastAttempt < MIN_OCR_ATTEMPT_GAP_MS) {
          await new Promise((r) => setTimeout(r, MIN_OCR_ATTEMPT_GAP_MS - sinceLastAttempt))
        }
        lastOcrAttemptAt = Date.now()

        const axiosMod = (await import('axios')).default;
        const response = await axiosMod.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`,
          body,
          { headers, timeout: 180000 }
        );
        const finishReason = response.data?.candidates?.[0]?.finishReason;
        const parts = response.data?.candidates?.[0]?.content?.parts || [];
        const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text);
        const result = textParts.join("").trim();

        if (result && result.length > 100) {
          if (finishReason === "MAX_TOKENS" && chunkPageCount > 1) {
            console.error(`[MARKDOWN_OCR] 🔴 KESİLME: Sayfa ${chunkStartIdx + 1}-${chunkEndIdx + 1} token sınırını aştı. Aralık ikiye bölünüp yeniden OCR ediliyor...`);
            const mid0 = chunkStartIdx + Math.floor((chunkPageCount - 1) / 2);
            await new Promise(r => setTimeout(r, 3000));
            const firstHalf = (await extractPerfectMarkdownOCR(pdfPath, chunkStartIdx + 1, mid0 + 1, courseName, options)).replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*\[VISUAL_OCR_COMPLETE\]\s*/, "").replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, "");
            await new Promise(r => setTimeout(r, 3000));
            const secondHalf = (await extractPerfectMarkdownOCR(pdfPath, mid0 + 2, chunkEndIdx + 1, courseName, options)).replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*\[VISUAL_OCR_COMPLETE\]\s*/, "").replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, "");
            chunkResult = `${firstHalf}\n\n${secondHalf}`;
            chunkSuccess = true;
            break;
          }
          if (finishReason === "MAX_TOKENS") {
            console.error(`[MARKDOWN_OCR] ⛔ KESİLME: Sayfa ${chunkStartIdx + 1} tek sayfa — token sınırı aşıldı, sonu eksik olabilir.`);
          }

          chunkResult = result;
          chunkSuccess = true;

          recordKeyUsage(currentKeyIndex, activeModel)

          await writeApiUsageLog({
            apiKey: `Key #${logKeyIndex + 1}`,
            keyIndex: logKeyIndex,
            model: activeModel,
            operation: "ocr_extraction_chunk",
            stage: "ocr",
            courseSlug: logCourseSlug,
            status: "SUCCESS",
            durationMs: Date.now() - startTime,
          })

          rotateToNextKey(activeModel);
        }
      } catch (e: any) {
        const quotaInfo = parseGoogleQuotaError(e)
        const errMsg = e.message || ""
        const errData = quotaInfo.message || e.response?.data?.error?.message || ""
        lastOcrError = errData || errMsg
        let errStatus = "ERROR"
        if (errMsg.includes("429") || errData.includes("429") || errData.includes("quota")) errStatus = "RATE_LIMIT_429"
        else if (errMsg.includes("503") || errData.includes("503")) errStatus = "SERVER_ERROR_503"
        else if (errMsg.includes("timeout") || errMsg.includes("ECONNABORTED")) errStatus = "TIMEOUT"

        console.warn(`[MARKDOWN_OCR] Key #${logKeyIndex + 1} başarısız (${errStatus}, deneme ${chunkAttempt}/${MAX_CHUNK_OCR_ATTEMPTS}): ${lastOcrError.substring(0, 120)}`)

        await writeApiUsageLog({
          apiKey: `Key #${logKeyIndex + 1}`,
          keyIndex: logKeyIndex,
          model: activeModel,
          operation: "ocr_extraction_chunk",
          stage: "ocr",
          courseSlug: logCourseSlug,
          status: errStatus,
          errorDetail: (errData || errMsg).substring(0, 500),
          durationMs: Date.now() - startTime,
        })

        if (quotaInfo.isDaily) {
          suspendedKeys.set(logKeyIndex, Date.now())
          await report(`Günlük kota doldu (Key #${logKeyIndex + 1})`)
        }

        const isQuotaError = errStatus === "RATE_LIMIT_429" || errStatus === "SERVER_ERROR_503"
        if (isQuotaError) {
          if (errStatus !== "SERVER_ERROR_503") {
            suspendedKeys.set(logKeyIndex, Date.now())
          }
          rotateToNextKey(activeModel)
          if (rotatedKeysCount < maxRotations) {
            rotatedKeysCount++;
            chunkAttempt--; // Do not count this as an attempt because we rotated to a fresh key
            console.log(`[MARKDOWN_OCR] 🔄 Key #${logKeyIndex + 1} kota limitine takıldı, Key #${currentKeyIndex + 1} ile yeniden denenecek. (Rotasyon: ${rotatedKeysCount}/${maxRotations})`);
          }
        }
      } finally {
        if (tempChunkPath) {
          try {
            await fsPromises.unlink(tempChunkPath);
            console.log(`[MARKDOWN_OCR] 🗑️ Geçici yerel PDF silindi: ${tempChunkPath}`);
          } catch (unlinkErr: any) {
            // ignore
          }
        }
        if (uploadedFile && fileManagerInstance) {
          try {
            console.log(`[MARKDOWN_OCR] 🗑️ Buluttaki geçici PDF siliniyor: ${uploadedFile.name}`);
            await fileManagerInstance.deleteFile(uploadedFile.name);
            console.log(`[MARKDOWN_OCR] 🗑️ Buluttaki geçici PDF başarıyla silindi.`);
          } catch (deleteErr: any) {
            console.error(`[MARKDOWN_OCR] ❌ Buluttaki geçici PDF silinemedi: ${uploadedFile.name}, Hata: ${deleteErr.message}`);
          }
        }
      }
    }

    if (!chunkSuccess) {
      if (allKeysDailyExhausted(OCR_MODEL)) {
        throw new ApiQuotaExhaustedError(
          "Google günlük API limiti doldu. Pasifik saatiyle gece yarısı sıfırlanır; yarın Devam Ettir ile yeniden başlatın.",
          "daily",
        )
      }
      throw new OcrChunkRateLimitError(
        lastOcrError
          ? `OCR yoğunluk sınırı (${MAX_CHUNK_OCR_ATTEMPTS} deneme): ${lastOcrError.substring(0, 200)}`
          : `OCR yoğunluk sınırı aşıldı (${MAX_CHUNK_OCR_ATTEMPTS} deneme). Birkaç dakika sonra «Devam Ettir» ile tekrar deneyin.`,
      )
    }

    finalMarkdown = finalMarkdown.length === 0
      ? chunkResult.trim()
      : stitchOcrMarkdownChunks(finalMarkdown, chunkResult);
    
    // Add small delay between chunks to avoid bursting
    if (chunkEndIdx < endIdx) {
       await new Promise(r => setTimeout(r, 5000));
    }
  }

  return `[MARKDOWN_OCR_SUCCESS]\n[VISUAL_OCR_COMPLETE]\n\n${finalMarkdown.trim()}`;
}


// Üç modlu AI çağrısı (MAKER: Gemini 3.5, CHECKER: Gemini 2.5)
export async function callAI(prompt: string, retries = 2, mode: "generation" | "verification" | "question_generation" | "notes_generation" | "flashcard_generation" | "kontrolor" | "ground_truth" | "mufettis" | "cerrahi_yama" = "generation", priority: "high" | "normal" = "normal"): Promise<string> {
  // Üretim yerleri (Eski Groq/DeepSeek) -> 3.5 Flash, Diğerleri -> 2.5 Flash
  // ⚠️ Model kotası key bazında AYRI sayıldığı için key seçiminden ÖNCE modelId belli olmalı.
  const isGeneration = mode === "generation" || mode === "question_generation" || mode === "notes_generation" || mode === "flashcard_generation";
  const MODEL_ID = isGeneration ? "gemini-3.5-flash" : "gemini-2.5-flash"

  await ensureDailyCountersHydrated()

  if (geminiKeys.length > 0) {
    let temperature = 0.1
    if (mode === "notes_generation") {
      const isStrict = prompt.includes("🔒 STRICT KAYNAK MODU")
      temperature = isStrict ? 0.3 : 0.7
    } else if (mode === "question_generation" || mode === "flashcard_generation") {
      temperature = 0.4
    } else if (mode === "kontrolor" || mode === "mufettis" || mode === "ground_truth" || mode === "cerrahi_yama") {
      temperature = 0.0
    }

    const geminiBody = (p: string, maxTokens: number) => {
      const parts: any[] = [{ text: p }]
      
      return {
        contents: [{ parts }],
        generationConfig: { temperature, maxOutputTokens: maxTokens }
      }
    }

    const modelChain = [{ id: MODEL_ID, tokens: isGeneration ? 16384 : 16384 }]

    const startKeyIndex = currentKeyIndex
    let triedAllKeys = false
    let consecutiveWaitCycles = 0

    while (!triedAllKeys) {
      // 🚨 ABORT SIGNAL (İPTAL SİNYALİ) KONTROLÜ
      // Kullanıcı Duraklat butonuna bastıysa, dış katmandan gelen sinyali yakala ve döngüyü anında kes.
      const contextMatch = prompt.match(/\[LOG_CONTEXT:\s*([^\]]+)\]/)
      const sectionMatch = prompt.match(/BÖLÜM:\s*"?([^"\n]+)"?/) || prompt.match(/DERS:\s*"?([^"\n]+)"?/)
      const logContext = contextMatch ? contextMatch[1] : (sectionMatch ? sectionMatch[1] : mode)
      const logCourseSlug = logContext.substring(0, 150)
      const courseNamePart = logContext.split(">")[0].trim()
      
      if (isCancelled(logCourseSlug) || isCancelled(courseNamePart)) {
         throw new Error("İşlem kullanıcı tarafından anında duraklatıldı (AbortSignal).");
      }

      const currentKey = getNextGeminiKeyWithFallback(MODEL_ID, consecutiveWaitCycles)
      
      if (!currentKey) {
        // GÜNLÜK (RPD) tükenmesi: dakika beklemek ÇÖZMEZ → sonsuz döngüye girme, net uyar ve üst katmana bırak
        if (allKeysDailyExhausted(MODEL_ID)) {
          console.error(`[AI_ENGINE] ⛔ Tüm projelerin GÜNLÜK (RPD) kotası doldu — yarın PT gece yarısı sıfırlanır`)
          triedAllKeys = true
          break
        }
        if (geminiKeys.length === 0) {
          triedAllKeys = true
          break
        }
        consecutiveWaitCycles++
        const waitSec = getSecondsUntilKeyAvailable(MODEL_ID)
        console.log(`[AI_ENGINE] ⏳ Uygun key yok (RPM/askı). ${waitSec}sn bekleniyor... (döngü ${consecutiveWaitCycles})`)
        updateActiveSectionMicroPhase(`⏳ Uygun key yok, ${waitSec}sn dinlendiriliyor...`).catch(() => {})
        await new Promise(r => setTimeout(r, waitSec * 1000))
        if (isCancelled(logCourseSlug) || isCancelled(courseNamePart)) {
          throw new Error("İşlem kullanıcı tarafından anında duraklatıldı (AbortSignal).");
        }
        continue
      }
      consecutiveWaitCycles = 0
      
      const geminiHeaders = { "Content-Type": "application/json", "x-goog-api-key": currentKey }
      let quotaHit = false

      const keyFileUri = activeFileUrisMap[String(currentKeyIndex)] || undefined

      for (const model of modelChain) {
        const startTime = Date.now()
        let callStatus = "SUCCESS"
        
        // Extract context from prompt for logging
        const contextMatch = prompt.match(/\[LOG_CONTEXT:\s*([^\]]+)\]/)
        const sectionMatch = prompt.match(/BÖLÜM:\s*"?([^"\n]+)"?/) || prompt.match(/DERS:\s*"?([^"\n]+)"?/)
        const logContext = contextMatch ? contextMatch[1] : (sectionMatch ? sectionMatch[1] : mode)
        const stageMap: Record<string, string> = {
          notes_generation: "notes",
          kontrolor: "kontrolor",
          ground_truth: "ground_truth",
          mufettis: "mufettis",
          cerrahi_yama: "yama",
          question_generation: "questions",
          flashcard_generation: "flashcards",
          verification: "verification",
          generation: "generation",
        }
        const logStage = stageMap[mode] || mode
        const logKeyIndex = currentKeyIndex

        try {
        let response: any = null
        let requestSuccess = false
        let requestAttempt = 0
        const maxRequestAttempts = 3

        while (!requestSuccess && requestAttempt < maxRequestAttempts) {
          requestAttempt++
          try {
            response = await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
              geminiBody(prompt, model.tokens), { headers: geminiHeaders, timeout: 240000 }
            )
            requestSuccess = true
          } catch (e: any) {
            const errMsg = e.message || ""
            const errData = e.response?.data?.error?.message || ""
            const is503 = errMsg.includes("503") || errData.includes("503") || errMsg.includes("Service Unavailable")
            
            if (is503 && requestAttempt < maxRequestAttempts) {
              const backoffMs = requestAttempt * 1500 // 1.5s, 3s bekle
              console.log(`[AI_ENGINE] ⚠️ Key #${logKeyIndex + 1} anlık 503 aldı, ${backoffMs/1000}s sonra hızlı deneme #${requestAttempt + 1} yapılacak...`)
              await new Promise(r => setTimeout(r, backoffMs))
            } else {
              throw e // Diğer hatalarda veya maksimum deneme aşımında dış catch bloğuna fırlat
            }
          }
        }

        prisma.apiUsageLog.create({
          data: {
            apiKey: `Key #${logKeyIndex + 1}`,
            keyIndex: logKeyIndex,
            model: model.id,
            operation: mode,
            stage: logStage,
            courseSlug: logContext.substring(0, 150),
            status: "SUCCESS",
            durationMs: Date.now() - startTime
          }
        }).catch(() => {})

          const parts = response.data?.candidates?.[0]?.content?.parts || []
          const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text)
          const result = textParts.join("")
          if (result) {
            recordKeyUsage(currentKeyIndex, model.id)
            console.log(`[${isGeneration ? "MAKER_GEMINI" : "CHECKER_GEMINI"}] ✅ İşlem başarılı [Key #${currentKeyIndex + 1}] [Model: ${model.id}] [RPM: ${getKeyRpmCount(currentKeyIndex, model.id)}/${RPM_LIMIT}] [RPD: ${getKeyDailyCount(currentKeyIndex, model.id)}/${RPD_LIMIT}] [${result.length} chars]`)
            // Başarılı istekten sonra bir sonraki key'e geç (yükü eşit dağıt)
            rotateToNextKey(MODEL_ID)
            return result
          }
        } catch (e: any) {
          console.warn(`[${isGeneration ? "MAKER_GEMINI" : "CHECKER_GEMINI"}] ${model.id} failed [Key #${currentKeyIndex + 1}]: ${e.message?.substring(0, 120)}`)
          const errMsg = e.message || ""
          const errData = e.response?.data?.error?.message || ""

          let errStatus = "ERROR"
          if (errMsg.includes("429") || errData.includes("429") || errData.includes("quota")) errStatus = "RATE_LIMIT_429"
          else if (errMsg.includes("503") || errData.includes("503")) errStatus = "SERVER_ERROR_503"
          else if (errMsg.includes("timeout") || errMsg.includes("ECONNABORTED")) errStatus = "TIMEOUT"
          else if (errMsg.includes("403") || errData.includes("403")) errStatus = "FORBIDDEN_403"

          // Real-time status update on key failure
          updateActiveSectionMicroPhase(`⚠️ Key #${currentKeyIndex + 1} Hatası (${errStatus})! Yeni key'e geçiliyor...`).catch(() => {})

          prisma.apiUsageLog.create({
            data: {
              apiKey: `Key #${logKeyIndex + 1}`,
              keyIndex: logKeyIndex,
              model: model.id,
              operation: mode,
              stage: logStage,
              courseSlug: logContext.substring(0, 150),
              status: errStatus,
              errorDetail: (errData || errMsg).substring(0, 500),
              durationMs: Date.now() - startTime
            }
          }).catch(() => {})

          const isSuspended = errStatus === "FORBIDDEN_403" || errData.includes("API key not valid")
          if (isSuspended) suspendedKeys.set(currentKeyIndex, Date.now())

          // TIMEOUT ve 503'ü de kota hatası gibi değerlendirip key rotasyonuna sokuyoruz!
          const isQuotaError = errStatus === "RATE_LIMIT_429" || errStatus === "SERVER_ERROR_503" || errStatus === "TIMEOUT" || errStatus === "ERROR" || isSuspended
          if (isQuotaError) {
            quotaHit = true
            // Timeout, 503 veya genel ağ hatalarında key'i banlamaya (suspendedKeys) gerek yok, sadece diğerine geç
            if (isSuspended || errStatus === "RATE_LIMIT_429") {
              suspendedKeys.set(currentKeyIndex, Date.now())
            }
            continue
          }
        }
      }

      if (quotaHit) {
        const nextKey = rotateToNextKey(MODEL_ID)
        if (!nextKey || currentKeyIndex === startKeyIndex) {
          triedAllKeys = true
        } else {
          await new Promise(r => setTimeout(r, 5000))
        }
      } else {
        break 
      }
    }
  }

  if (retries > 0) {
    await new Promise(r => setTimeout(r, 60000))
    return callAI(prompt, retries - 1, mode, priority)
  }

  if (allKeysDailyExhausted(MODEL_ID)) {
    throw new ApiQuotaExhaustedError(
      "Google günlük API limiti doldu. Pasifik saatiyle gece yarısı sıfırlanır.",
      "daily",
    )
  }

  throw new Error(`API kota sınırına ulaştı (${mode} / ${priority}).`);
}

// ==================== SECTION ANALYSIS ====================

export async function analyzeSectionContent(content: string, sectionTitle: string, aiMode: string = "general", courseName: string = "") {
  const MAX_CONTENT_CHARS = 150000
  const truncated = content.length > MAX_CONTENT_CHARS
    ? content.substring(0, MAX_CONTENT_CHARS) + `\n\n[...İçerik kısaltıldı...]`
    : content
  const prompt = `
${getExamIntelligence(aiMode, courseName || sectionTitle)}

Aşağıdaki sınav hazırlık metnini analiz et.
⚠️ DİKKAT: Sana verilen ana metnin içinde [GÖRSEL İÇERİKLER] isimli bir bölüm görebilirsin. Bu bölümdeki görsel analiz tariflerini de analiz kapsamına mutlaka al.

BÖLÜM: "${sectionTitle}"
METİN: "${truncated.replace(/"/g, "'")}"

ÖNEM DERECESİ KURALLARI (Bölümdeki EN ÖNEMLİ konuya göre belirle — ortalama ALMA):
⚠️ Eğer bölümde TEK BİR tanım, formül, kanun maddesi, süre sınırı veya rakam bile varsa → "High" ver.
- "High" (KRİTİK): Tanımlar, formüller, yasal düzenlemeler, süre/ceza/oran sınırları, SPK tebliğleri
- "Medium" (DETAY): Sadece uygulama örnekleri, süreç açıklamaları, karşılaştırmalar (temel kavram YOK)
- "Low" (EK BİLGİ): Sadece tarihsel arka plan, genel kültür, giriş cümleleri (somut bilgi YOK)

Ayrıca bölümün GERÇEK KONU BAŞLIĞINI tespit et. "Bölüm İçeriği (Sayfa X-Y)" gibi jenerik başlıklar YAZMA.
İçeriğin ana konusunu 3-8 kelimeyle özetle (Örn: "Şüpheli İşlem Bildirimi", "Müşterinin Tanınması İlkesi", "Arz ve Talep Esnekliği").

🧠 COGNITIVE ROUTING (ÇOK KATMANLI BİLİŞSEL ANALİZ):
Bu metnin pedagojik yapısını Bloom Taksonomisi'ne göre derinlemesine analiz et. Amacımız, öğrenciyi ezbere itmemek ve sadece "gerçekten mantık, analiz ve vaka çözümü" gerektiren bölümlere çoktan seçmeli test (A,B,C,D) üretmektir.

1. Katman (Bilgi/Hatırlama): Metin SADECE kısaltma açılımları, düz terimler sözlüğü, izole tarihler veya "X nedir? Y'dir" şeklinde tek boyutlu tanımlardan mı oluşuyor? (Örn: Bölüm 1 Kısaltmalar). Eğer öyleyse, bu kısımdan senaryo sorusu çıkmaz, zorlanırsa halüsinasyon olur.
2. Katman (Kavrama/Uygulama): Metin birbiriyle ilişkili süreçler, neden-sonuç bağları, yasal istisnalar, hesaplama formülleri veya "Eğer A olursa B ne yapmalıdır?" gibi operasyonel kurallar içeriyor mu?

Karar:
- Eğer metin 1. Katman'da kalıyorsa (salt sözlük/tanım/kısaltma): "requiresQuestions": false
- Eğer metin 2. Katman veya üstüne çıkabiliyorsa (süreç, kural, senaryo): "requiresQuestions": true

${aiMode === "law" ? `
⚠️ MODÜL TESPİTİ (MASAK SINAVI İÇİN ÇOK ÖNEMLİ — SPL RESMİ MÜFREDATI):
Bu içeriğin hangi sınav modülüne ait olduğunu belirle. RESMİ KONU DAĞILIMI:
• Kitle imha silahlarının yayılmasının finansmanı
• FATF tavsiyeleri, EGMONT Group, uluslararası kuruluşlar
• AB direktifleri, uluslararası anlaşmalar
• CMK, TCK maddeleri, ceza hükümleri
• İşlem ertelemesi, malvarlığı dondurma
• Ulusal koordinasyon ve kurumlar arası iş birliği

MODÜL 2 — UYUM YÖNETİMİ (bu konulardan bahsediyorsa "Modül 2"):
• Uyum görevlisi görev ve sorumlulukları
• Uyum programı kapsamı, kurum politikası, prosedürler
• Müşterinin tanınması (KYC), kimlik tespiti
• Uzaktan kimlik tespiti
• Basitleştirilmiş / sıkılaştırılmış tedbirler
• Şüpheli işlem bildirimi (ŞİB) usul ve süreleri
• Risk yönetimi, izleme ve kontrol
• Yükümlülük denetimi, idari para cezaları
• Eğitim yükümlülükleri

JSON'a "module" alanı ekle: "Modül 1" veya "Modül 2"
` : ""}

🚨 DİKKAT (KISALTMALAR VE SÖZLÜK İSTİSNASI):
EĞER İÇERİK SADECE KISALTMALARDAN, SÖZLÜKTEN VEYA TANIMLARDAN İBARETSE BİLE, \`topics\` LİSTESİNİ ASLA BOŞ DÖNDÜRME! Metindeki tüm kısaltmaları, tanımları veya kavramları tek tek \`topics\` (konular) listesine EKSİKSİZ EKLE. Müfettiş denetimi bu listeye bakarak yapılacaktır.

Sadece şu formatta JSON döndür:
{
  "summary": "Bu bölümün 2-3 cümlelik özeti (RESMİ TERİMLERİ KORUYARAK)",
  "importance": "High veya Medium veya Low",
  "topics": ["konu1", "konu2", "konu3"],
  "keyTerms": ["önemli anahtar terimler"],
  "suggestedTitle": "İçeriğin gerçek konu başlığı (3-8 kelime)",
  "cognitiveAnalysis": "Bloom taksonomisine göre metnin bilişsel derinliği ve neden soru üretilip üretilemeyeceğinin mantıksal açıklaması",
  "requiresQuestions": true veya false${aiMode === "law" ? ',\n  "module": "Modül 1 veya Modül 2"' : ""}
}
`

  const raw = await callAI(prompt, 1)
  try {
    return extractCleanJson(raw) as {
      summary: string
      importance: string
      topics: string[]
      examLikelihood?: string
      keyTerms?: string[]
      suggestedTitle?: string
      module?: string
      requiresQuestions: boolean
    }
  } catch (e: any) {
    if (e.message && (e.message.includes("429") || e.message.includes("quota") || e.message.includes("exhausted"))) {
      throw e; // 🚨 SESSİZ ATLAMA AÇIĞI KAPATILDI: Kota hatasıysa yutma, üst katmana fırlat!
    }
    return { summary: "Analiz yapılamadı.", importance: "Medium", topics: [], examLikelihood: "", keyTerms: [], suggestedTitle: "", requiresQuestions: isGlossarySectionTitle(sectionTitle) ? false : true }
  }
}

// ==================== COURSE NOTES GENERATION (KRİTİK!) ====================

function splitContentIntoChunks(content: string, maxChunkLength = 18000): string[] {
  if (content.length <= maxChunkLength) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > maxChunkLength) {
    let splitIdx = -1;
    const window = remaining.substring(0, maxChunkLength);

    // Try splitting at a markdown header first
    splitIdx = window.lastIndexOf("\n##");
    if (splitIdx === -1) {
      splitIdx = window.lastIndexOf("\n###");
    }

    // Try splitting at a standard numbering pattern like \n1.7. or \n2.1.
    if (splitIdx === -1 || splitIdx < maxChunkLength * 0.4) {
      const match = [...window.matchAll(/\n\d+\.\d+\.?\s+/g)].pop();
      if (match && match.index !== undefined) {
        splitIdx = match.index;
      }
    }

    // Fallback to paragraph break
    if (splitIdx === -1 || splitIdx < maxChunkLength * 0.4) {
      splitIdx = window.lastIndexOf("\n\n");
    }

    // Fallback to line break
    if (splitIdx === -1 || splitIdx < maxChunkLength * 0.4) {
      splitIdx = window.lastIndexOf("\n");
    }

    // Fallback to absolute split
    if (splitIdx === -1 || splitIdx < maxChunkLength * 0.2) {
      splitIdx = maxChunkLength;
    }

    chunks.push(remaining.substring(0, splitIdx).trim());

    // Örtüşmeyi kaldırıyoruz: Konular zaten başlık veya paragraf sınırlarından bölündüğü için
    // bir sonraki parça tam olarak splitIdx noktasından kesintisiz başlar. Mükerrerliği önler.
    remaining = remaining.substring(splitIdx).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export async function generateCourseNotes(
  content: string,
  sectionTitle: string,
  courseName: string,
  userLevel: string = "beginner",
  aiMode: string = "general",
  pageStart?: number,
  pageEnd?: number,
  isChunked = false,
  chunkIndex = 0,
  chunkCount = 1,
  previousContext?: string,
  sourceMode: "strict" | "enriched" = "strict",
  documentNoteStyle?: string,
  documentType?: DocumentType,
  nextSectionTitle?: string,
  sectionConfidence?: string,
): Promise<string> {
  const isBibliography = sectionTitle.toLocaleLowerCase('tr-TR').includes("kaynakça") || sectionTitle.toLocaleLowerCase('tr-TR').includes("referans") || sectionTitle.toLocaleLowerCase('tr-TR').includes("bibliography")
  const isGlossary = isGlossarySectionTitle(sectionTitle)
  const preserveHeadings = documentType ? requiresHeadingPreservation(documentType) : false

  // Parça eşiği 8000 karaktere düşürüldü: Google ücretsiz kotasında büyük isteklerin 503 ile
  // reddedilmesini önlemek için her parça daha hafif tutulur. Birleştirme mantığı aynı kalır.
  const chunkThreshold = 8000;

  if (!isChunked && content.length > chunkThreshold) {
    const chunks = splitContentIntoChunks(content, chunkThreshold)
    if (chunks.length > 1) {
      console.log(`[AUTO-CHUNKING] 📦 Bölüm "${sectionTitle}" çok uzun olduğu için ${chunks.length} parçaya bölünüp otonom işleniyor...`)
      let mergedNotes = ""
      let lastChunkTail = ""
      for (let idx = 0; idx < chunks.length; idx++) {
        if (idx > 0) {
          console.log(`[AUTO-CHUNKING] ⏱️ Key ve limit koruması: Parçalar arasında 10 saniye bekleniyor...`)
          await new Promise(r => setTimeout(r, 10000))
        }
        console.log(`[AUTO-CHUNKING] 👉 Parça ${idx + 1}/${chunks.length} üretiliyor...`)
        const chunkResult = await generateCourseNotes(
          chunks[idx],
          sectionTitle,
          courseName,
          userLevel,
          aiMode,
          pageStart,
          pageEnd,
          true,
          idx,
          chunks.length,
          lastChunkTail,
          sourceMode,
          documentNoteStyle,
          documentType,
          nextSectionTitle,
          sectionConfidence,
        )
        if (idx === 0) {
          mergedNotes = chunkResult
        } else {
          // DİNAMİK BAŞLIK TEMİZLİĞİ — hardcoded ders isimleri yerine
          // sectionTitle'dan türetilen genel kalıplarla HER ders için çalışır
          const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          let cleanNotes = chunkResult
            .replace(new RegExp(`##\\s*📌\\s*${escapedTitle}`, "gi"), "")
            .replace(new RegExp(`##\\s*${escapedTitle}`, "gi"), "")
          if (!preserveHeadings) {
            // Mevzuat/prosedür: kaynak ## başlıkları (1. AMAÇ VE KAPSAM vb.) korunmalı — silme!
            cleanNotes = cleanNotes.replace(/^##\s+[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]{5,}$/gm, "")
          }
          cleanNotes = cleanNotes
            // "Bu Bölüm Ne Anlatıyor?" giriş bloğunu temizle (2. ve sonraki parçalarda tekrar etmemeli)
            .replace(/###\s*🎯\s*Bu Bölüm Ne Anlatıyor\??[\s\S]*?(?=###\s*(?:🏢|🔑|📊|🔄|##))/gi, "")
            .replace(/###\s*🎯\s*Bu Bölüm Ne Anlatıyor\??[\s\S]*?(?=##)/gi, "")
            .trim()
          mergedNotes += `\n\n---\n\n${cleanNotes}`
        }

        // Kayan Bağlam Hafızası (Sliding Context Window): Bir sonraki parçaya önceki parçanın son kısmını (yaklaşık 1000 karakter) pasla
        lastChunkTail = chunkResult.length > 1000 ? chunkResult.slice(-1000) : chunkResult
      }
      console.log(`[AUTO-CHUNKING] ✅ Tüm ${chunks.length} parça başarıyla üretildi ve birleştirildi (${mergedNotes.length} karakter).`)
      return mergedNotes
    }
  }

  const MAX_CONTENT_CHARS = 150000
  const truncated = content.length > MAX_CONTENT_CHARS
    ? content.substring(0, MAX_CONTENT_CHARS) + `\n\n[...İçerik ${content.length - MAX_CONTENT_CHARS} karakter kısaltıldı...]`
    : content

  const normalizedCourse = courseName.toLowerCase();
  const isSecurity = normalizedCourse.includes("güvenlik") || normalizedCourse.includes("bilgi sistem") || normalizedCourse.includes("security") || sectionTitle.toLowerCase().includes("güvenlik") || sectionTitle.toLowerCase().includes("bilgi sistem");
  const isMasak = normalizedCourse.includes("masak") || normalizedCourse.includes("uyum görev");
  const disc = getDisciplineExamples(isSecurity, isMasak, aiMode, courseName);

  // Not: Glossary bölümleri için talimatlar, aşağıdaki NOT YAPISI şablonunda
  // (SADE KISALTMALAR SÖZLÜĞÜ formatında) zaten eksiksiz tanımlanmıştır.
  // Burada ek talimat vermek çelişki yaratır ve sonsuz döngüye neden olur.
  const glossaryInstruction = ""

  let visualRulesInstruction = `
🎨 GÖRSEL YENİDEN İNŞA (VISUAL RECONSTRUCTION) KURALLARI (ÇOK KRİTİK):
- 🚫 KESİN KURAL: Öğrenciyi asla orijinal PDF'e yönlendirme! Bizim platformumuz PDF'in yerini alan kusursuz ve daha üstün bir versiyondur.
- Kaynak PDF'te gördüğün HER TÜRLÜ tabloyu, şemayı, organizasyon yapısını veya karmaşık grafiği kendin **Mermaid.js** veya **Markdown Tablosu** kullanarak çok daha şık ve anlaşılır bir şekilde YENİDEN ÇİZECEKSİN.
- 🔄 **Mermaid.js Akış Şeması:** Orijinal PDF'teki süreçleri, karar ağaçlarını, organizasyon şemalarını veya kronolojik aşamaları, eskisinden daha modern görünecek şekilde Mermaid (graph TD veya graph LR) ile çiz.
- 📊 **Markdown Bilgi Tabloları:** PDF'teki eski tip karmaşık tabloları, süre sınırlarını, cezaları veya kıyaslamaları mükemmel Markdown tablolarına çevir.
- Öğrenci bizim notlarımızı okuduğunda orijinal PDF'teki hiçbir görsele ihtiyaç duymamalıdır!
`

  if (isBibliography) {
    visualRulesInstruction = `
🎨 GÖRSEL HÜKÜMLER:
- BU BÖLÜM BİR KAYNAKÇA / REFERANSLAR BÖLÜMÜDÜR.
- KESİNLİKLE ama KESİNLİKLE Mermaid.js diyagramı veya akış şeması ÇİZMEYİNİZ. 
- Kaynakça maddeleri için diyagram çizmek mantıksız ve hatalıdır. Sıfır diyagram kuralına uyunuz.
- Sadece temiz bir Markdown liste yapısı kullanınız.
`
  } else if (isGlossary) {
    visualRulesInstruction = `
🎨 GÖRSEL HÜKÜMLER (TERİMLER SÖZLÜĞÜ İÇİN):
- BU BÖLÜM BİR KISALTMALAR VE TERİMLER SÖZLÜĞÜ BÖLÜMÜDÜR.
- KESİNLİKLE ama KESİNLİKLE hiçbir Mermaid.js diyagramı, akış şeması, zihin haritası veya kavram haritası ÇİZMEYİNİZ. Sıfır diyagram kuralına uyunuz.
- Kısaltmaları veya terimleri KESİNLİKLE düz liste veya başlıklar halinde DEĞİL, şık ve okunaklı bir Markdown Tablosu (Markdown Table) içinde veriniz.
- Tablonun sütunları: | Kısaltma / Terim | Açıklama |
- Açıklama sütununun içine SADECE resmi tanımı yazınız. Kesinlikle uydurma hikayeler, benzetmeler (💡) veya mini senaryolar YAZMAYINIZ. Bu bölüm resmi bir sözlüktür.
`
  }

  let styleInstruction = "";
  let memoryTechniqueInstruction = "";

  if (isGlossary || isBibliography) {
    styleInstruction = `
Sen son derece ciddi, profesyonel ve resmi bir DOKÜMANTASYON UZMANISIN.
Amacın, sana verilen metni (kısaltmalar, terimler veya kaynakça) en net, en temiz ve en resmi formatta, dümdüz bir bilgi listesi / tablosu olarak sunmaktır.
⚠️ KESİNLİKLE HİKAYELEŞTİRME YAPMA! 
⚠️ KESİNLİKLE BENZETME VEYA ANALOJİ KULLANMA!
⚠️ "Bu bölüm bize X'i sunmaktadır" gibi girişler KULLANMA. Doğrudan listeye/tabloya başla.
🚫 "KAYNAK METİN" KELİMESİ KESİNLİKLE YASAKTIR: "Kaynak metne göre", "verilen belgede" gibi meta-ifadeler ASLA KULLANMA.
`;
  } else if (sourceMode === "strict") {
    styleInstruction = `
Sen alanında otoriter, net ve KAYNAĞA SADIK bir SINAV HAZIRLIK UZMANISIN.
Amacın PDF kaynağındaki bilgiyi eksiksiz, doğru ve anlaşılır biçimde sunmak — kaynak dışı olgusal bilgi EKLEME.

🔒 STRICT KAYNAK MODU (SPL / CIA / CISA / MASAK):
- 🚫 "KAYNAK METİN" KELİMESİ KESİNLİKLE YASAKTIR: Ürettiğin notların hiçbir yerinde "kaynak metne tamamen sadık kalınarak", "kaynak metin baz alınarak", "yapay zeka tarafından üretildi" gibi metanın kendisini veya senin bir yapay zeka olduğunu belli eden ibareler KULLANMAYACAKSIN. Kendini profesyonel bir ders kitabı yazarı olarak kabul et.
- Tanımlar, rakamlar, süreler, cezalar ve mevzuat ifadeleri kaynak metindeki gibi olmalı.
- Hikaye, senaryo ve günlük hayat benzetmeleri SADECE kavramı açıklamaya yardımcı olacaksa ve kaynak bilgiyi bozmayacaksa kısa tutulabilir; uydurma vaka veya sayısal iddia YASAK.
- 💡 emoji ile kısa ipuçları kullanılabilir; dolgu hikayeleri yazma.
- 🚨 DÜZELTME ŞERHİ: Kaynakta nesnel hata varsa metni aynen koru, parantez içinde düzeltme notu ekle. Kendi bilgine dayanarak uydurma şerh ekleme; şerh ekleyeceğin düzeltmenin yasal/nesnel doğruluğundan %100 emin değilsen kesinlikle şerh ekleme, metni olduğu gibi bırak.
`;
    memoryTechniqueInstruction = `
🧠 HAFIZA TEKNİKLERİ (STRICT — KRİTER BAZLI, OPSİYONEL):
Senaryo ve benzetme eklemek ZORUNLU DEĞİLDİR. Aşağıdaki teknikleri sadece içeriğin bilişsel yapısı gerektiriyorsa kullan:
- **🎬 Senaryo:** SADECE metin çok adımlı bir süreç, yasal süre sınırı, bildirim akışı veya karar mekanizması içeriyorsa, bu süreci somutlaştıran kısa ve gerçekçi bir kurumsal senaryo tasarla. Tanım tek cümleyle anlaşılıyorsa (örn: "Gizlilik = izinsiz erişimin engellenmesi") altına senaryo YAZMA, tanımı ver geç.
- **💡 Benzetme (Analoji):** SADECE kavram gerçekten soyut ve anlaşılması zor ise 💡 emojiyle başlayan bir benzetme ekle. Her kavramın altına zorunlu olarak benzetme ekleme.
- Karışan kavramlar için kısa karşılaştırma tablosu veya "İKİSİ DE... AMA..." formatı.
- İçerik yeterliyse bölüm sonunda 1-2 "🧪 Kendini Test Et!" sorusu ekle.
`;
  } else {
    styleInstruction = `
Sen alanında efsaneleşmiş, otoriter ama öğrencilerin dinlemeye doyamadığı KARİZMATİK BİR MENTORSUN.
Amacın, sıkıcı ve ağır kanun maddelerini veya teknik kavramları, öğrencilerin asla unutamayacağı kadar akıcı, sürükleyici ve hikayeleştirerek anlatmak.

🎭 ÜSLUP (ALTIN DENGE - ÇOK ÖNEMLİ):
- 🚫 YAPAY ZEKA ROBOTU GİBİ KONUŞMA! "Merhaba", "Özetlemek gerekirse", "Umarım faydalı olmuştur" gibi ucuz asistan kalıpları KULLANMA.
- 🚫 "KAYNAK METİN" KELİMESİ KESİNLİKLE YASAKTIR: Ürettiğin notların hiçbir yerinde "kaynak metne tamamen sadık kalınarak", "kaynak metin baz alınarak", "yapay zeka tarafından üretildi" gibi metanın kendisini veya senin bir yapay zeka olduğunu belli eden ibareler KULLANMAYACAKSIN. Kendini profesyonel bir ders kitabı yazarı olarak kabul et. (Sadece nesnel hata yakaladığında kullanacağın şerhler bu kuraldan muaftır).
- ✅ BÖLÜM GİRİŞİ FORMATI: KESİN KURAL: Her notun en başında KESİNLİKLE '### 🎯 Bu Bölüm Ne Anlatıyor?' başlığı bulunmalı ve altında doğrudan profesyonelce konunun özeti verilmelidir. "Bu bölüm bize X'i sunmaktadır" gibi yapay giriş kalıpları YASAKTIR. Doğrudan akademik özet ver.
- 🚫 SIKICI AKADEMİSYEN OLMA! Dümdüz, paragraf paragraf akan, ansiklopedi gibi boğucu bir dil KULLANMA.
- ✅ KARİZMATİK VE AKICI OL: Metin bir TED konuşması gibi sürükleyici aksın. Kalın puntolar, madde işaretleri ve kısa cümleler kullan.
- ✅ HİKAYELEŞTİR: Karmaşık süreçleri ve soyut kavramları günlük hayattan veya doğrudan kendi disiplin alanından (${disc.disciplineName} vb.) gerçekçi, somut ve mantıksal olarak mükemmel eşleşen benzetmelerle açıkla. Basit ve tek cümleyle anlaşılan tanımlar için benzetme/hikaye EKLEME.
- ⚠️ KESİNLİKLE konuyla ilgisiz, uzak disiplinlerden (örn. gastronomi, uzay gemisi) zorlama benzetmeler YAPMA. Benzetmeler doğrudan kavramın işlevsel mantığını yansıtmalıdır. Örneğin:
${disc.analogies}
- ⚠️ 💡 📌 🔑 🎯 🪤 emojilerini BOL kullan — görsel hiyerarşi yarat.
- Bilgi kalitesi %100 kusursuz ve otoriter olmalı, ama anlatım dili su gibi akmalıdır. Tanımlar BİREBİR kaynak metinden olmalıdır.
- 🚨 DÜZELTME ŞERHİ (ÇOK ÖNEMLİ): Eğer sana verilen kaynak PDF metninde NESNEL ve KESİN bir bilgi hatası yakalarsan (örn: eski bir kanun maddesi, yanlış bir oran veya miktar), PDF'teki O HATALI BİLGİYİ SİLMEYECEK VE AYNEN YAZACAKSIN (çünkü orijinal kaynak metinde o şekilde geçiyor), ancak hemen yanına parantez içinde tam olarak şu standart formatta bir şerh düşeceksin: "(⚠️ Önemli Detay: İşbu notun orijinal dokümanında [Hatalı Bilgi] olarak geçse de, doğrusu [Doğru Bilgi]'dir.)" Kendi genel kültür veya tahmini bilgine dayanarak uydurma şerh ekleme; şerh ekleyeceğin düzeltmenin doğruluğundan %100 emin değilsen kesinlikle şerh ekleme, metni olduğu gibi bırak.
  ÖRNEK: "...bu süre 15 gündür. (⚠️ Önemli Detay: İşbu notun orijinal dokümanında 15 gün olarak geçse de, doğrusu 30 gündür.)"
`;

    memoryTechniqueInstruction = `
🧠 HAFIZA TEKNİKLERİ — KRİTER BAZLI, OPSİYONEL (NE EKSİK, NE FAZLA):
Senaryo ve benzetme eklemek ZORUNLU DEĞİLDİR. Aşağıdaki teknikleri sadece içeriğin bilişsel yapısı gerektiriyorsa kullan. Sabit bir kota yok — bölümün ihtiyacına göre 0 da olabilir, 5 de:
- **🎬 Senaryo (Süreç Odaklı):** SADECE metin çok adımlı bir süreç, yasal süre sınırı, yetki devri, bildirim mekanizması veya yaptırım/kural içeriyorsa, bu süreci somutlaştıran gerçekçi kurumsal senaryolar tasarla. Tanım tek cümleyle anlaşılıyorsa (örn: "Gizlilik = izinsiz erişimin engellenmesi") altına senaryo YAZMA, tanımı ver geç. Karmaşık süreçlerde senaryolar hâlâ teşvik edilir.
${disc.stories}
  ⚠️ KESİN KURAL: Senaryoları en altta ayrı bir başlıkta TOPLAMA! İlgili kavramın/tanımın hemen altına yerleştir ki teori ile örnek yan yana dursun.
- **💡 Benzetme (Analoji - Tanım Odaklı):** SADECE kavram gerçekten soyut, ağır hukuki veya anlaşılması güçse 💡 emojiyle başlayan bir benzetme ekle. Her tanımın altına zorunlu olarak benzetme ekleme — kavram basitse atla.
- **Akrostiş:** SADECE sıralı/listelenmiş maddeler varsa ve baş harfleri anlamlı bir kısaltma oluşturuyorsa kullan; zorlama. ${disc.akrostiş}
- **Karşılaştırma ile Fark:** Birbirine karışan iki kavram varsa "İKİSİ DE... AMA..." formatında ayırt et.
- **Mini Quiz:** İçerik yeterince doluysa büyük bölüm sonunda 1-2 "🧪 Kendini Test Et!" sorusu ekle. Cevabı hemen altına gizle.
${disc.quiz}
`;
  }

  const sourceModeInstruction = sourceMode === "enriched"
    ? `\n🎓 ZENGİNLEŞTİRİLMİŞ MOD (SMMM): Pedagojik hikaye, benzetme ve senaryolar teşvik edilir; olgusal doğruluk korunmalı.\n`
    : `\n🔒 STRICT KAYNAK MODU: PDF dışı olgusal/sayısal/hukuki iddia ekleme. Sadece kaynak kapsamında kal.\n`

  const documentTypeInstruction = documentNoteStyle
    ? `\n📋 BELGE TİPİ REHBERİ: ${documentNoteStyle}\n`
    : ""

  const nextSectionInstruction = nextSectionTitle
    ? `\n⚠️ KAPALILIK VE KAPSAM SINIRI (ÇOK KRİTİK):\n- Bu bölümden hemen sonraki bölümün başlığı "${nextSectionTitle}"'dır.\n- Metin içerisinde bu başlığı veya bu başlığın içeriğinin başladığını görürsen okumayı KESİNLİKLE o noktada kes ve sonrasını notlarına karıştırma.\n- Notları sadece ve sadece "${sectionTitle}" bölümüne ait bilgilerle sınırla. Bir sonraki konunun içeriğini bu nota sızdırma!\n`
    : ""

  // Pre-filter numbers for grounding (Soru 04)
  const numericValues = Array.from(content.matchAll(/\b\d{3,}\b/g)).map(m => m[0]);
  const uniqueNumerics = Array.from(new Set(numericValues)).slice(0, 30);
  const numericGroundingInstruction = uniqueNumerics.length > 0
    ? `\n🚨 KANIT VE SAYISAL GROUNDING (Sayısal Kanıt Zorunluluğu):
Aşağıdaki sayısal değerler/kanun numaraları kaynak metinde tespit edilmiştir. Bu sayıları ders notunda geçirirken kaynak metindeki bağlamlarına %100 sadık kal, yanlış veya uydurma bağlamlarla eşleştirme:
[Sayısal Değerler Listesi]: ${uniqueNumerics.join(", ")}\n`
    : "";

  const lowConfidenceBlock = sectionConfidence === "low" ? `
⚠️ GÜVEN SKORU DÜŞÜK SINIR BİLGİSİ (ÇOK KRİTİK):
- Bu bölümün sayfa sınırı kesin değildir.
- Sayfanın başında veya sonunda önceki/sonraki konuya ait görünen geçiş cümleleri varsa bunları kesinlikle bu ders notuna dahil etme.
- Sadece ve sadece bu bölümün doğrudan başlığıyla ilgili içeriği işle.
` : "";

  const { inventory } = extractExamInventory(content)
  const inventoryInstruction = inventory.length > 0
    ? `\n🎯 ZORUNLU KAPSAMA LİSTESİ (SINAV ENVANTERİ — ${inventory.length} Madde):\n` +
      `Aşağıdaki ${inventory.length} maddenin TAMAMI bu notta eksiksiz işlenmek ZORUNDADIR. Hiçbirini atlama:\n` +
      inventory.map((it, i) => `${i + 1}. [${it.cat}] ${it.text} (Anahtar: ${it.key})`).join("\n") +
      `\n\n⚠️ KAPSAMA & ANLATIM TAVANI KURALLARI:\n` +
      `1. ÇEKİRDEK KATMAN: Yukarıdaki maddelerin %100'ünü TİP_A/B/C/D formatında nota ekle. Bu listeyi nota doğrudan KOPYALAMA.\n` +
      `2. ANLATIM KATMANI TAVANI (%30): Benzetme (💡) ve hikayeleri SADECE envanterdeki karmaşık/soyut maddeler için kullan. Anlatım/benzetme sayısı envanterdeki maddelerin %30'unu (max ${Math.ceil(inventory.length * 0.3)} adet) GEÇEMEZ.\n`
    : ""

  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
${getExamIntelligence(aiMode, courseName || courseName || sectionTitle)}
${sourceModeInstruction}${documentTypeInstruction}
${glossaryInstruction}
${nextSectionInstruction}
${lowConfidenceBlock}
${numericGroundingInstruction}
${inventoryInstruction}

${aiMode === "international" || aiMode === "international_audit" ? "⚠️ ÇOK ÖNEMLİ KURAL: Kaynak metin İNGİLİZCE olsa dahi, üreteceğin tüm ders notları, sözlükler, açıklamalar ve örnekler KESİNLİKLE TÜRKÇE olacaktır. Orijinal İngilizce terimleri parantez içinde belirtebilirsin." : ""}

${styleInstruction}

📄 GÖRSEL İÇERİK ANALİZİ TALİMATI (ÇOK ÖNEMLİ):
Sana verilen metnin içinde [GÖRSEL İÇERİKLER] başlığı altında tarif edilen resim, tablo ve şemaları DİKKATLE OKU.
1. Tarif edilen tabloları, organizasyon şemalarını, karar ağaçlarını ve akış şemalarını Markdown veya Mermaid ile şık bir şekilde yeniden çiz.
2. Tarif edilen formülleri, hesaplama örneklerini ve kutu içi (box) uyarıları atlama.
Metin içindeki hiçbir görsel tarifini atlama. Her biri sınavda sorulabilir.

${!isGlossary ? `
3. GÖRSELLEŞTİRME (NOTLARIN ALBENİSİNİ BELİRLER — ÇOK ÖNEMLİ):
   Notları görsel açıdan zengin ve çekici yap. Dümdüz paragraflarla dolu, göz yoran notlar DEĞERSİZDİR.
   Her fırsatta görselleştir, ama içerikle uyumsuz zorlama görsel EKLEME:
   - İki veya daha fazla şey karşılaştırılıyorsa (örn: kurumlar, süreler, ceza türleri, yetkiler) → **Markdown Tablosu** yap
   - Kronolojik bir süreç, karar akışı veya hiyerarşi varsa → **Mermaid.js diyagramı** çiz (⚠️ KESİN KURAL: Mermaid diyagramlarında düğüm kimliklerinde (ID) KESİNLİKLE Türkçe karakter (ı,ğ,ü,ş,i,ö,ç) veya boşluk KULLANMA. Örn: \`A_Sirketi["İhraççı Şirket"] --> B_Kurulu["Kurul"]\`. Bu kurala uymazsan UI çöker! ⚠️ OK ETİKETİ KURALI: Dal etiketleri (Evet/Hayır vb.) MUTLAKA \`-->|"Evet"|\` veya \`-->|"Hayır"|\` formatında yaz. ASLA \`-- "Evet" -->\` veya \`-- 'Evet' -->\` formatını kullanma.)
   - Önemli bilgiler → **Emoji kutucuğu** (⚠️, 💡, 📌, 🔑)
   - Listeler → **Madde işaretli liste**
   🎯 HEDEF: Bir bölümde içerik uygunsa en az 2-3 tablo ve en az 1 Mermaid diyagramı olsun. Ama içerik gerektirmiyorsa zorlama yapma — içerik uygunluğu her şeyden önemli.
` : ''}
${memoryTechniqueInstruction}

DERS: ${courseName}
BÖLÜM: "${sectionTitle}"

  🎯 TEMEL STRATEJİ - "EKSİKSİZ, KONTROLLÜ VE AKILDA KALICI KISALIK":
  1. Kaynak metindeki ve PDF'teki HER BİLGİYİ nota dahil et. HİÇBİR kavram, terim, tanım, oran, süre, formül, istisna, kural ATLANMAYACAK.
  2. ETİKETLEME (ÇOK ÖNEMLİ): Her ana başlığın yanına konunun ait olduğu sınav modülünü köşeli parantez içinde yaz ${disc.labelExample}.
  3. BİLGİNİN YAPISINA GÖRE FORMATLANDIRMA (KISALIK VE ANLAŞILIRLIK KİLİDİ):
     - [TİP A] Sayısal ve Resmi Bilgiler (Süreler, Oranlar, Cezalar, Kanun Maddeleri): DÜZ YAZI ile uzun paragraflar halinde yazılmayacak. Kesinlikle kompakt Markdown Tabloları veya maddeli listeler halinde sunulacak. (⚠️ TABLO KURALI: Ürettiğin her Markdown tablosuna mutlaka en sağa bir "Koşul / İstisna" sütunu ekle. Koşula veya istisnaya bağlı olmayan kurallar için bu sütuna "Genel Kural" yaz. Bu sütun hiçbir yasal koşulun veya istisna cümlesinin sıkıştırılırken yutulmamasını garanti etmelidir.)
     - [TİP B] Kavramsal Farklar / Soyut İlişkiler: Açıklamalar kısa tutulacak ve gerekirse teori ile yan yana duran kurgusal hikaye/senaryolar sadece "💡 Somut Benzetme:" başlığıyla eklenecek. (Kritik Kısıt: Somut benzetmelerin içine KESİNLİKLE uydurma süre sınırları veya sayısal limitler yazılmayacak, sayılar sadece tablolarda/orijinal ifadelerde bulunabilir.) (⚠️ TİP_B KISALIK İSTİSNASI: Genel kısalık ve büzme baskısı TİP_B (Somut Benzetmeler) için geçerli değildir! Benzetmelerin ve hikayelerin pedagojik açıklama kalitesi ve derinliği korunmalı, aşırı sıkıştırılarak kuru tanımlara indirgenmemelidir.)
     - [TİP C] Adımlar ve Süreçler: Kronolojik yasal prosedürler ve karar ağaçları düz paragrafla anlatılmayacak; doğrudan modern Mermaid.js diyagramları ile çizilecek. (⚠️ MERMAID KARMAŞIKLIK SINIRI: Çizdiğin her Mermaid diyagramı en fazla 10-12 düğüm (node) içermelidir. 12 düğümden daha büyük ve aşırı karmaşık akışlar için tek bir dev diyagram çizme; akışı mantıklı 2-3 küçük diyagrama böl veya numaralı liste kırılımları ile destekle.)
     - [TİP D] Risk Noktaları: Sınav tuzakları "### 🪤 Ekstra Dikkat Edilmesi Gereken Hususlar" başlığı altında Wrong->Correct şeklinde özetlenecek.
  4. GÖRSELLEŞTİRME KURALLARI:
     - Karşılaştırmalar → **Markdown Tablosu** (en az 2-3 tablo olmalı)
${!isGlossary ? `     - Süreçler, hiyerarşiler, ilişkiler → **Mermaid.js diyagramı** (en az 2-3 diyagram olmalı. ⚠️ KESİN KURAL: Mermaid düğüm kimliklerinde (ID) ASLA Türkçe karakter veya boşluk kullanma. Örn: \`A_Sirketi["İhraççı Şirket"] --> B_Kurulu["Kurul"]\`. Bu kurala uymazsan UI çöker! ⚠️ OK ETİKETİ KURALI: Dal etiketleri MUTLAKA \`-->|"Evet"|\` formatında yaz; ASLA \`-- "Evet" -->\` kullanma.)` : ''}
     - Önemli bilgiler → **Emoji kutucukları** (⚠️, 💡, 📌, 🔑)
     - Listeler → **Madde işaretli liste**
4. TEMİZLİK: Parantez içindeki kaynakça referanslarını (örn: (ISO 27001, Madde 7.5), (SPK Tebliğ No: III-56.1)) notlardan tamamen temizle. Sadece anlamlı bilgiyi bırak (MD5, SHA-1 gibi teknik standart adları kalabilir).
5. VURGULAR: Önemli kelimeleri **kalın**, terimleri *eğik* yap.
6. ${preserveHeadings
    ? `BAŞLIK SADAKATİ (MEVZUAT/PROSEDÜR): Kaynak PDF'teki numaralı bölüm başlıklarını (1. AMAÇ VE KAPSAM, 2. DAYANAK vb.) ## ile AYNEN ve kaynak sırasıyla yaz. Birleştirme, yeniden adlandırma, atlama veya "3-4 konuya" indirgeme YASAK. Alt başlıklar (6.1, Madde 5 vb.) ### ile koru.`
    : `ASLA yeni bir alt başlık açma, mevcut başlıkların hiyerarşisini bozma.`}
7. 🚨 KAYNAK HATALARINI YÖNETME MUHAKEMESİ (TRIVIAL vs CRITICAL):
   Kaynak metinde yazar veya dizgi kaynaklı bir hata fark edersen, şu filtreye göre davran:
   - A) TRIVIAL (Önemsiz/Şekilsel) Hatalar: Harf eksikliği, imla hatası, İngilizce-Türkçe kelime veya telaffuz farkı (Örn: 'Standard' yerine 'Standart', 'Asynchronous' yerine 'Asynchrous'). KURAL: Bunlar için KESİNLİKLE uyarı veya şerh düşme! Okunabilirliği bozmamak için kaynağa BİREBİR sadık kal, kaynakta hatalı yazılmış ingilizce/türkçe kelimeleri (örn: Asynchrous, Standart) aynen kaynakta yazdığı gibi yazıp geç (sakın sessizce düzeltme veya yanına şerh ekleme). Trivial hataların varlığını tamamen yok say, "Dikkat: kaynakta şu kelime yanlış yazılmış" diyerek metnin hiçbir yerinde liste/şerh yapma!
   - B) CRITICAL (Kritik/Yasal) Hatalar: Yanlış kanun numarası (610 yerine 6102), yanlış ceza miktarı, yanlış tarih. KURAL: Sadece bu tür öğrenciye sınav kaybettirecek hayati/yasal hatalarda kaynağı aynen yazıp hemen yanına *(Not: Mevzuata göre doğrusu şudur)* diye kısa ve öz bir uyarı ekle. KESİNLİKLE sayfa sonuna ayrı bir başlık açma, uyarıyı kelimenin geçtiği yerde parantez içinde yap.
   - C) OLMAYAN HATAYI UYDURMA YASAĞI: Kaynak metinde gerçekte bir hata yokken, kendi kafandan kaynakta hata/yarım kalma varmış gibi iddialarda bulunup (örn: "Kaynakta W3C terimi yarım kalmıştır" vb.) sakın uyarı veya şerh ekleme! Sadece kaynakta KESİN ve GERÇEK bir yasal/olgusal hata varsa ve buna %100 eminsen kritik şerh düş.
${isGlossary ? '7.5 ⚠️ SÖZLÜK/KISALTMA KURALI: Bu sayfa sadece bir sözlük olduğu için ASLA en alta "Ekstra Dikkat Edilmesi Gereken Hususlar", "Özet", "Analiz", "Kendini Test Et" gibi ek başlıklar AÇMA! Sadece listeyi/tabloyu ver ve bitir.' : ''}
8. ⚠️ KESİN KURAL: Asla ama asla "Harika bir görev", "İşte notlar", "İşte güncellenmiş versiyon" gibi sohbet, giriş veya kapanış cümleleri yazma! Sadece saf Markdown çıktısı ver. Doğrudan notun içeriğiyle başla.
9. Dolgu metinleri ATLA: genel giriş cümleleri, tarihsel arka plan, "bu bölümde şunları öğreceğiz" tarzı metinler.
10. Her kavramı sıfır bilgili birinin bile anlayacağı şekilde açıkla. Argo/laubali tabirler ("kocaman bir yalan", "şunu unutma" vb.) YASAKTIR. ⚠️ NETLİK: Yukarıdaki hafıza teknikleri bölümünde istenen GERÇEKÇİ KURUMSAL senaryolar/hikayeler serbesttir ve teşvik edilir; ANCAK kaynak metinde OLMAYAN olay/rakam/kural UYDURMA ve şahıs ismi (Ahmet, Mehmet) kullanma. Senaryolar daima kaynaktaki bilgiyi pekiştirmeli, asla yeni "bilgi" eklememelidir.
11. Hedef: 10 sayfalık bir PDF bölümünün notu ~8 sayfa olmalı. Yoğun ama EKSİKSİZ.
12. 📐 MATEMATİKSEL FORMÜL KURALI: Metin içinde formül, hesaplama veya matematiksel ifade geçiyorsa bunları KaTeX/LaTeX formatında yaz. Satır içi formüller $...$ ile, bağımsız formüller $$...$$ ile yazılmalıdır. Her formülün hemen altına somut rakamlarla adım adım çözülen kısa bir örnek ekle. Örnek format:
   $$GD_t = BD \times (1+r)^t$$
   *Örnek:* BD=100 TL, r=%10, t=2 yıl ise → $GD_2 = 100 \times (1.10)^2 = 121$ TL

🔴 SAYFA BAZLI TARAMA TALİMATI (EN KRİTİK KURAL):
PDF'in ${pageStart || '?'}. sayfasından ${pageEnd || '?'}. sayfasına kadar HER SAYFAYI TEK TEK TARA.
Her sayfa için şu kontrol listesini uygula:
- Bu sayfada geçen TÜM kavram tanımları yazıldı mı?
- Bu sayfada geçen TÜM sayısal değerler (oranlar, süreler, limitler, ceza miktarları) yazıldı mı?
- Bu sayfada geçen TÜM listeler (kurum isimleri, katalog suçlar, belge türleri) TAMAMI yazıldı mı?
- Bu sayfada geçen TÜM tablolar satır satır yazıldı mı? (yarıda bırakma!)
- Bu sayfada geçen TÜM istisnalar ve özel durumlar (küçükler, kısıtlılar, yabancılar, unhosted wallet vb.) yazıldı mı?
- Bu sayfada geçen TÜM ceza/yaptırım bilgileri yazıldı mı?
⛔ Sayfayı "genel olarak özetleme" — sayfadaki HER MADDEYİ yaz!

${visualRulesInstruction}

📋 HER KAVRAM İÇİN FORMAT:
- **[Resmi Terim]:** [Resmi tanım - kaynak metindeki cümleyi BİREBİR kopyala, TEK KELİME değiştirme]

‼️ KRİTİK: Tanım cümlesini asla sadeleştirme, kısaltma veya kendi cümlenle anlatma. Sınavda "aşağıdakilerden hangisi X'in tanımıdır?" diye birebir bu cümle sorulabilir. Tanımı AYNEN yaz.

ÖRNEK (tanım formatı — terim mutlaka ders kapsamından seçilmeli):
- **[Resmi Terim]:** [Kaynak metindeki resmi tanım cümlesi birebir]

⚠️ KESİN KURALLAR:
1. Resmi terimleri KESİNLİKLE değiştirme. Sınavda birebir bu terimler sorulur.
2. Tanımın KENDİSİNİ (resmi tanım cümlesini) kaynak metinden BİREBİR al, değiştirme. Tanımı açıklarken gerçekçi kurumsal senaryolar kullanabilirsin AMA tanım cümlesinin kendisi birebir korunmalı; fiktif şahıs isimleri (Ahmet, Mehmet) KULLANMA.
3. Sayısal sınırlar, oranlar ve tarihler MUTLAKA yaz. BUNLAR SIKÇA SORULUR.
4. Formüller varsa formülü yaz + sayısal örnek ile adım adım çöz.
5. Benzer kavramlar arasındaki farkı TABLO ile göster.
6. Cevabı ASLA yarıda kesme.
8. İSTİSNALARI ve ÖZEL DURUMLARI mutlaka belirt.
9. 🇹🇷 DİL KALİTESİ: Türkçe dil bilgisi, kelime dizilimi ve akıcılığa %100 uy. İngilizce'den doğrudan çevrilmiş gibi duran yapay veya ters yapılar ("Özeti [Konu]", "Sözlüğü [Konu]", "Notları [Konu]") KESİNLİKLE kullanma. Her zaman doğal ve düzgün bir Türkçe ile akıcı cümleler kur.

${isGlossary ? `
📋 NOT YAPISI (Markdown - KATEGORİLİ KISALTMALAR TABLOSU):

## 📌 ${sectionTitle}

### 🎯 Bu Bölüm Ne Anlatıyor?
(Bu sözlük/kısaltmalar bölümünde ne anlatıldığını 2 cümle, maksimum 3 cümle ile yazacaksın. Abartma yapmadan, gerçeğin dışına çıkmadan sadece içeriği özetle. KESİNLİKLE "X Sınavı", "Y Dersi" diye kendi kafandan sınav/ders adı uydurma. "Kaynak metne tamamen sadık kalınarak", "Kaynak metne göre" gibi meta-ifadeler KESİNLİKLE kullanma. Profesyonel bir kitap yazarı gibi davran.)

Kaynak metindeki mantıksal gruplara göre alt başlıklar aç (Örn: "🏢 Düzenleyici Kurumlar", "🌐 Ağ Protokolleri").
Her alt başlığın altında AYRI bir Markdown tablosu kullan:

| Kısaltma / Terim | Açıklama |
|------------------|----------|
| (Kaynaktaki terim) | (Kaynaktaki resmi tanım/açılım — birebir, tek kelime değiştirmeden) |

⚠️ KESİNLİKLE EKLEME: hikâye, senaryo, benzetme, akrostiş, Mermaid/akış şeması, zihin haritası, "Ekstra Dikkat", "Bölüm Özeti", "Kendini Test Et".
` : preserveHeadings ? `
📋 NOT YAPISI (Markdown - KAYNAK BAŞLIK SADAKATİ):

## 📌 ${sectionTitle}

### 🎯 Bu Bölüm Ne Anlatıyor?
(Bu bölümde ne anlatıldığını 2 cümle, maksimum 3 cümle ile yazacaksın. Abartma yapmadan, gerçeğin dışına çıkmadan, sadece metnin özünü özetle. KESİNLİKLE "X Sınavı", "Y Dersi" diye kendi kafandan sınav/ders adı uydurma. "Kaynak metne tamamen sadık kalınarak", "Kaynak metne göre" gibi meta-ifadeler KESİNLİKLE kullanma. Profesyonel bir kitap yazarı gibi davran.)

🚨 BAŞLIK SADAKATİ (YAPISAL ÖĞRETİM — EN ÖNCELİKLİ):
Kaynak metindeki TÜM numaralı ana bölüm başlıklarını kaynak sırasıyla ## olarak yaz. Örnek format:
## 1. AMAÇ VE KAPSAM
## 2. DAYANAK
## 3. TANIMLAR
- Başlık numarası ve metni PDF'teki gibi AYNEN olmalı (büyük/küçük harf dahil).
- Alt başlıklar (6.1, Madde 12 vb.) kaynakta varsa ### ile koru.
- Başlıkları birleştirme, yeniden adlandırma veya atlama YASAK.
- Her ## başlık altında o bölümün tüm içeriğini öğret: resmi tanımlar birebir, tablolar, süreçler, kısa senaryolar.

## [Kaynaktaki 1. ana başlık — aynen]
(Bölüm içeriği: tanımlar, tablolar, Mermaid süreçleri, 💡 ipuçları)

## [Kaynaktaki 2. ana başlık — aynen]
(...)

(Tüm kaynak ana başlıkları bu şekilde devam eder)
` : `
📋 NOT YAPISI (Markdown - KONUSAL ENTEGRASYON MODELİ):

## 📌 [Bölümün Gerçek Konu Başlığı]

### 🎯 Bu Bölüm Ne Anlatıyor?
(2-3 cümle ile bölümün özü ve neden önemli olduğu)

Metni 3 veya 4 ana alt başlığa (Konuya) böl. Her bir alt başlık altında, o konunun tüm bileşenlerini (tanımlar, hikayeler, eğer gerekiyorsa tablolar, formüller ve şemalar) bir bütün halinde akıt:

### ## 🏢 Konu 1: [Birinci Ana Konu Adı] [[İlgili Mevzuat/Sınav Modülü Başlığı]]
(Bu konunun kapsamını ve önemini açıklayan kısa bir giriş)
*   **Kavram Tanımları:** Konu altındaki her bir kritik terimi, resmi yasal tanımıyla (aynen kaynak metinden) ver. KESİNLİKLE hikaye, senaryo veya kurgusal karakterler (Ahmet, Mehmet) uydurma. Sadece saf ve profesyonel mevzuat bilgisini aktar.
    - *Örn format:*
      - **Resmi Terim Adı:** Orijinal yasal tanım cümleleri...
*   📊 **Karşılaştırma / Bilgi Tablosu:** İçerikte karşılaştırılacak kavramlar, süreler, limitler veya kurallar varsa bunları şık bir Markdown tablosuna dök. Tablo için uygun malzeme varsa KESİNLİKLE atlama — ama içerikle alakasız zorlama tablo da ekleme.
*   🔄 **Süreç Akışı (Mermaid.js):** Konuda kronolojik bir süreç, karar ağacı veya hiyerarşi varsa Mermaid diyagramı çiz. DİKKAT: Sözdizimi hatası olmaması için düğüm metinlerini KESİNLİKLE tırnak içine al (Örn: A["Örnek Metin"]). Görsel zenginlik notun albenisini artırır — fırsat varsa çiz, yoksa zorlama.

### ## 🏢 Konu 2: [İkinci Ana Konu Adı] [[İlgili Mevzuat/Sınav Modülü Başlığı]]
(Bu konuya özel tüm yasal tanımlar, tablolar, formüller ve şemalar burada bir arada akacaktır...)

### ## Konu 3: ...
`}

### 🪤 Ekstra Dikkat Edilmesi Gereken Hususlar
(Sınavda en çok yanlış yapılan noktalar, karıştırılan kavramlar ve şaşırtmaca sorularda dikkat edilmesi gereken spesifik detaylar. Her maddeyi mümkünse "❌ Yanlış: ... → ✅ Doğru: ..." formatında yaz. Genel ve soyut uyarılar değil, somut ve spesifik tuzaklar listele.)

### 🔑 Bölüm Özeti
(Tüm bölümü içeren hap niteliğinde tablo veya madde listesi)

### 🧪 Kendini Test Et!
(Bölüm sonu pratik test soruları. Lütfen soruları ve şıkları düzenli bir şekilde yaz. **ASLA** A şıkkını soruyla aynı satıra yazma!
Doğru Format:
Soru 1: Soru metni burada...
A) Seçenek 1
B) Seçenek 2
...gibi her şıkkı yeni satıra yaz.)

⛔ YAPMA LİSTESİ:
- 🚫 **YASAKLI KELİMELER LİSTESİ (BUNLARI KULLANIRSAN SİSTEM ÇÖKER):** "derinlemesine", "adım adım", "kapsamlı bir rehberdir", "eksiksiz bir yol haritasıdır", "bu bölüm bize şunu sunar", "bu bölüm şunu ele almaktadır", "bu bölümde şunları inceleyeceğiz", "eşsiz", "hayati önem taşır", "hayati", "benzersiz", "olağanüstü", "son derece", "fevkalâde", "göz atalım", "dalış yapalım", "comprehensive", "critical", "key point". Bu abartılı, yapay ve/veya İngilizce kelimeleri ASLA ama ASLA kullanma! Türkçe yaz, doğal yaz, iddialı yapay kelimeler YASAK!
- "Merhaba", "Bugün şunu işleyeceğiz" gibi giriş cümleleri YASAKTIR. (Sadece '### 🎯 Bu Bölüm Ne Anlatıyor?' başlığı altında doğrudan teknik özet yap).
- **ASLA KENDİ KAFANDAN SINAV TAKTİĞİ VEYA YORUM UYDURMA!** "Sınavda doğrudan şu terimler sorulmaktadır", "Buraya çok dikkat edin", "Bu konu çok önemlidir" gibi HOCALIK TASLAYAN veya kaynak metinde (PDF'te) olmayan hiçbir yönlendirici/abartı cümleyi **ASLA KULLANMA.** Sadece ve sadece ham metindeki teknik bilgiyi çevir.
- "PDF'in X. sayfasındaki" gibi kaynağa atıf YAPMA.
- Başlıklara "(Eksiksiz)", "(varsa)" gibi parantez açıklamaları YAZMA.
- "Bölüm İçeriği (Sayfa X-Y)" gibi jenerik başlıklar KULLANMA — gerçek konu başlığını yaz.
- Notu YARIDA BIRAKMA.
- **SÖZLÜK / KISALTMALAR İSTİSNASI:** Eğer mevcut bölüm bir "Kısaltmalar", "Tanımlar" veya "Sözlük" bölümüyse; **ASLA ÖZET ÇIKARMA!** Bütün kısaltmaları ve tanımları eksiksiz bir şekilde (hiçbirini atlamadan) listele. Bu tür sözlük bölümlerinin sonuna "🔑 Bölüm Özeti" veya "🧪 Kendini Test Et!" kısmı **KESİNLİKLE EKLEME**.
- **ASLA İLİŞKİSİZ listeleri, kavramları veya kolonları aynı tabloda yan yana birleştirme.** Eğer bir tablonun kolonlarındaki satır sayıları veya eşleşmeleri birbirini tutmuyorsa ve sonlara biçimsiz çizgiler ('-') koymak zorunda kalacaksan, ya da tablonun yarısından fazlası boş (blank/empty) hücrelerden oluşacaksa tablo KULLANMA! Bunun yerine ana kavramları şık bir maddeli liste (Bullet List) yap, hemen altına ise istisnaları veya detayları içeren özel bir emoji kutusu (Callout Box - örn: '🚫', '💡', '⚠️') yerleştir. Her bilgi tam satırında ve uyuşmazlıksız dursun.
- **ASLA sonradan eklenen konuları/eksikleri notun içinde yapay bir şekilde kalınlaştırma (bold yapma) veya işaretleme.** Entegre ettiğin tüm yeni/eksik bilgileri, mevzuatın diğer normal kısımları gibi doğal, akıcı ve organik bir dille paragrafların içine yedir. Sanki o bilgi en başından beri notun içindeymiş gibi düz ve doğal bir üslupla yaz.


🛠️ PDF METİN DÜZELTME TALİMATI:
- PDF'ten çıkarılan metinde "İ Ç İ N D E K İ L E R" gibi ayrık harfler olabilir. Bunları düzelterek yaz.

METİN:
${truncated.replace(/"/g, "'")}

${!isGlossary && !isBibliography ? `
📋 KRİTİK KAVRAM LİSTESİ (SİSTEM META-VERİSİ — Notun en sonuna ekle):
Notun tamamını yazdıktan sonra, EN SON SATIR olarak aşağıdaki formatta bu bölümdeki kritik sayısal değerleri, yasal süreleri ve kanun maddelerini listele.
Format: [KRİTİK_KAVRAMLAR]kavram1:değer1, kavram2:değer2, ...[/KRİTİK_KAVRAMLAR]
Örnek: [KRİTİK_KAVRAMLAR]bildirim süresi:10 gün, idari para cezası:50.000 TL, ilgili madde:Madde 18, oran:%5[/KRİTİK_KAVRAMLAR]
⚠️ Sadece metinde geçen SAYISAL değerleri, süreleri, oranları ve kanun/madde numaralarını listele. Sözel tanımları buraya YAZMA.
⚠️ Bu satır sadece sistem meta-verisidir, öğrenci görmeyecektir.
` : ''}

Ders notunu Markdown formatında yaz (JSON değil). Yukarıdaki kurallara %100 uy!
`

  let finalPrompt = prompt
  if (isChunked) {
    finalPrompt = `⚠️⚠️⚠️ [KRİTİK TALİMAT - PARÇALI ÜRETİM MODU]:
Bu ders notu çok uzun olduğu için sistem tarafından otomatik olarak ${chunkCount} parçaya bölünmüştür.
Şu an **${chunkIndex + 1}. parçayı (Parça ${chunkIndex + 1}/${chunkCount})** üretiyorsun.

${previousContext ? `
⚠️ ÖNCEKİ PARÇANIN SONU (KAYAN BAĞLAM HAFIZASI):
Aşağıda bir önceki parçanın nasıl bittiğini görüyorsun. Lütfen bu metni okuyarak, anlatım akışını tam olarak bu noktadan kesintisiz, akıcı bir roman gibi devam ettir. Önceki parçada zaten anlattığın terimleri ve konuları SAKIN tekrar açıklama:
"""
${previousContext}
"""
` : ''}

${chunkIndex === 0 ? `
- Bu ilk parça olduğu için ders notunun ana başlığını (## 📌 ...) ve "🎯 Bu Bölüm Ne Anlatıyor?" giriş kısmını mutlaka ekle.
- SADECE sana aşağıda verilen [KAYNAK METİN PARÇASI] içindeki konuları detaylandır. Kalan diğer konuları sonraki parçalara bırak.
- Ders notunun sonundaki "🪤 Ekstra Dikkat Edilmesi Gereken Hususlar", "🔑 Bölüm Özeti" ve "🧪 Kendini Test Et!" kısımlarını KESİNLİKLE yazma, bunları son parçaya bırak.
` : `
- Bu ${chunkIndex + 1}. parça olduğu için ders notunun ana başlığını (## 📌 ...) ve giriş kısmını KESİNLİKLE yazma (çünkü 1. parçada yazıldı).
- SADECE sana aşağıda verilen [KAYNAK METİN PARÇASI] içindeki konuları detaylandır.
${chunkIndex === chunkCount - 1 ? `
- Bu son parça olduğu için, ders notlarının en sonuna tüm bölümü kapsayan "🪤 Ekstra Dikkat Edilmesi Gereken Hususlar", "🔑 Bölüm Özeti" ve "🧪 Kendini Test Et!" kısımlarını mutlaka ekle.
` : `
- Ders notunun sonundaki "🪤 Ekstra Dikkat Edilmesi Gereken Hususlar", "🔑 Bölüm Özeti" ve "🧪 Kendini Test Et!" kısımlarını KESİNLİKLE yazma, bunları son parçaya bırak.
`}
`}

---

` + prompt
  }

  const result = await callAI(finalPrompt, 2, "notes_generation")

  // ⚠️ NOT KESİLME ALGILAMA
  // Notun sonu beklenen kapanış bölümleriyle bitmiyorsa kesilmiş demektir.
  if (!isChunked || chunkIndex === chunkCount - 1) {
    // Son parça veya tek parça — kapanış bölümleri olmalı
    const hasClosingSection = result.includes("Kendini Test Et") ||
      result.includes("Bölüm Özeti") ||
      result.includes("Ekstra Dikkat Edilmesi Gereken Hususlar") ||
      result.includes("🧪") ||
      result.includes("🔑")
    if (!hasClosingSection && result.length > 2000) {
      console.warn("[AI_ENGINE] [WARNING] NOT KESILME UYARISI: " + sectionTitle + " - Not kapanis bolumlerini (Test Et / Ozet) icermiyor. maxOutputTokens yetersiz olabilir! (" + result.length + " karakter)");
    }
  }

  return result
}

// ==================== FLASHCARD GENERATION ====================

export async function generateFlashcards(
  content: string,
  sectionTitle: string,
  courseName: string,
  userLevel: string = "beginner",
  aiMode: string = "general",
  fileUri?: string,
  pageStart?: number,
  pageEnd?: number,
  /** Kaynak doğrulama için ham OCR metni (notlardan bağımsız). Verilmezse content kullanılır. */
  sourceContentForAudit?: string,
  documentType?: any,
): Promise<Array<{ front: string; back: string; difficulty: string }>> {
  const isGlossary = sectionTitle.toLocaleUpperCase("tr-TR").includes("KISALTMALAR") ||
    sectionTitle.toLocaleUpperCase("tr-TR").includes("SÖZLÜK") ||
    sectionTitle.toLocaleUpperCase("tr-TR").includes("TANIMLAR") ||
    sectionTitle.toLocaleUpperCase("tr-TR").includes("TERİMLER")

  // Chunking mantığı devreye giriyor!
  const chunkThreshold = 15000;
  const isChunked = content.length > chunkThreshold;
  const chunks = isChunked ? splitContentIntoChunks(content, chunkThreshold) : [content];

  console.log(`[FLASHCARD_GEN] Metin ${chunks.length} parçaya bölündü (Toplam Karakter: ${content.length})`);

  let allFlashcards: any[] = [];
  const auditSourceBase = (sourceContentForAudit || content).replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, "")
  const auditChunks = auditSourceBase.length > chunkThreshold
    ? splitContentIntoChunks(auditSourceBase, chunkThreshold)
    : [auditSourceBase]

  // Paralel işlem API'yi boğabilir, bu yüzden sıralı (sequential) gidiyoruz
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const chunkAuditSource = auditChunks[i] ?? auditSourceBase;
    console.log(`[FLASHCARD_GEN] Parça ${i + 1}/${chunks.length} işleniyor... (Karakter: ${chunkContent.length})`);

    const levelCardStyle: Record<string, string> = {
      beginner: `
        - Zorluk dağılımı: %30 kolay, %40 orta, %30 zor
        - Kolay kartlarda temel kavram tanımları sor
        - Orta kartlarda basit karşılaştırmalar yap
        - Zor kartlarda formül uygulamaları ve vaka soruları ekle
        - Cevaplarda günlük hayattan örnekler ver
      `,
      intermediate: `
        - Zorluk dağılımı: %30 kolay, %40 orta, %30 zor
        - Kolay kartlarda temel kavram tanımları sor
        - Orta kartlarda basit karşılaştırmalar yap
        - Zor kartlarda formül uygulamaları ve vaka soruları ekle
        - Cevaplarda günlük hayattan örnekler ver
      `,
      advanced: `
        - Zorluk dağılımı: %30 kolay, %40 orta, %30 zor
        - Kolay kartlarda temel kavram tanımları sor
        - Orta kartlarda basit karşılaştırmalar yap
        - Zor kartlarda formül uygulamaları ve vaka soruları ekle
        - Cevaplarda günlük hayattan örnekler ver
      `,
    }

    const instructionLimit = isGlossary
      ? `🚨 ÖZEL TALİMAT: Bu bölüm bir "${sectionTitle}" (Sözlük/Kısaltmalar) bölümüdür.\nBurada yer alan yüzlerce kısaltma/terim içinden SADECE ${courseName || "bu sınav"} müfredatında doğrudan sorulma potansiyeli yüksek olan, sektörel ve teknik öneme sahip kritik terimleri seç. "USB, SMS, PC" gibi aşırı basit terimleri KESİNLİKLE ATLA. Sadece 'Sınav Kalitesinde' olanları seç. Maksimum kart limiti yoktur.`
      : `DİNAMİK ÜRETİM (TAM KAPSAYICILIK): Bu metin ana "${sectionTitle}" bölümünün bir parçasıdır. Sayısal bir hedefin veya kısıtlaman YOKTUR. Tek görevin, bu metindeki sınavda sorulma ihtimali olan İSTİSNASIZ TÜM (100%) test edilebilir bilgileri (kavram, formül, yasal süre, kural) tüketmektir. Metin çok yoğunsa 20 tane kaliteli kart üretmekten çekinme. Ancak metin sadece yüzeysel bir girişten ibaretse, kotayı doldurmak için asla zorlama veya önemsiz detaylardan kart üretme. Sadece 'Sınav Kalitesinde' olanları seç.`

    const cardTypesInstruction = isGlossary
      ? `  KART TÜRLERİ VE ÖRNEKLER:
  1. **Kısaltma/Terim Kartı:** "X nedir / X'in açılımı nedir?" → Sadece kısaltmanın açılımı ve kısa resmi anlamı.`
      : `  KART TÜRLERİ VE ÖRNEKLER:
  1. **Temel Kavram kartı:** "X nedir?" → Resmi tanım + 💡 akılda kalıcı örnek
  2. **Kıyaslama kartı:** "X ile Y arasındaki fark nedir?" → İki kavramın farkları
  3. **Mevzuat kartı:** "X sürecinde yasal sınır/süre nedir?" → Süre veya oran
  4. **İstisna kartı:** "X'in istisnası nedir?" → İstisna kuralı + neden önemli
  5. **Vaka kartı:** "Şu durumda ne yapılır?" → Kısa senaryo + doğru uygulama
  6. **Doğru/Yanlış kartı:** "X doğru mudur?" → Doğru/Yanlış + açıklama
  7. **Sıralama kartı:** "X sürecinin adımları nelerdir?" → Adım adım sıralı cevap

  VARYASYON KURALI (ÇOK ÖNEMLİ):
  Aynı kavramı FARKLI açılardan soran birden fazla kart üret. Örneğin:
  - Kart 1: "X nedir?" (tanım — X kaynak metindeki kavram)
  - Kart 2: "X ile Y arasındaki fark nedir?" (karşılaştırma)
  - Kart 3: "Hangi durumda [kaynak metindeki süre/merci/belge] uygulanır?" (uygulama)`;

    const isProcedureOrMevzuat = documentType ? requiresHeadingPreservation(documentType) : false;

    const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
  ${getExamIntelligence(aiMode, courseName)}

  ${instructionLimit}
  SAYFA ARALIĞI: ${pageStart} ile ${pageEnd}. sayfalar arasındaki konu kapsamı.

  KART SEVİYESİ VE HEDEF KİTLE:
  ${levelCardStyle[userLevel] || ""}

${cardTypesInstruction}

  KURALLAR:
  - Soru kısa ve net olsun, resmi terimleri AYNEN kullan
  - 📐 CEVAP FORMATI (ÇOK KRİTİK — İÇ İÇE YAPI YASAK!):
    Cevabı DÜZ, KISA VE NET paragraflar halinde yaz. İç içe madde işaretleri (nested bullets/sub-lists), alt alt liste yapıları KESİNLİKLE KULLANMA! Bilgiyi düz paragraf veya tek seviye madde listesi (flat list) olarak ver.
    Format şöyle olsun:
    - İlk 1-2 paragraf: Resmi/teknik cevap (kaynak metindeki tanım + açıklama). Düz metin, madde işaretsiz.
    - 💡 Akılda Kalıcı Örnek: 1-2 cümlelik benzetme veya senaryo.
    ${isProcedureOrMevzuat ? '- 🪤 Tuzak: 1-2 cümlelik kritik bir prosedür/mevzuat uyarısı veya karıştırılabilecek ince detay.' : '- 🪤 Tuzak: 1-2 cümlelik sınav tuzağı uyarısı.'}
    Toplam cevap 6-10 satırı GEÇMESİN. Kısa, öz ve okunabilir olsun.
  - 🛡️ EKSİKSİZ TANIM: Eğer bir kurumun (örn: BDDK, SPK) tanımını veya görevlerini yazıyorsan, sadece adından yola çıkarak (sadece bankalar gibi) sığ bir tanım yapma. Kaynak metinde geçen TÜM görevlerini ve denetlediği TÜM şirket tiplerini (Faktoring, Leasing vb.) kapsayan eksiksiz bir açıklama yap.
  - 🪤 Tuzak Nedir?: ${isProcedureOrMevzuat ? 'Kritik bir yasal detay, ince bir ayrım veya prosedürde uygulamada çok sık karıştırılan çok benzer kavramlar ve süreler. ASLA sınav kelimesini kullanma!' : 'Öğrenciyi yanıltmak için şıklara konulabilecek çok benzer kavramlar, yanlış süreler (örn: 10 iş günü yerine 15 takvim günü) veya ezber yanılgıları. Her kartın arkasında bu uyarı KESİNLİKLE olmalıdır.'}
  - Özellikle rakam, süre, oran ve istisnaları soran kartlar bol olsun — ${isProcedureOrMevzuat ? 'uygulamada' : 'sınavda'} en çok bunlar sorulur
  - 🚫 KESİNLİKLE YASAK: "Kaynak metne göre", "Verilen metne göre", "Ders notlarında", "Metinde belirtilen", "Mevzuata göre" gibi meta-ifadeleri ASLA kullanma. Soruları doğrudan genel geçer akademik doğrular olarak sor.
  - **ASLA KENDİ KAFANDAN SINAV TAKTİĞİ VEYA YORUM UYDURMA!** "Sınavda doğrudan şu terimler sorulmaktadır", "Buraya çok dikkat edin", "Bu konu çok önemlidir" gibi HOCALIK TASLAYAN veya kaynak metinde (PDF'te) olmayan hiçbir yönlendirici/abartı cümleyi **ASLA KULLANMA.**
  - 🇹🇷 DİL KALİTESİ: Türkçe dil bilgisi, kelime dizilimi ve akıcılığa %100 uy.

  KAYNAK METİN PARÇASI: "${chunkContent.replace(/"/g, "'")}"

  Sadece JSON array döndür:
  [
    {"front": "soru", "back": "cevap (resmi tanım + 💡 örnek + 🪤 Tuzak: [tuzak uyarısı])", "difficulty": "easy|medium|hard"}
  ]
  `
    let raw = await callAI(prompt, 2, "flashcard_generation")

    let attempt = 1
    const maxAttempts = 3
    let chunkFlashcardsList: any[] = []
    let chunkAuditPassed = false

    while (attempt <= maxAttempts) {
      try {
        const parsed = extractCleanJson(raw)
        chunkFlashcardsList = Array.isArray(parsed) ? parsed : []
        console.log(`[FLASHCARD_DEBUG] Parça ${i + 1}: Parsed ${chunkFlashcardsList.length} flashcards (Attempt #${attempt})`)

        if (chunkFlashcardsList.length === 0) {
          throw new Error("Boş veya geçersiz JSON listesi.")
        }

        // Flashcard Müfettişi: KAYNAK (rawContent/OCR) ile karşılaştır
        console.log(`[FLASHCARD_AUDIT] Parça ${i + 1} Müfettiş derin flashcard denetimi başlatılıyor (kaynak metin)...`)
        const audit = await auditFlashcardsAgainstSource(chunkAuditSource, chunkFlashcardsList, sectionTitle, fileUri)

        if (audit.passed) {
          console.log(`[FLASHCARD_AUDIT] ✅ Parça ${i + 1} Müfettiş tüm flashcardları hatasız ve kusursuz onayladı!`)
          chunkAuditPassed = true
          break
        }

        console.warn(`[FLASHCARD_AUDIT] ⚠️ Parça ${i + 1} Müfettiş ${audit.issues.length} adet hata/halüsinasyon tespit etti!`)
        console.log(audit.issues.map(iss => `   - ${iss}`).join("\n"))

        if (attempt === maxAttempts) {
          // 🔒 Denetimsiz flashcard ASLA yayınlanmaz (soru Müfettişi ile aynı kilit)
          console.error(`[FLASHCARD_AUDIT] ⛔ Parça ${i + 1} ${maxAttempts} denemede de Müfettiş'i geçemedi! Bu parçanın kartları İPTAL EDİLDİ.`)
          chunkFlashcardsList = []
          break
        }

        // Onarım Promptunu hazırla
        console.log(`[FLASHCARD_AUDIT] 🔄 Parça ${i + 1} Flashcardlar Müfettiş bulguları doğrultusunda onarılıyor...`)
        const repairPrompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
  ${prompt}

  ⚠️⚠️⚠️ ÇOK ÖNEMLİ — ÖNCEKİ DENEMEDE TESPİT EDİLEN HATALAR:
  Yukarıda ürettiğin flashcardlarda Flashcard Müfettişi tarafından aşağıdaki kritik bilgi hataları veya yasal uyumsuzluklar tespit edildi. 
  Lütfen bu hataları KESİNLİKLE düzelt ve cevapları baştan yaz:
  - ${audit.issues.join("\n- ")}

  Tüm kurallara ve şablon formatına %100 uyarak flashcardları yeniden sıfırdan üret. Sadece JSON array döndür.
  `
        await new Promise(r => setTimeout(r, 4000)) // RPM limit nefes payı
        raw = await callAI(repairPrompt, 2, "flashcard_generation")
        attempt++
      } catch (e: any) {
        console.error(`[FLASHCARD_DEBUG] Parça ${i + 1} Flashcard ayrıştırma/doğrulama hatası (Attempt #${attempt}): ${e.message}`)
        if (attempt === maxAttempts) break
        await new Promise(r => setTimeout(r, 4000))
        raw = await callAI(prompt, 2, "flashcard_generation")
        attempt++
      }
    }

    // Chunk'tan gelen kartları SADECE Müfettiş onayı varsa ekle
    if (chunkAuditPassed && chunkFlashcardsList.length > 0) {
      allFlashcards = [...allFlashcards, ...chunkFlashcardsList]
    } else if (chunkFlashcardsList.length > 0) {
      console.warn(`[FLASHCARD_AUDIT] ⚠️ Parça ${i + 1}: ${chunkFlashcardsList.length} kart Müfettiş onayı alamadığı için havuza EKLENMEDİ.`)
    }

    // Rate limit koruması
    if (i < chunks.length - 1) {
      console.log(`[FLASHCARD_GEN] ⏱️ Key ve limit koruması: Diğer parçaya geçmeden önce 5 saniye bekleniyor...`)
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  // Karakter taşıması / UI bozma koruması (Back trim)
  for (const card of allFlashcards) {
    if (card.back && card.back.length > 800) {
      console.warn(`[FLASHCARD_TRIM] Çok uzun flashcard cevabı kesildi: ${card.back.substring(0, 50)}...`);
      card.back = card.back.substring(0, 797) + "...";
    }
  }

  return dedupFlashcards(allFlashcards)
}


// ==================== QUESTION GENERATION ====================

export async function generateQuestions(
  content: string,
  sectionTitle: string,
  courseName: string,
  userLevel: string = "beginner",
  aiMode: string = "general",
  fileUri?: string,
  pageStart?: number,
  pageEnd?: number,
  importance?: string,
  /** Kaynak doğrulama için ham OCR metni (notlardan bağımsız). Verilmezse content kullanılır. */
  sourceContentForAudit?: string,
  documentType?: any,
): Promise<Array<{ text: string; options: string[]; correct: string; explanation: string; difficulty: string }>> {
  // Chunking mantığı devreye giriyor!
  const chunkThreshold = 15000;
  const isChunked = content.length > chunkThreshold;
  const chunks = isChunked ? splitContentIntoChunks(content, chunkThreshold) : [content];

  console.log(`[QUESTION_GEN] Metin ${chunks.length} parçaya bölündü (Toplam Karakter: ${content.length})`);

  let allQuestions: any[] = [];
  const auditSourceBase = (sourceContentForAudit || content).replace(/^\[MARKDOWN_OCR_SUCCESS\]\s*/, "")
  const auditChunks = auditSourceBase.length > chunkThreshold
    ? splitContentIntoChunks(auditSourceBase, chunkThreshold)
    : [auditSourceBase]

  // Paralel işlem API'yi boğabilir, bu yüzden sıralı (sequential) gidiyoruz
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const chunkAuditSource = auditChunks[i] ?? auditSourceBase;
    console.log(`[QUESTION_GEN] Parça ${i + 1}/${chunks.length} işleniyor... (Karakter: ${chunkContent.length})`);

    const levelQuestionStyle: Record<string, string> = {
      beginner: `
        - Zorluk dağılımı: %30 kolay, %40 orta, %30 zor
        - Kolay sorularda bile çeldirici şıklar olsun
        - Orta sorularda vaka senaryoları kullan
        - Zor sorularda detaylı mevzuat referansları, formül ve vaka uygulamaları kullan
        - Açıklamalarda her yanlış şıkkın NEDEN yanlış olduğunu detaylı açıkla
      `,
      intermediate: `
        - Zorluk dağılımı: %30 kolay, %40 orta, %30 zor
        - Kolay sorularda bile çeldirici şıklar olsun
        - Orta sorularda vaka senaryoları kullan
        - Zor sorularda detaylı mevzuat referansları, formül ve vaka uygulamaları kullan
        - Açıklamalarda her yanlış şıkkın NEDEN yanlış olduğunu detaylı açıkla
      `,
      advanced: `
        - Zorluk dağılımı: %30 kolay, %40 orta, %30 zor
        - Kolay sorularda bile çeldirici şıklar olsun
        - Orta sorularda vaka senaryoları kullan
        - Zor sorularda detaylı mevzuat referansları, formül ve vaka uygulamaları kullan
        - Açıklamalarda her yanlış şıkkın NEDEN yanlış olduğunu detaylı açıkla
      `,
    }

    const isProcedureOrMevzuat = documentType ? requiresHeadingPreservation(documentType) : false;

    const { inventory: qInventory } = extractExamInventory(chunkContent)
    const inventoryQuestionsInstruction = qInventory.length > 0
      ? `\n🎯 ZORUNLU SINAV ENVANTERİ (Bu maddelerin TAMAMINI SINA):\n` +
        qInventory.map((it, idx) => `${idx + 1}. [${it.cat}] ${it.text}`).join("\n") +
        `\n⚠️ KURAL: Üreteceğin sorular doğrudan yukarıdaki envanter maddelerinde yer alan tanımları, süreleri, cezaları ve istisnaları hedeflemelidir.\n`
      : ""

    const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
${getExamIntelligence(aiMode, courseName)}
${inventoryQuestionsInstruction}

DERS: ${courseName}
BÖLÜM: "${sectionTitle}"
SAYFA ARALIĞI: ${pageStart} ile ${pageEnd}. sayfalar arasındaki konu kapsamı.

SEVİYE TALİMATLARI: 
${levelQuestionStyle[userLevel] || levelQuestionStyle.beginner}

SORU KURALLARI:
- 🚫 KESİNLİKLE YASAK: Belgenin yapısı, başlık numaraları veya içindekiler tablosuyla ilgili soru SORMA. Sadece gerçek finansal, teknik ve mevzuat bilgisini ölç.
- 🚨 ÖLÜMCÜL HATA VE KESİN İPTAL SEBEBİ: Sorularda, şıklarda ve açıklamalarda "Kaynak metne göre", "Yukarıdaki bilgilere göre", "Ders notlarında", "Metinde belirtilen" GİBİ İFADELER ASLA VE ASLA KULLANILAMAZ! Soruyu sanki tek başına, bağımsız, profesyonel bir kurum sınav sorusuymuş gibi doğrudan sor. Hiçbir şekilde öğrenciye "bu sorunun kaynağı bir metin/PDF" hissi YARATILMAYACAK.
- **ASLA KENDİ KAFANDAN ${isProcedureOrMevzuat ? 'YORUM' : 'SINAV TAKTİĞİ VEYA YORUM'} UYDURMA!** "Sınavda doğrudan şu terimler sorulmaktadır", "Buraya çok dikkat edin", "Bu konu çok önemlidir" gibi HOCALIK TASLAYAN veya kaynak metinde (PDF'te) olmayan hiçbir yönlendirici/abartı cümleyi **ASLA KULLANMA.**
- Doğru cevap şık harfi olsun (A, B, C, D veya E)
- Resmi terimleri AYNEN kullan (pay, tahvil, izahname vb.)
- Çeldirici şıklar gerçekçi olsun ve birbirine çok benzesin
- Metinde formül/rakam/oran varsa EN AZ 2-3 adet SAYISAL/HESAPLAMA sorusu ekle
- Metinde tarih/süre/limit varsa bunlarla ilgili soru sor
- 🇹🇷 DİL KALİTESİ: Türkçe dil bilgisi, kelime dizilimi ve akıcılığa %100 uy. İngilizce'den doğrudan çevrilmiş gibi duran yapay veya ters yapılar ("Özeti [Konu]", "Sözlüğü [Konu]", "Notları [Konu]") KESİNLİKLE kullanma. Her zaman doğal ve düzgün bir Türkçe ile akıcı cümleler kur.

DİNAMİK ÜRETİM (TAM KAPSAYICILIK): Bu metin ana "${sectionTitle}" bölümünün bir parçasıdır. Sayısal bir hedefin veya kısıtlaman YOKTUR. Tek görevin, bu metindeki sınavda çıkabilecek kalitedeki İSTİSNASIZ TÜM (100%) test edilebilir bilgileri (kavram, formül, yasal süre, istisna, kural) kapsayacak kadar ${isProcedureOrMevzuat ? 'değerlendirme' : 'sınav'} sorusu üretmektir. Metin çok yoğunsa 15 soru üretmekten çekinme. Ancak metin sadece yüzeysel bir girişten ibaretse, kotayı doldurmak için asla önemsiz detaylardan veya zorlama kurgulardan soru üretme.

SORU TİPLERİ VE DAĞILIMI:
Ürettiğin soruların en az %40'ı "ÖNCÜLLÜ (I, II, III)" formatında OLMALIDIR. Bu kesin bir kuraldır.
1. Öncüllü Soru (ZORUNLU - %40): 
   I. [Birinci ifade]
   II. [İkinci ifade]
   III. [Üçüncü ifade]
   Soru Kökü: Yukarıdakilerden hangisi/hangileri doğrudur? (Şıklar: A) Yalnız I, B) Yalnız II, C) I ve II, D) I ve III, E) I, II ve III)
2. Kurumsal Vaka Tabanlı: ŞAHIS İSİMLERİ (Ahmet, Mehmet, Ayşe vb.) KESİNLİKLE YASAKTIR! Vaka senaryoları "${courseName}" dersinin kapsamında olmalı; tüzel kişiler veya genel unvanlar kullan (ör. "X İhracat AŞ", "Kurumun Mevzuat Uzmanı", "Veri Sorumlusu").
3. Ters Köşe Soru: "Aşağıdakilerden hangisi YANLIŞTIR / DEĞİLDİR / İSTİSNADIR?"
4. Kavramsal Çeldirici: Şıkların birbirine %90 benzediği, ince detayları ölçen doğrudan bilgi sorusu.
5. Hesaplama/Süre: Metinde rakam, gün, süre veya oran varsa KESİNLİKLE bunları ölç.

VARYASYON KURALI (ÇOK ÖNEMLİ):
Aynı konuyu FARKLI açılardan test eden sorular üret. Örneğin:
- Soru 1: Tanım sorusu
- Soru 2: Hesaplama/Uygulama sorusu
- Soru 3: İstisna/Özel durum sorusu
- Soru 4: "Aşağıdakilerden hangisi X hakkında YANLIŞTIR?" (ters soru)
Böylece aynı bilgi 4 farklı şekilde test edilir ve kullanıcı "aynı soru" görmez.

⚠️⚠️⚠️ AÇIKLAMA FORMATI — KIRMIZI ÇİZGİ — ASLA ATLANMAYACAK:
Her sorunun explanation alanında TÜM ŞIKLARI TEK TEK açıklayacaksın. 
ASLA sadece "Doğru cevap A'dır" deyip geçme. HER YANLIŞ ŞIKKIN neden yanlış olduğunu açıkla.

ZORUNLU FORMAT (bu formata %100 uy):
"✅ Doğru cevap [harf]'dir: [Neden doğru olduğunun detaylı açıklaması. KESİNLİKLE "Mevzuatın X. sayfasında", "Metinde", "Kaynakta" GİBİ İFADELER KULLANMA! Bilgiyi doğrudan, kendinden emin bir şekilde ver — en az 2-3 cümle].

❌ [B şıkkının tam metni]) Yanlış çünkü: [somut, spesifik neden — neden bu şık çeldirici, gerçekte ne doğru]
❌ [C şıkkının tam metni]) Yanlış çünkü: [somut, spesifik neden]  
❌ [D şıkkının tam metni]) Yanlış çünkü: [somut, spesifik neden]
❌ [E şıkkının tam metni]) Yanlış çünkü: [somut, spesifik neden]\n
${isProcedureOrMevzuat ? '💡 Kritik Detay: [Bu soruyla ilgili prosedürde dikkat edilmesi gereken önemli bir nokta veya risk uyarısı]' : '💡 Sınav İpucu: [Bu soruyla ilgili karıştırılabilecek önemli bir nokta veya ezber tekniği]'}
"

⛔ YAPMA: Sadece "Doğru cevap A çünkü..." yazıp B, C, D, E'yi açıklamamak KABUL EDİLMEZ.
⛔ YAPMA: "Mevzuatta/Metinde/Kaynakta şöyle denmektedir:" gibi atıflar KESİNLİKLE KABUL EDİLMEZ. Doğrudan bilgiyi ver.
⛔ YAPMA: Tek kelimelik açıklamalar ("Yanlış", "Geçersiz") KABUL EDİLMEZ. Her şık için en az 1-2 cümle yaz.
✅ YAP: Açıklamalar net ve doyurucu (ortalama 30-50 kelime) olsun. Öğrenci her şıkkı okuyunca "neden yanlış" diye öğrensin ama gereksiz laf kalabalığı YAPMA.

KAYNAK METİN PARÇASI: "${chunkContent.replace(/"/g, "'")}"

Sadece JSON array döndür:
[
  {
    "text": "soru metni",
    "options": ["A) seçenek", "B) seçenek", "C) seçenek", "D) seçenek", "E) seçenek"],
    "correct": "A",
    "explanation": "✅ Doğru cevap A'dır: [detaylı açıklama].\\n\\n❌ B) Yanlış çünkü: [neden]\\n❌ C) Yanlış çünkü: [neden]\\n❌ D) Yanlış çünkü: [neden]\\n❌ E) Yanlış çünkü: [neden]\\n\\n💡 Sınav İpucu: [ipucu]",
    "difficulty": "easy|medium|hard"
  }
]
`

    let raw = await callAI(prompt, 2, "question_generation")

    let attempt = 1
    const maxAttempts = 3
    let chunkQuestionsList: any[] = []
    let chunkAuditPassed = false

    while (attempt <= maxAttempts) {
      try {
        const parsed = extractCleanJson(raw)
        chunkQuestionsList = Array.isArray(parsed) ? parsed : []
        console.log(`[QUESTION_DEBUG] Parça ${i + 1}: Parsed ${chunkQuestionsList.length} questions (Attempt #${attempt})`)

        if (chunkQuestionsList.length === 0) {
          throw new Error("Boş veya geçersiz JSON listesi.")
        }

        // Soru Müfettişi: KAYNAK (rawContent/OCR) ile karşılaştır
        console.log(`[QUESTION_AUDIT] Parça ${i + 1} Müfettiş derin soru denetimi başlatılıyor (kaynak metin)...`)
        const audit = await auditQuestionsAgainstSource(chunkAuditSource, chunkQuestionsList, sectionTitle, fileUri)

        if (audit.passed) {
          console.log(`[QUESTION_AUDIT] ✅ Parça ${i + 1} Müfettiş tüm soruları hatasız ve kusursuz onayladı!`)
          chunkAuditPassed = true
          break
        }

        console.warn(`[QUESTION_AUDIT] ⚠️ Parça ${i + 1} Müfettiş ${audit.issues.length} adet hata/halüsinasyon tespit etti!`)
        if (audit.issues.length > 0) {
          console.log(audit.issues.map(iss => `   - ${iss}`).join("\n"))
        }

        if (attempt === maxAttempts) {
          // 🔒 MADDE 7 KİLİDİ: Müfettiş denetimini geçemeyen sorular ASLA havuza eklenmez.
          // Denetimsiz/hatalı soru yayınlamaktansa o parçanın sorularını tamamen atıyoruz.
          console.error(`[QUESTION_AUDIT] ⛔ Parça ${i + 1} ${maxAttempts} denemede de Müfettiş'i geçemedi! Bu parçanın soruları İPTAL EDİLDİ (denetimsiz soru yayınlanmaz).`)
          chunkQuestionsList = []
          break
        }

        // Onarım Promptunu hazırla
        console.log(`[QUESTION_AUDIT] 🔄 Parça ${i + 1} Sorular Müfettiş bulguları doğrultusunda yeniden onarılıyor...`)
        const repairIssues = [...audit.issues]
        if (audit.missingTopics && audit.missingTopics.length > 0) {
          repairIssues.push(...audit.missingTopics.map(t => `Eksik Konu: "${t}" hakkında kesinlikle soru sorulmalı ve test edilmelidir.`))
        }

        const repairPrompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
${prompt}

⚠️⚠️⚠️ ÇOK ÖNEMLİ — ÖNCEKİ DENEMEDE TESPİT EDİLEN HATALAR VEYA EKSİKLİKLER:
Yukarıda ürettiğin sorularda Soru Müfettişi tarafından aşağıdaki kritik bilgi hataları, uydurmalar veya eksiklikler tespit edildi. 
Lütfen bu hataları KESİNLİKLE düzelt, çelişkileri gider ve açıklamaları her şık için en az 1-2 cümle olacak şekilde baştan yaz:
- ${repairIssues.join("\n- ")}

Tüm kurallara ve şablon formatına %100 uyarak soruları yeniden sıfırdan üret. Sadece JSON array döndür.
`
        await new Promise(r => setTimeout(r, 4000)) // RPM limit nefes payı
        raw = await callAI(repairPrompt, 2, "question_generation")
        attempt++
      } catch (e: any) {
        console.error(`[QUESTION_DEBUG] Parça ${i + 1} Soru ayrıştırma/doğrulama hatası (Attempt #${attempt}): ${e.message}`)
        if (attempt === maxAttempts) break
        await new Promise(r => setTimeout(r, 4000))
        raw = await callAI(prompt, 2, "question_generation")
        attempt++
      }
    }

    // Chunk'tan gelen soruları ana listeye SADECE Müfettiş onayı varsa ekle (Madde 7 kilidi)
    if (chunkAuditPassed && chunkQuestionsList.length > 0) {
      allQuestions = [...allQuestions, ...chunkQuestionsList]
    } else if (chunkQuestionsList.length > 0) {
      console.warn(`[QUESTION_AUDIT] ⚠️ Parça ${i + 1}: ${chunkQuestionsList.length} soru Müfettiş onayı alamadığı için havuza EKLENMEDİ.`)
    }

    // Rate limit koruması
    if (i < chunks.length - 1) {
      console.log(`[QUESTION_GEN] ⏱️ Key ve limit koruması: Diğer parçaya geçmeden önce 5 saniye bekleniyor...`)
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  // ==================== YEDEK GÜÇ (BACKUP POWER) BUFFER ====================
  // Eğer tüm denemeler bittiğinde hala test edilmemiş önemli konular varsa,
  // maks 5 adet hedeflenmiş Yedek Güç sorusu üretip doğrudan veritabanına eklenmek üzere listeye iliştiriyoruz.
  try {
    const finalAudit = await auditQuestionsAgainstSource(content, allQuestions, sectionTitle, fileUri)
    if (finalAudit.missingTopics && finalAudit.missingTopics.length > 0) {
      const backupCount = Math.min(5, finalAudit.missingTopics.length)
      console.log(`[YEDEK_GÜÇ] ⚡ Yedek güç devreye giriyor! Test edilmeden geçilen ${backupCount} eksik konu için hedeflenmiş yedek sorular üretiliyor...`)

      const backupPrompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
${getExamIntelligence(aiMode, courseName)}

DERS: ${courseName}
BÖLÜM: "${sectionTitle}"

Aşağıdaki eksik konuları test etmek için TAM olarak ${backupCount} adet akademik kalitede, çoktan seçmeli soru oluştur.
EKSİK KONULAR:
${finalAudit.missingTopics.slice(0, backupCount).map((t, idx) => `${idx + 1}. ${t}`).join("\n")}

SORU TİPLERİ VE BİLGİ DOĞRULUĞU KURALLARINA TAVİZSİZ UYUN.
Her şıkkın neden yanlış olduğunu ve neden doğru olduğunu tek tek ve detaylı açıklayın.

KAYNAK METİN: "${content.replace(/"/g, "'")}"

Sadece JSON array döndür:
[
  {
    "text": "Soru metni?",
    "options": ["A) seçenek", "B) seçenek", "C) seçenek", "D) seçenek", "E) seçenek"],
    "correct": "A",
    "explanation": "✅ Doğru cevap A'dır: [açıklama].\\n\\n❌ B) Yanlış çünkü: [neden]\\n❌ C) Yanlış çünkü: [neden]\\n❌ D) Yanlış çünkü: [neden]\\n❌ E) Yanlış çünkü: [neden]",
    "difficulty": "medium"
  }
]
`
      await new Promise(r => setTimeout(r, 4000))
      const backupRaw = await callAI(backupPrompt, 1, "question_generation")
      const backupQuestions = extractCleanJson(backupRaw)
      if (Array.isArray(backupQuestions) && backupQuestions.length > 0) {
        const trimmedBackup = backupQuestions.slice(0, 5)
        // 🔒 MADDE 7 KİLİDİ: Yedek güç soruları da Müfettiş denetiminden geçmeden havuza giremez.
        await new Promise(r => setTimeout(r, 4000))
        const backupAudit = await auditQuestionsAgainstSource(content, trimmedBackup, sectionTitle, fileUri)
        if (backupAudit.passed) {
          console.log(`[YEDEK_GÜÇ] ✅ ${trimmedBackup.length} yedek güç sorusu üretildi ve Müfettiş onayından geçti.`)
          allQuestions = [...allQuestions, ...trimmedBackup]
        } else {
          console.warn(`[YEDEK_GÜÇ] ⚠️ Yedek güç soruları Müfettiş onayı alamadı, havuza EKLENMEDİ.`)
        }
      }
    }
  } catch (backupErr: any) {
    console.error(`[YEDEK_GÜÇ] ❌ Yedek güç soru üretimi sırasında hata oluştu:`, backupErr.message)
  }

  // ⚠️ SORU DOĞRU CEVAP ÇAPRAZ KONTROL (Cross-Check)
  let crossCheckFixed = 0
  for (const q of allQuestions) {
    if (!q.explanation || !q.correct) continue

    const explanationMatch = q.explanation.match(/(?:doğru\s+cevap|✅)\s*([A-E])[):\s]/i)
    if (explanationMatch) {
      const explainedCorrect = explanationMatch[1].toUpperCase()
      const declaredCorrect = q.correct.toUpperCase()

      if (explainedCorrect !== declaredCorrect) {
        console.warn(`[CROSS_CHECK] ⚠️ Tutarsız cevap! Soru: "${q.text.substring(0, 50)}..." → correct="${declaredCorrect}" ama açıklama "${explainedCorrect}" diyor. Açıklamaya göre düzeltiliyor.`)
        q.correct = explainedCorrect
        crossCheckFixed++
      }
    }

    // 5 ŞIK KURALI (Normalizasyon)
    if (q.options && Array.isArray(q.options)) {
      while (q.options.length < 5) {
        q.options.push(`E) Diğer (Belirtilmemiş)`);
      }
      if (q.options.length > 5) {
        q.options = q.options.slice(0, 5);
      }

      const prefixes = ["A) ", "B) ", "C) ", "D) ", "E) "];
      q.options = q.options.map((opt: string, i: number) => {
        let clean = opt.replace(/^[A-Ea-e][):.]\s*/, '').trim();
        return `${prefixes[i]}${clean}`;
      });
    }
  }
  if (crossCheckFixed > 0) {
    console.log(`[CROSS_CHECK] 🔧 ${crossCheckFixed} soruda doğru cevap tutarsızlığı düzeltildi.`)
  }

  // A ŞIKKI KONTROLÜ (Hepsi A ise uyar/karıştır)
  const answerCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const q of allQuestions) {
    if (q.correct && answerCounts[q.correct] !== undefined) {
      answerCounts[q.correct]++;
    }
  }

  if (allQuestions.length > 0) {
    const aRatio = answerCounts["A"] / allQuestions.length;
    if (aRatio > 0.4 && allQuestions.length > 3) {
      console.warn(`[QUESTION_SHUFFLE] ⚠️ Cevapların %${(aRatio * 100).toFixed(0)}'si A şıkkı! Şıklar otomatik karıştırılıyor...`);
      for (const q of allQuestions) {
        if (!q.options || q.options.length < 5 || !q.correct) continue;
        const correctIdx = q.correct.charCodeAt(0) - 65;
        const correctOptionText = q.options[correctIdx];
        // Fisher-Yates shuffle
        for (let i = q.options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
        }
        const newIdx = q.options.findIndex((o: string) => o === correctOptionText);
        if (newIdx !== -1) q.correct = String.fromCharCode(65 + newIdx);
        const prefixes = ["A) ", "B) ", "C) ", "D) ", "E) "];
        q.options = q.options.map((opt: string, i: number) => {
          const clean = opt.replace(/^[A-Ea-e][):.]\s*/, '').trim();
          return `${prefixes[i]}${clean}`;
        });
        
        // Temizlik: Şıklar karıştırıldığı için eski açıklamadaki A,B,C harflerini kırpıyoruz
        if (q.explanation) {
          q.explanation = q.explanation
            .replace(/^(Doğru )?cevap\s+[A-Ea-e]\s*(şıkkı(dır)?)?[\s\.\:\,\-]*/i, '')
            .replace(/^[A-Ea-e][\)\.\:\-]\s*(Doğru )?cevap\s*(olduğu için|olduğundan)?[\s\.\:\,\-]*/i, '')
            .replace(/^[A-Ea-e]\s*şıkkı\s*(doğrudur|yanlıştır)?[\s\.\:\,\-]*çünkü\s*/i, '')
            .replace(/^[A-Ea-e][\)\.\:\-]\s*/i, '');
          
          if (!q.explanation.toLowerCase().startsWith("açıklama") && !q.explanation.toLowerCase().startsWith("doğru")) {
             q.explanation = "Açıklama: " + q.explanation;
          }
        }
      }
      console.log(`[QUESTION_SHUFFLE] 🔀 ${allQuestions.length} sorunun şıkları otomatik karıştırıldı.`);
    }
  }

  return dedupQuestions(allQuestions)
}


export function normalizeForComparison(str: string): string {
  return str
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9ıışğüçöâîû]/g, "");
}

// ==================== GROUND TRUTH TEST ====================

async function runGroundTruthTest(
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string = ""
): Promise<{ passed: boolean; failedQuestions: string[]; totalQuestions: number; askedQuestions: string[] }> {
  console.log(`[GROUND_TRUTH] 🕵️‍♂️ "${sectionTitle}" için Ground Truth Testi Başlatılıyor...`);

  const charCount = sourceContent.length;
  // Metnin uzunluğuna göre dinamik soru sayısı (Her ~400 karaktere 1 soru, Min: 5, Max: 35)
  let questionCount = Math.round(charCount / 400);
  if (questionCount < 5) questionCount = 5;
  if (questionCount > 35) questionCount = 35;
  // Adım 1: Kaynaktan dinamik sayıda zor soru üret
  const qPrompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen acımasız bir müfettişsin.
BÖLÜM: "${sectionTitle}"
KAYNAK METİN:
${sourceContent}

GÖREV: SADECE bu kaynak metne bakarak kontrol sorusu çıkar. Toplam ${questionCount} adet soru üret.
DİKKAT: KAYNAK METİNDE AÇIKÇA CEVABI YAZMAYAN HİÇBİR ŞEYİ SORMA. Dışarıdan kendi felsefi/teknik ön bilgini (knowledge bleed) KESİNLİKLE kullanma. Sorular sadece ve sadece metinde geçen somut verilerin, tanımların ve bilgilerin doğrudan karşılığı olmalıdır. Metinde olmayan bir çıkarımı veya arka plan bilgisini sormak KESİNLİKLE YASAKTIR.
Sorular kısa ve doğrudan bilgiyi arayan tarzda olmalı.

Sadece şu formatta JSON döndür:
["soru 1", "soru 2", ...]
  `;

  let questions: string[] = [];
  try {
    const qRaw = await callAI(qPrompt, 1, "ground_truth");
    questions = extractCleanJson(qRaw) as string[];
  } catch {
    console.log(`[GROUND_TRUTH] ⚠️ Soru üretilemedi — test başarısız sayılıyor (içerik onaylanmadı).`);
    return { passed: false, failedQuestions: ["Ground Truth: soru üretimi API hatası"], totalQuestions: 0, askedQuestions: [] };
  }

  if (!questions || questions.length === 0) {
    return { passed: false, failedQuestions: ["Ground Truth: kaynaktan kontrol sorusu çıkarılamadı"], totalQuestions: 0, askedQuestions: [] };
  }
  console.log(`[GROUND_TRUTH] 🎯 Üretilen kontrol sorusu sayısı: ${questions.length}`);

  // Adım 2: Soruları sadece notlara bakarak cevapla
  const aPrompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen bir kalite kontrolörüsün.
BÖLÜM: "${sectionTitle}"
ÜRETİLEN DERS NOTU:
${generatedNotes}

KONTROL SORULARI:
${JSON.stringify(questions)}

GÖREV: Yukarıdaki soruları SADECE ve SADECE "ÜRETİLEN DERS NOTU"na bakarak cevapla. Kendi bilgini KESİNLİKLE kullanma!
Eğer bir sorunun cevabı notta EKSİKSE, YANLIŞSA veya HİÇ YOKSA o soruyu "foundInNotes": false olarak işaretle.
⚠️ KANIT ZORUNLULUĞU (KOPYA ÇEKMEYİ ÖNLER): Bir soruyu "foundInNotes": true işaretleyebilmen için, cevabı içeren cümleyi NOTTAN BİREBİR (kelimesi kelimesine) "evidenceQuote" alanına kopyalamak ZORUNLUDUR. Notta birebir böyle bir cümle/veri YOKSA — kendi genel bilginden "muhtemelen doğrudur" DEME — "foundInNotes": false işaretle ve evidenceQuote'u boş bırak.
⚠️ KANIT KAYNAĞI KISITI: evidenceQuote'u "💡 Somut Benzetme:" ile başlayan bölümlerden ALMA. Sınav soruları resmi/teknik ifadeleri test etmeli, kurgusal senaryonun anlatım cümlelerini değil. Kanıt tabloda, listede veya ana (benzetme dışı) metinde bulunmalıdır.

Sadece şu formatta JSON döndür:
{
  "results": [
    {
      "question": "soru",
      "foundInNotes": true,
      "evidenceQuote": "Nottan birebir kopyalanan, cevabı içeren cümle (false ise boş bırak)",
      "reason": "neden bulunduğu veya bulunamadığı"
    }
  ]
}
  `;

  try {
    const aRaw = await callAI(aPrompt, 1, "ground_truth");
    const results = extractCleanJson(aRaw) as any;
    // KANIT DENETİMİ: "foundInNotes: true" demek yetmez — nottan birebir kanıt cümlesi (evidenceQuote)
    // göstermek ZORUNLU. Kanıt yoksa (model önbilgiyle "var" demiş olabilir) soru BAŞARISIZ sayılır.
    const normalizedNotes = normalizeForComparison(generatedNotes);
    const failed = (results.results || []).filter((r: any) => {
      if (r.foundInNotes !== true && r.foundInNotes !== "true") return true;
      const quote = (r.evidenceQuote || "").toString().trim();
      if (quote.length < 15) return true; // kanıt cümlesi yok/yetersiz → kopya çekmiş say, başarısız

      const normalizedQuote = normalizeForComparison(quote);
      if (!normalizedNotes.includes(normalizedQuote)) {
        console.log(`[GROUND_TRUTH] ⚠️ Kanıt eşleşmedi (Notta bulunamadı):\nQuote: "${quote}"\nNormalized Quote: "${normalizedQuote}"`);
        return true;
      }
      return false;
    }).map((r: any) => r.question);

    if (failed.length > 0) {
      console.log(`[GROUND_TRUTH] ❌ BAŞARISIZ: ${failed.length} sorunun cevabı notlarda yok!`);
    } else {
      console.log(`[GROUND_TRUTH] ✅ BAŞARILI: Notlar tüm soruları cevaplayabildi.`);
    }

    return { passed: failed.length === 0, failedQuestions: failed, totalQuestions: questions.length, askedQuestions: questions };
  } catch {
    console.log(`[GROUND_TRUTH] ⚠️ Cevaplar analiz edilemedi — test başarısız sayılıyor.`);
    return { passed: false, failedQuestions: ["Ground Truth: cevap analizi API hatası"], totalQuestions: questions.length || 0, askedQuestions: questions };
  }
}

// ==================== AI KONTROLÖR (NOTES CROSS-CHECK) ====================


export async function verifyNotesAgainstSource(
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string,
  sourceMode: "strict" | "enriched" = "strict",
  documentType?: DocumentType,
  attemptNumber: number = 1,
  sectionConfidence?: string,
): Promise<{ score: number; missingTopics: string[]; issues: string[]; suggestions: string[]; groundTruthQuestions?: string[]; groundTruthBypassedAfterRetry?: boolean }> {
  const isGlossary = isGlossarySectionTitle(sectionTitle)
  const glossaryPromptBlock = isGlossary ? `
  ⚠️⚠️⚠️ SÖZLÜK / KISALTMALAR BÖLÜMÜ ÖZEL KURALI (BU BÖLÜM BİR SÖZLÜKTÜR):
  - Bu bölümün en sonunda "Bölüm Özeti", "Ekstra Dikkat Edilmesi Gereken Hususlar" veya "🧪 Kendini Test Et" gibi pedagojik kısımların **KESİNLİKLE OLMAMASI** gerekir. Bu kısımların notta bulunmaması bir HATA VEYA EKSİKLİK DEĞİLDİR, aksine kural gereği bulunmamaları zorunludur!
  - "🧪 Kendini Test Et" veya "Bölüm Özeti" kısımlarının eksik olduğunu KESİNLİKLE missingTopics veya issues alanına yazma, puan kırma!
  - Bu bölümü sadece ve sadece kaynaktaki kısaltmaların ve tanımların tamamının eksiksiz ve doğru bir şekilde, anlaşılır tablolar/maddeler halinde notta listelenip listelenmediğine göre değerlendir.
  ` : `
  - Eğer ders notu yeterince uzunsa (>500 kelime/word) ve en altında "🧪 Kendini Test Et" adında mini test soruları içeren bir bölüm yoksa, "missingTopics" kısmına "🧪 Kendini Test Et sorusu eksik" yaz ve pedagojik skordan 5 puan kır. Bölüm çok kısaysa (tanım listesi, kısa maddeler vb.) bu kontrolü atla.
  `
  const glossaryScoreBlock = isGlossary ? `
  (⚠️ ÖNEMLİ İSTİSNA: Eğer mevcut bölüm bir "Kısaltmalar", "Tanımlar" veya "Sözlük" bölümü ise bu kısımların ("Bölüm Özeti", "Ekstra Dikkat Edilmesi Gereken Hususlar" vb.) notta KESİNLİKLE bulunmaması gerekir. Bu tür sözlük bölümlerini sadece kısaltmalar/tanımlar listesinin/tablosunun tamlığına ve okunabilirliğine göre değerlendirip yüksek puan ver.)
  ` : ""
  const preserveHeadings = documentType ? requiresHeadingPreservation(documentType) : false
  const headingVerificationBlock = preserveHeadings ? `
🚨 BAŞLIK SADAKATİ DENETİMİ (MEVZUAT/PROSEDÜR — ZORUNLU):
Kaynak metindeki numaralı ana bölüm başlıklarını (örn: "1. AMAÇ VE KAPSAM", "2. DAYANAK", "3. TANIMLAR") tek tek tespit et.
Her birinin ders notunda ## başlık olarak AYNI sıra ve AYNI metinle (numara dahil) geçip geçmediğini kontrol et.
- Eksik ana başlık → "missingTopics"e yaz (örn: "Kaynak başlık eksik: 2. DAYANAK"), her eksik başlık için -15 PUAN.
- Birleştirilmiş veya yeniden adlandırılmış başlık (örn: kaynakta "1. AMAÇ VE KAPSAM" varken notta "Genel Bilgiler") → "issues"a yaz, -15 PUAN.
- Başlık sırası kaynakla uyumsuzsa → "issues"a yaz, -10 PUAN.
- İçeriğin farklı sırayla organize edilmesi bu belge türünde KABUL EDİLMEZ — yapı sadakati önceliklidir.
` : ""
  const sourceModeBlock = sourceMode === "enriched"
    ? `🎓 ZENGİNLEŞTİRİLMİŞ KAYNAK MODU (SMMM):
- Hikaye, benzetme, analoji, 💡 örnekler ve pedagojik senaryolar BEKLENEN içeriktir — bunları "[UYDURMA]" sayma.
- Sadece rakam, süre, oran, ceza, kanun/madde, kurum adı gibi OLGUSAL/SAYISAL/HUKUKİ iddiaları kaynakla doğrula.
`
    : `🔒 STRICT KAYNAK MODU (SPL / CIA / CISA / MASAK):
- PDF kaynağı dışı olgusal/sayısal/hukuki iddia KABUL EDİLMEZ.
- Pedagojik zenginleştirme sınırlı olmalı; kaynakta olmayan somut iddia uydurma sayılır.
`

  const lowConfidenceBlock = sectionConfidence === "low" ? `
⚠️ GÜVEN SKORU DÜŞÜK SINIR BİLGİSİ:
- Bu bölümün kaynak sınırı düşük güvenilirliklidir.
- Sınır bölgesindeki olası küçük sızıntıları (örneğin önceki/sonraki konulardan sızan 1-2 cümle) kritik hata veya çelişki olarak değerlendirme, puan kırma.
  ` : ""

  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
Sen bir sınav materyali KALİTE KONTROLÖRÜSÜN (Kontrolör). Görevin, üretilen ders notlarını yasal kaynak dökümanla karşılaştırıp yasal süreler, cezalar, limitler ve kritik mevzuat kavramları bazında hiçbir eksiğin kalmadığını doğrulamaktır.

${lowConfidenceBlock}

${sourceModeBlock}

📄 Sana verilen metni ASIL KAYNAK olarak kullan.

BÖLÜM: "${sectionTitle}"

KAYNAK METİN:
${sourceContent.replace(/"/g, "'")}

ÜRETİLEN DERS NOTU:
${generatedNotes.replace(/"/g, "'")}

🎯 DEĞERLENDİRME KRİTERLERİ:

⚠️⚠️⚠️ BENZETME İSTİSNASI (ÇOK KRİTİK):
Ders notları içinde "💡 Somut Benzetme:" başlığıyla yer alan ve soyut kavramları açıklamak için tasarlanmış olan kurgusal senaryoları/karakterleri (örn. Ahmet, Mehmet, Zeliha Ltd vb.) KESİNLİKLE "kaynak dışı uydurma/halüsinasyon" (issues) olarak işaretleme, bunlardan dolayı puan kırma. Ancak bu senaryolar içindeki yasal süre ve limitlerin doğruluğunu kesin olarak denetle (kurgusal süre sınırları uydurulmuşsa issues'a ekle).

⚠️⚠️⚠️ DÜŞÜK İÇERİK TESPİTİ (ÖNCELİKLİ KURAL — İLK BUNU KONTROL ET!):
Değerlendirmeye başlamadan ÖNCE kaynak metni analiz et ve aşağıdaki durumlardan biri geçerliyse İÇERİK YOĞUNLUĞUNU "DÜŞÜK" olarak işaretle:
- Kaynak metin sadece bir İÇİNDEKİLER (Table of Contents) sayfası veya sayfa numarası listesiyse
- Kaynak metin sadece bir ÖNSÖZ, GİRİŞ veya SUNUŞ yazısı olup somut ders kavramı, tanım, formül, süre, rakam İÇERMİYORSA
- Kaynak metin sadece bir KAYNAKÇA / REFERANSLAR listesiyse
- Kaynak metin yalnızca alt başlık isimleri/numaraları içerip bu başlıkların altlarında açıklayıcı paragraflar, tanımlar veya detaylar BULUNMUYORSA

Eğer içerik yoğunluğu DÜŞÜK ise:
→ Başlık adlarının ders notunda detaylı açıklanmamış olmasını KESİNLİKLE missingTopics veya issues olarak YAZMA.
→ Kaynak metinde detayı/açıklaması olmayan bir başlığın notta da detaysız olması DOĞAL ve BEKLENEN bir durumdur.
→ Bu tür düşük içerikli bölümlerde, kaynaktaki bilgiler nota eksiksiz ve doğru aktarılmışsa KESİNLİKLE TAM 100 PUAN VER (96, 97, 98 gibi ara puanlar VERME — sadece ciddi bir BİLGİ HATASI varsa düşür). Aksi halde bu bölüm sistemde asla yayınlanamaz ve takılı kalır.
→ suggestions alanına isteğe bağlı yapısal öneriler yazabilirsin ama bunlar puanı düşürmez.

Bu kural SADECE yukarıdaki düşük içerikli bölümler için geçerlidir. Gerçek ders anlatımı, kavram tanımı, formül veya mevzuat detayı içeren bölümlerde HER ZAMANKİ GİBİ ACIMADAN DENETLE.
${headingVerificationBlock}
İKİLİ DEĞERLENDİRME SİSTEMİ (DUAL-EVALUATION):

1. PEDAGOJİK VE YAPISAL KALİTE (score):
Bu puan (0-100) SADECE metnin eğitim kalitesini, okunabilirliğini, pedagojik dilini, Markdown formatını, tablo/şema kullanımını ve genel akıcılığını ölçer.
BİLGİ EKSİKLİKLERİ VE ÇELİŞKİLER BU PUANI ASLA DÜŞÜRMEMELİDİR. Eğer üretilen not çok güzel yazılmış, akıcı, okunabilir ve profesyonel bir ders notu formatındaysa (ama içinde unuttuğu veya yanlış yazdığı detaylar olsa bile) "score" alanına 90-100 arası yüksek bir puan ver. ${glossaryScoreBlock}
Eğer not çok sıkıcı, blok metin halinde, tablosuz, okunması zor veya yarım kalmış (yapısal çöküş) ise "score" alanına 70'in altında bir puan ver.

2. HATA VE EKSİK TAKİBİ (missingTopics & issues):
Bu alanlar metnin pedagojik puanından TAMAMEN BAĞIMSIZ olarak, saf bilgi doğruluğunu raporlar.
- KISMİ ANLATIM VE EKSİKLER: Kaynak metinde DETAYLI AÇIKLANMIŞ bir konu veya bir kavramın alt maddeleri (örn: 5 özellikten 2'si unutulmuşsa) eksik bırakılmışsa bunları "missingTopics" listesine yaz.
- KRİTİK BİLGİ HATALARI: Rakam, oran, süre, tarih, ceza miktarı veya mevzuat numarası YANLIŞ yazılmışsa bunları "issues" listesine yaz.
    - ŞERH DENETİMİ VE MÜFETTİŞ SORGUSU: Kaynak metindeki hataları düzeltmek amacıyla not düşülmesi/şerh eklenmesi (örn: "Kaynakta 610 sayılı kanun yazıyor ancak doğrusu 6102 sayılı kanundur") harika bir pedagojik yaklaşımdır. Ancak DÜŞÜLEN BU ŞERHİN DOĞRULUĞUNU KENDİ BİLGİ BİRİKİMİNLE TEYİT ETMELİSİN.
    - KESİN FORMAT KURALI: Notta kullanılan her düzeltme şerhinin (not/uyarı) birebir şu sabit formatta yazıldığını doğrula: "(⚠️ Önemli Detay: İşbu notun orijinal dokümanında [Hatalı Bilgi] olarak geçse de, doğrusu [Doğru Bilgi]'dir.)". Bu formatın milim dışına çıkan (kelime sırası, parantez veya emoji sapması dahil) her türlü şerh yazımını "issues" listesine ekle.
    - Öncelikle bu şerhin (açıklamanın) kendi içinde yasal/olgusal olarak DOĞRU olup olmadığını denetle. 
    - EĞER BİR ŞERHİN DOĞRULUĞUNDAN EN UFAK BİR ŞÜPHE DUYARSAN şerhi doğrudan reddet, passed değerini false yap, ve bunu bir "contradiction" olarak raporla.
    - Eğer düşülen şerh doğru bir yasal güncelleme ise, bunu KESİNLİKLE "Contradiction" veya "Uydurma" olarak İŞARETLEME! Şerh doğruysa sorunsuzca geçirt.
    - EĞER DÜŞÜLEN ŞERH HATALIYSA (yani yapay zeka yanlış bir bilgiyi doğru zannederek şerh düşmüşse), "contradiction" olarak işaretle ve 'description' kısmına tam olarak şu formatta yaz: "Sen (Not Üretici) şöyle bir şerh düşmüşsün: [...]. Ancak ben kaynak metni/yasal durumu incelediğimde doğrusunun bu olduğunu görüyorum: [...]. Acaba ben mi yanılıyorum? Lütfen 'acaba Müfettiş haklı olabilir mi?' diye düşünerek kaynak metni ve yasal bilgiyi tekrar araştır, tekrar kontrol et. Eğer ben haklıysam şerhini/notunu buna göre düzelt, inatlaşma."
    - 🚨 TRIVIAL (Önemsiz/Şekilsel) HATALAR İSTİSNASI: Kaynaktaki basit harf eksikliği, imla hatası veya İngilizce-Türkçe kelime farkı (Örn: 'Standard' yerine 'Standart', 'Asynchronous' yerine 'Asynchrous') için KESİNLİKLE şerh (düzeltme notu/uyarı) düşülmemelidir!
    - Eğer yazar bu kelimeleri kaynak metindeki hatalı haliyle aynen bırakmışsa veya kelimenin literatürdeki doğrusuna (örn: Standart yerine Standard) sessizce düzeltmişse, her iki durum da DOĞRUDUR. Bunları kesinlikle hata/çelişki olarak raporlama!
    - suggestions alanına bu tür küçük imla/yazım düzeltmeleri için "şerh düşülmeliydi, kaynak hali belirtilmeliydi" şeklinde KESİNLİKLE tavsiye yazma! Bu tür küçük harf hatalarının şerh kutularıyla metni kirletmesini istemiyoruz.
${preserveHeadings ? `- Mevzuat/prosedür belgelerinde kaynak ana başlıklarının notta ## ile aynen korunması zorunludur — eksik/birleştirilmiş başlıklar "issues"a yazılır ❌` : `- İçeriğin farklı sırayla organize edilmesi ✅`}
${glossaryPromptBlock}

⚠️ MUTLAK DOĞRULUK KURALI: 
Eksikleri ve hataları sadece "missingTopics" veya "issues" alanlarına aktar. Kaynak metinde bulunmayan dış konuları "suggestions" (öneri) olarak yazma!

Sadece JSON döndür:
{
  "score": <0-100 arası tam sayı>,
  "missingTopics": ["Tamamen ATLANMIŞ konu varsa yaz — yoksa boş array"],
  "issues": ["YANLIŞ rakam/tarih/mevzuat hatası VEYA kaynakta olmayan '[UYDURMA] ...' iddialar — yoksa boş array"],
  "suggestions": ["İyileştirme önerisi — yoksa boş array"]
}

TÜM TESPİTLERİNİ, CÜMLELERİNİ VE ÇIKTILARINI KESİNLİKLE TÜRKÇE DİLİNDE YAZMALISIN (İngilizce kısaltmaları analiz etsen bile raporu Türkçe ver).
`

  const raw = await callAI(prompt, 1, "kontrolor")
  try {
    const result = extractCleanJson(raw) as any
    const missingTopics = result.missingTopics || [];
    const issues = result.issues || [];

    // Objektif ve matematiksel puan hesaplama: Kusursuz not 100 puanla başlar, hatalar oranında düşer.
    let score = 100;
    score -= missingTopics.length * 15;
    score -= issues.length * 10;
    score = Math.max(0, Math.min(score, 100));

    // ==================== GROUND TRUTH ENTEGRASYONU (Madde 2 — SIZDIRMAZ RED) ====================
    // Ground Truth testi, notun %100 olabilmesi için ZORUNLU bir kapıdır.
    // Test BAŞARISIZ olursa VEYA hiç çalışmazsa (API hatası / soru üretilemedi),
    // not KESİNLİKLE %100 sayılamaz. Aksi halde denetlenmemiş not canlıya sızar.
    const groundTruth = isGlossary
      ? { passed: true, failedQuestions: [], totalQuestions: 0, askedQuestions: [] }
      : await runGroundTruthTest(sourceContent, generatedNotes, sectionTitle, courseName);

    let groundTruthBypassed = false;
    if (!groundTruth.passed) {
      if (groundTruth.totalQuestions > 0 && groundTruth.failedQuestions.length > 0) {
        // Bilinen başarısızlık: bazı sorular notla cevaplanamadı → orana göre ceza (asla 100 kalmaz)
        const failRatio = groundTruth.failedQuestions.length / groundTruth.totalQuestions;
        const gtPenalty = Math.max(5, Math.round(score * failRatio));
        score = Math.max(50, Math.min(score - gtPenalty, 99));

        const gtTopics = groundTruth.failedQuestions.map(q => `Eksik Detay (Ground Truth Testi Başarısız): ${q}`);
        missingTopics.push(...gtTopics);
      } else {
        // Test hiç çalışmadı (API hatası / soru üretilemedi) -> 2. veya sonraki denemede bypass et
        if (attemptNumber >= 2) {
          groundTruthBypassed = true;
          console.warn(`[GT] ⚠️ Ground Truth API hatası ardışık denemede alındı, bypass ediliyor (Attempt #${attemptNumber})`);
          if (!result.suggestions) result.suggestions = [];
          result.suggestions.push("Ground Truth doğrulama testi API hatası nedeniyle bypass edildi.");
        } else {
          score = Math.min(score, 90);
          missingTopics.push(
            "Ground Truth doğrulama testi tamamlanamadı (API hatası veya kontrol sorusu üretilemedi). Güvenlik gereği not %100 sayılmadı, tekrar denenecek."
          );
        }
      }
    }

    return {
      score: score,
      missingTopics: missingTopics,
      issues: issues,
      suggestions: result.suggestions || [],
      groundTruthQuestions: groundTruth?.askedQuestions || [],
      groundTruthBypassedAfterRetry: groundTruthBypassed
    }
  } catch (e: any) {
    console.error("[VERIFY] ⚠ Parse/API hatası:", e.message)
    return {
      score: -1, // -1 = teknik hata sinyali, 0'dan farklı
      missingTopics: [],
      issues: ["API_ERROR: Doğrulama motoru yanıt veremedi"],
      suggestions: []
    }
  }
}



export async function auditNotesAgainstSourceSpecific(courseName: string, 
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  topicsToAudit: string[],
  pageStart?: number,
  pageEnd?: number
): Promise<{ passed: boolean; missingDetails: string[]; contradictions: string[]; findings: Array<{ description: string; severity: "CRITICAL" | "MEDIUM" | "LOW"; type: "missing" | "contradiction" }> }> {
  const prompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen bir sınav hazırlık derin denetim uzmanısın (Müfettiş). Görevin, üretilen ders notlarını en ince mikro-detay seviyesinde, özellikle mevzuattaki yasal süreler, ceza miktarları, istisnalar, katalog suçlar ve rakamlar bazında kaynak metinle çapraz sorgulamak ve açık aramaktır.

BÖLÜM BAŞLIĞI: "${sectionTitle}"

⚠️ MÜFETTİŞ TARAFINDAN DENETLENECEK KONULAR (SADECE bunlara odaklan):
${topicsToAudit.map((topic, i) => `${i + 1}. ${topic}`).join("\n")}

KAYNAK METİN:
${sourceContent.replace(/"/g, "'")}

ÜRETİLEN DERS NOTLARINDA BU KONULARA AİT BULUNAN KISIMLAR:
${generatedNotes.replace(/"/g, "'")}

🎯 DENETİM TALİMATLARI:
Sadece ve sadece yukarıda listelenen 3 spesifik konuya odaklan. Kaynak metindeki bu 3 konu ile üretilen notlardaki ilgili paragrafları karşılaştır.
1. EKSİKLİK (Omission): Kaynak metinde geçen herhangi bir yasal süre (örn: 10 gün), oran (örn: %5), limit (örn: 50bin TL), katalog suç listesi, yetkili merci (örn: Hazine ve Maliye Bakanlığı yerine İçişleri Bakanlığı), istisna veya mikro kural ders notunda ATLANMIŞ MI?
2. BİLGİ HATASI/ÇARPITMA (Contradiction): Süreler, limitler veya kurallar ders notuna aktarılırken yanlış veya çarpıtılmış şekilde yazılmış mı (örn: 3 yıl yerine 5 yıl)?
3. UYDURMA (Fabrication — TERS YÖN): Ders notunda bu 3 konuyla ilgili geçen AMA kaynak metinde KARŞILIĞI HİÇ BULUNMAYAN somut bir iddia (rakam, süre, oran, ceza, kurum, kanun/madde no, istisna) var mı? Kaynakta dayanağı olmayan böyle bir bilgi UYDURMADIR → "contradiction" tipinde ve "CRITICAL" olarak işaretle. (Benzetme, hikaye, yeniden ifade UYDURMA DEĞİLDİR; sadece kaynakta olmayan olgusal/sayısal iddialar.)
4. DÜZELTME ŞERHLERİ (ÇOK ÖNEMLİ İSTİSNA): Eğer ders notunda orijinal kaynak metindeki sorunlu/eski/hatalı bir YASAL VEYA KESİN BİLGİ aynen korunmuş ve yazılmışsa, ANCAK hemen yanına "*(Not: Mevzuata göre doğrusu...)*" veya benzeri bir açıklama eklenerek şerh düşülmüşse; 
   - KESİN FORMAT KURALI: Notta kullanılan her düzeltme şerhinin (not/uyarı) birebir şu sabit formatta yazıldığını doğrula: "(⚠️ Önemli Detay: İşbu notun orijinal dokümanında [Hatalı Bilgi] olarak geçse de, doğrusu [Doğru Bilgi]'dir.)". Bu formatın milim dışına çıkan (kelime sırası, parantez veya emoji sapması dahil) her türlü şerh yazımını "contradiction" tipinde ve "CRITICAL" olarak raporla.
   - Öncelikle bu şerhin (açıklamanın) kendi içinde yasal/olgusal olarak DOĞRU olup olmadığını denetle.
   - EĞER BİR ŞERHİN DOĞRULUĞUNDAN EN UFAK BİR ŞÜPHE DUYARSAN şerhi doğrudan reddet, passed değerini false yap, ve bunu bir "contradiction" olarak raporla.
   - Eğer düşülen şerh doğru bir yasal güncelleme ise, bunu KESİNLİKLE "Contradiction" veya "Uydurma" olarak İŞARETLEME! Şerh doğruysa sorunsuzca geçirt.
   - EĞER DÜŞÜLEN ŞERH HATALIYSA (yani yapay zeka yanlış bir bilgiyi doğru zannederek şerh düşmüşse), "contradiction" olarak işaretle ve 'description' kısmına tam olarak şu formatta yaz: "Sen (Not Üretici) şöyle bir şerh düşmüşsün: [...]. Ancak ben kaynak metni/yasal durumu incelediğimde doğrusunun bu olduğunu görüyorum: [...]. Acaba ben mi yanılıyorum? Lütfen 'acaba Müfettiş haklı olabilir mi?' diye düşünerek kaynak metni ve yasal bilgiyi tekrar araştır, tekrar kontrol et. Eğer ben haklıysam şerhini/notunu buna göre düzelt, inatlaşma."
   - 🚨 TRIVIAL (Önemsiz/Şekilsel) HATALAR İSTİSNASI: Kaynaktaki basit harf eksikliği, imla hatası veya İngilizce-Türkçe kelime farkı (Örn: 'Standard' yerine 'Standart', 'Asynchronous' yerine 'Asynchrous') için YAZARIN ŞERH (DÜZELTME NOTU) DÜŞMEMESİ GEREKİR. Eğer yazar bu kelimeleri kaynak metindeki hatalı haliyle aynen yazmış ve şerh düşmemişse, DOĞRU OLANI YAPMIŞTIR. Bunu kesinlikle "hata aynen kopyalanmış ve şerh düşülmemiş" diye eleştirme veya contradiction/hata olarak Raporlama! ✅

ÖNEMLİ: Bu 3 konunun dışındaki diğer ders notu kısımlarını ve kaynak metindeki diğer konuları KESİNLİKLE göz ardı et, onları denetleme.

⚖️ KRİTİKLİK SEVİYELERİ (Her bulguyu aşağıdaki kategorilere göre sınıflandır):
- "CRITICAL": Yasal süre, ceza miktarı, oran, limit veya yasal madde numarası gibi sınavda direkt soru çıkabilecek, yanlış öğrenilmesi öğrenciye puan kaybettirecek somut bilgi hataları veya eksiklikleri. Örneğin: "5 iş günü yerine 10 iş günü yazılmış", "Ceza miktarı 500.000 TL iken notta 250.000 TL yazılmış", "SPK Madde 103 atlanmış".
- "MEDIUM": Bir konunun veya alt başlığın kapsam olarak eksik bırakılması. Konu anlatılmış ama içindeki önemli bir alt detay/madde/istisna atlanmış. Örneğin: "Bilgi güvenliği politikasının 8 hususu yerine sadece 3'ü yazılmış", "Sızma testi türlerinden gri kutu testi anlatılmamış".
- "LOW": Konu notlarda genel olarak doğru anlatılmış ama ifade zenginleştirmesi veya ek bir açıklama/örnek ile daha iyi hale getirilebilecek detaylar. Bilgi doğruluğunu etkilemeyen, akademik derinlik önerileri. Örneğin: "Üst yönetimin bireysel yaklaşımıyla göstermesi detayı eklenebilir".

Sadece aşağıdaki JSON formatında bir çıktı ver:
{
  "passed": <hedef 3 konuda hiçbir eksik detay veya bilgi hatası bulunamadıysa true, en ufak bir CRITICAL veya MEDIUM hata/eksik bulunduysa false>,
  "findings": [
    {
      "description": "Bulgunun detaylı açıklaması",
      "severity": "CRITICAL veya MEDIUM veya LOW",
      "type": "missing veya contradiction"
    }
  ]
}
`

  const raw = await callAI(prompt, 1, "mufettis")
  try {
    const result = extractCleanJson(raw)
    const findings: Array<{ description: string; severity: "CRITICAL" | "MEDIUM" | "LOW"; type: "missing" | "contradiction" }> = (result.findings || []).map((f: any) => ({
      description: f.description || "",
      severity: (["CRITICAL", "MEDIUM", "LOW"].includes(f.severity) ? f.severity : "MEDIUM") as "CRITICAL" | "MEDIUM" | "LOW",
      type: f.type === "contradiction" ? "contradiction" : "missing"
    }))

    // Geriye dönük uyumluluk: eski missingDetails/contradictions formatını da üret
    const missingDetails = findings.filter(f => f.type === "missing").map(f => `[${f.severity}] ${f.description}`)
    const contradictions = findings.filter(f => f.type === "contradiction").map(f => `[${f.severity}] ${f.description}`)

    return {
      passed: result.passed === true || result.passed === "true",
      missingDetails,
      contradictions,
      findings
    }
  } catch {
    // ⚠️ MERHAMET KURALI KALDIRILDI: Sistem çökerse onay verme, hata fırlat!
    return { passed: false, missingDetails: ["Denetim sırasında API hatası oluştu"], contradictions: ["Denetim motoru yanıt veremedi"], findings: [{ description: "Denetim motoru çöktü, güvenlik gereği reddedildi.", severity: "CRITICAL", type: "missing" }] }
  }
}

// ⚠️ MÜFETTİŞ KATMANI: Üretilen soruları ve şıkları resmi kaynakla denetleyen adversarial katman
export async function auditQuestionsAgainstSource(
  sourceContent: string,
  questions: Array<{ text: string; options: string[]; correct: string; explanation: string }>,
  sectionTitle: string,
  courseName?: string,
  fileUri?: string
): Promise<{ passed: boolean; issues: string[]; missingTopics: string[] }> {
  const prompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen bir sınav hazırlık soru denetim uzmanısın (Soru Müfettişi). Görevin, üretilen çoktan seçmeli soruları, cevap anahtarlarını ve açıklamaları kaynak resmi metinle karşılaştırarak bilgi doğruluğu, mantık hataları ve yapay zeka halüsinasyonları açısından denetlemektir.

BÖLÜM BAŞLIĞI: "${sectionTitle}"

KAYNAK METİN:
${sourceContent.replace(/"/g, "'")}

ÜRETİLEN SORULAR VE AÇIKLAMALAR:
${JSON.stringify(questions, null, 2)}

🎯 MÜFETTİŞ DENETİM TALİMATLARI:
Aşağıdaki kurallara göre her soruyu tek tek ve titizlikle incele:
1. Bilgi Hatası (Factual Error): Soru kökünde veya DOĞRU kabul edilen şıkta kaynak metinle çelişen veya uydurulmuş bir yasal süre, ceza miktarı veya kural var mı?
   🚨 ÖNEMLİ İSTİSNA (ÇELDİRİCİ KURALI): Yanlış şıklarda (çeldiricilerde) ve "X şıkkı yanlıştır çünkü..." diyen çözüm açıklamalarında kaynak metinde OLMAYAN mantıklı dış/genel bilgilerin kullanılması BİLİNÇLİDİR VE HALÜSİNASYON SAYILMAZ. Test tekniği gereği çeldirici şıkların kaynakta olmayan mantıklı alternatiflerden oluşması KABUL EDİLEBİLİRDİR. SADECE soru kökünün ve DOĞRU cevabın kaynakta olduğunu teyit et!
2. Şık Tutarsızlığı (Option Contradiction): Doğru kabul edilen cevap şıkkı, sorunun kendisiyle veya kaynak metindeki kuralla çelişiyor mu? (Örn: Soru "hangisi yanlıştır" derken, doğru cevap olarak "doğru" bir ifadeyi mi işaretlemiş?)
3. Eksik Şık Açıklaması: Açıklamada (explanation alanında) A, B, C, D seçeneklerinin her biri için teker teker detaylı analiz yapılmamış, sadece tek cümleyle geçiştirilmiş veya bazı şıklar atlanmış mı?
4. Eksik Konular (Missing Topics): Kaynak metindeki çok kritik, sınavda çıkabilecek önemli bir tanım veya kural, üretilen bu sorularda HİÇ test edilmemiş mi? (Sorularda hiç değinilmemiş olan eksik konuları belirle).

Sadece aşağıdaki JSON formatında çıktı ver:
{
  "passed": <tüm sorular hatasız, tutarlı ve eksiksiz ise true, en ufak bir hata/uydurma veya eksik konu varsa false>,
  "issues": ["Tespit edilen hatayı ve hangi soruda olduğunu belirten detaylı açıklama maddeleri — yoksa boş array"],
  "missingTopics": ["Sorularda hiç değinilmemiş, tamamen test edilmeden geçilmiş olan çok kritik, önemli 1-5 konu başlığı — yoksa boş array"]
}
`

  const raw = await callAI(prompt, 1, "mufettis")
  try {
    const result = extractCleanJson(raw)
    return {
      passed: result.passed === true || result.passed === "true",
      issues: result.issues || [],
      missingTopics: result.missingTopics || []
    }
  } catch {
    // ⚠️ MERHAMET KURALI KALDIRILDI
    return { passed: false, issues: ["Denetim sırasında API hatası oluştu, güvenlik gereği sorular reddedildi."], missingTopics: ["Denetim motoru çöktü"] }
  }
}


// ⚠️ MÜFETTİŞ KATMANI: Üretilen flashcard'ları resmi kaynakla denetleyen adversarial katman
export async function auditFlashcardsAgainstSource(
  sourceContent: string,
  flashcards: Array<{ front: string; back: string }>,
  sectionTitle: string,
  courseName?: string,
  fileUri?: string
): Promise<{ passed: boolean; issues: string[] }> {
  const prompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen bir sınav hazırlık flashcard denetim uzmanısın (Flashcard Müfettişi). Görevin, üretilen soru-cevap kartlarını (flashcards) kaynak resmi metinle karşılaştırarak bilgi doğruluğu, yasal süre limitleri ve yapay zeka halüsinasyonları açısından denetlemektir.

BÖLÜM BAŞLIĞI: "${sectionTitle}"

KAYNAK METİN:
${sourceContent.replace(/"/g, "'")}

ÜRETİLEN FLASHCARDLAR (Soru-Cevap Kartları):
${JSON.stringify(flashcards, null, 2)}

🎯 MÜFETTİŞ DENETİM TALİMATLARI:
Aşağıdaki kurallara göre her kartı tek tek ve titizlikle incele:
1. Bilgi Hatası (Factual Error): Kartın ön yüzündeki soruda veya arka yüzündeki cevapta, kaynak metinle çelişen, uydurulmuş veya yanlış aktarılmış herhangi bir yasal süre (gün/ay), ceza miktarı, katalog suç veya limit kuralı var mı?
2. Yanlış Cevap: Kartın arka yüzündeki cevap, ön yüzdeki soruyla veya kaynak metindeki yasal kuralla çelişiyor mu?

Sadece aşağıdaki JSON formatında çıktı ver:
{
  "passed": <tüm flashcardlar hatasız ve bilgi açısından doğru ise true, en ufak bir hata/uydurma varsa false>,
  "issues": ["Tespit edilen hatayı ve hangi kartta olduğunu belirten detaylı açıklama maddeleri — yoksa boş array"]
}
`

  const raw = await callAI(prompt, 1, "mufettis")
  try {
    const result = extractCleanJson(raw)
    return {
      passed: result.passed === true || result.passed === "true",
      issues: result.issues || []
    }
  } catch {
    // ⚠️ MERHAMET KURALI KALDIRILDI
    return { passed: false, issues: ["Denetim sırasında API hatası oluştu, güvenlik gereği flashcardlar reddedildi."] }
  }
}

export async function smartInjectCourseNotes(
  existingNotes: string,
  feedbackItems: string,
  sectionTitle: string,
  courseName: string,
  userLevel: string,
  aiMode: string
): Promise<string> {
  // AŞAMA 1: Biçim-Duyarlı Akıllı Yama (Format-Aware Smart Inject)
  const injectPrompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
Sen kıdemli bir eğitim içerik mimarı ve baş editörsün. 
Aşağıda "${courseName}" eğitiminin "${sectionTitle}" bölümü için halihazırda üretilmiş olan Ders Notları yer alıyor. 
Denetim ekibi (Müfettiş) bazı eksikler tespit etti. Görevin bu eksikleri notun İÇİNE, mevcut yapıyı bozmadan ZEKİCE ve ORGANİK bir dille enjekte etmektir.

⚠️ BİÇİM-DUYARLI ENJEKSİYON VE CİLALAMA KURALLARI (ÇOK KRİTİK):
1. Önce eksiği nereye ekleyeceğini bul. Sonra O BÖLGEDEKİ BİÇİM DNA'SINI (Format) KOPYALA. Eksikleri yama gibi yapıştırma, önceki ve sonraki cümlelerle mantıksal bağ kurarak su gibi akıcı bir dille ör.
2. EĞER eksik olan şeyin yanındaki konular bir TABLO'da anlatılmışsa, sen de eksik konuyu o tabloya YENİ BİR SATIR olarak ekle. Düz paragraf yazma!
3. EĞER eksik olan şeyin etrafındaki konular bir MERMAID diyagramındaysa, diyagram kodunu güncelle ve eksiği oraya ekle.
4. EĞER eksik olan şey senaryolaştırılmışsa (örn: "X Kurumunun Uyum Görevlisi"), eksiği de aynı karakterin hikayesine yedirerek anlat. Laubali ifadelerden KESİNLİKLE kaçın.
5. YAMA YAPTIĞIN ASLA BELLİ OLMAMALI: "Ayrıca", "Ek olarak", "Öte yandan", "Not:" gibi geçiş kelimeleri KULLANMA. Yeni bilgiyi, önceki metnin %100 doğal bir uzantısı gibi konumlandır. Üslup, format ve tonlama birebir aynı olmalıdır.
5. KESİNLİKLE mevcut hiçbir bilgiyi, tabloyu veya kavramı SİLME/ÖZETLEME. Sadece eksikleri ekle ve akışı düzelt.
6. Notun genel yapısını, başlıklarını ve sıralamasını ASLA değiştirme.
7. Notun sonuna "Ek Bilgiler", "Müfettiş Notu" gibi sonradan eklendiğini belli eden utanç verici yamalar YAPMA. 
8. ⚠️ KESİN KURAL: Asla ama asla "Harika bir görev", "İşte notlar", "İşte güncellenmiş versiyon" gibi sohbet, giriş veya kapanış cümleleri yazma! Sadece saf Markdown çıktısı ver. Doğrudan notun içeriğiyle başla.
9. Çıktın, sadece eklediğin kısımlar DEĞİL, eksiklerin kusursuzca yedirildiği notun TAM SON HALİ olmalıdır.

--- MÜFETTİŞ GERİ BİLDİRİMLERİ (Eklenecek Noktalar) ---
${feedbackItems}

--- MEVCUT DERS NOTLARI (Bu notun içine organik olarak entegre et) ---
${existingNotes}
`;

  // 2.5-flash modelinde bilginin kaybolmasını engellemek için ikinci bir "cilalama" turu (Aşama 2) İPTAL EDİLMİŞTİR.
  // Tüm organik yedirme ve cilalama işi Aşama 1'de (injectPrompt içinde) tek geçişte yapılır.
  return await callAI(injectPrompt, 1, "notes_generation");
}

// ==================== AUTO-HEALING FLAGGING ====================

export async function auditAndRepairQuestion(
  questionText: string,
  optionsJson: string,
  correctAnswer: string,
  explanation: string,
  reportReason: string,
  reportComment: string,
  sourceText: string
): Promise<{ status: "auto_fixed" | "rejected", newQuestion?: any, aiComment: string }> {
  // Müfettişin tüm metni görebilmesi için karakter limiti kaldırıldı (KUSURSUZLUK İÇİN)
  const truncatedSource = sourceText;

  const prompt = `Sen Sınav Komisyonu Başmüfettişisin.
Bir öğrenci sistemdeki aşağıdaki sorunun hatalı olduğunu iddia ederek raporladı.
Görevin: Öğrencinin itirazını kaynak metne göre değerlendirmek.

Öğrencinin İtiraz Nedeni: ${reportReason}
Öğrencinin Yorumu: "${reportComment}"

--- MEVCUT SORU ---
Soru: ${questionText}
Şıklar: ${optionsJson}
Doğru Cevap: ${correctAnswer}
Açıklama: ${explanation}

--- KAYNAK METİN ---
${truncatedSource.replace(/"/g, "'")}

GÖREV:
1. Öğrenci haklıysa (soruda bilgi hatası, yanlış şık, çelişki vb. varsa): Soruyu KAYNAK METNE göre tamamen düzelt.
2. Öğrenci haksızsa (soru kaynak metne göre %100 doğruysa): İtirazı reddet ve öğrenciye neden yanıldığını açıklayan sert ama eğitici bir yorum yaz.

Çıktı Formatı (SADECE JSON döndür):
{
  "status": "auto_fixed" veya "rejected",
  "aiComment": "Öğrenciye gösterilecek açıklama (Örn: 'Haklısınız, 10 iş günü olması gerekirken 15 gün yazılmış, soru düzeltildi.' VEYA 'İtirazınız reddedildi. Doğrusu şu şekildedir...'). KESİNLİKLE 'Kaynak metne göre', 'Metnin X. sayfasında' GİBİ İFADELER KULLANMA. Sadece doğrudan bilgiyi ver.",
  "newQuestion": {
    // SADECE status "auto_fixed" ise bu objeyi doldur, "rejected" ise null bırak.
    "text": "Düzeltilmiş Soru Metni",
    "options": ["A) ...", "B) ...", "C) ...", "D) ...", "E) ..."],
    "correct": "A",
    "explanation": "Düzeltilmiş ve detaylı açıklama. 🚨 KESİNLİKLE 'Kaynak metne göre', 'Metnin X. sayfasında' GİBİ İFADELER KULLANILMAYACAKTIR. Doğrudan bilgiyi kendinden emin bir şekilde ver.",
    "difficulty": "medium"
  }
}
`;

  try {
    const raw = await callAI(prompt, 1);
    const result = extractCleanJson(raw);
    return {
      status: result.status,
      newQuestion: result.newQuestion,
      aiComment: result.aiComment
    };
  } catch (error) {
    console.error("[AUTO-HEALING] Hata:", error);
    return { status: "rejected", aiComment: "Sistem hatası nedeniyle denetim yapılamadı." };
  }
}

// ==================== SOLVER AI (SORU VE FLASHCARD SAĞLAMASI) ====================

export async function validateQuestionsWithSolver(
  notesContent: string,
  questions: any[]
): Promise<any[]> {
  console.log(`[SOLVER_AI] 🕵️‍♂️ ${questions.length} adet soru için Çözüm Denetleyicisi çalışıyor...`);

  if (!questions || questions.length === 0) return questions;

  const prompt = `
Sen bir ders notuna çalışarak test çözen, son derece titiz bir öğrencisin.
DERS NOTLARI:
${notesContent}

SORULAR (JSON Formatında):
${JSON.stringify(questions.map((q, i) => ({ index: i, text: q.question || q.text, options: q.options })))}

GÖREV:
Yukarıdaki soruları SADECE ve SADECE verilen ders notlarına bakarak çöz.
Her bir soru için şu analizi yap:
1. Ders notuna göre doğru şıkkı bul.
2. Soru ders notundaki bilgilerle GÜVENİLİR bir şekilde çözülebiliyor mu? (is_solvable)
3. Sorunun birden fazla doğru şıkkı var mı veya çelişkili mi? (has_multiple_correct)
4. Her YANLIŞ şık için ders notundan kanıt göster — neden kesinlikle yanlış? Kanıtlayamazsan o şık "belirsiz" say.
5. Belirsiz şık varsa has_multiple_correct: true döndür.
6. Doğru cevabın açıklaması (explanation alanı) en az 3 tam cümle içeriyor mu? İçermiyorsa explanation_sufficient: false döndür.
7. Her yanlış şık için ayrı ayrı "neden yanlış" yazılmış mı? Yazılmamışsa explanation_sufficient: false döndür.

Sadece şu formatta JSON döndür:
[
  {
    "index": 0,
    "chosen_answer": "A",
    "is_solvable": true,
    "has_multiple_correct": false,
    "wrong_option_reasons": {
      "B": "Ders notunda X olarak tanımlanmış, Y değil",
      "C": "Kanıtlanamadı — belirsiz"
    },
    "explanation_sufficient": true
  }
]
`;

  try {
    const raw = await callAI(prompt, 1, "verification");
    const solverResults = extractCleanJson(raw) as any[];

    const validQuestions = questions.filter((q, i) => {
      const s = solverResults.find((res: any) => res.index === i);
      if (!s) return false;

      const intendedAnswer = (q.correct || q.correctOption || q.correctAnswer)?.trim().substring(0, 1).toUpperCase();
      const chosenAnswer = s.chosen_answer?.trim().substring(0, 1).toUpperCase();

      const isCorrect = intendedAnswer === chosenAnswer;
      const isSolvable = s.is_solvable === true;
      const noMultiple = s.has_multiple_correct === false;
      const explanationOk = s.explanation_sufficient !== false;

      const hasAmbiguousOption = Object.values(s.wrong_option_reasons || {})
        .some((r: any) => r.toString().includes("belirsiz") || r.toString().includes("Kanıtlanamadı"));

      if (!isSolvable || !noMultiple || !isCorrect || !explanationOk || hasAmbiguousOption) {
        console.log(`[SOLVER_AI] ⚠️ Soru elendi (Index ${i}): Solvable=${isSolvable}, NoMultiple=${noMultiple}, AnswerMatched=${isCorrect}, ExplanationOk=${explanationOk}, NoAmbiguous=${!hasAmbiguousOption}`);
        return false;
      }
      return true;
    });

    console.log(`[SOLVER_AI] ✅ ${questions.length} sorudan ${validQuestions.length} tanesi denetimden geçti.`);
    return validQuestions;
  } catch (error) {
    console.error("[SOLVER_AI] Soru denetimi başarısız oldu — doğrulanmamış sorular kaydedilmeyecek:", error);
    return [];
  }
}

export async function validateFlashcardsWithSolver(
  notesContent: string,
  flashcards: any[]
): Promise<any[]> {
  console.log(`[SOLVER_AI] 🕵️‍♂️ ${flashcards.length} adet Flashcard için Mantık Denetleyicisi çalışıyor...`);

  if (!flashcards || flashcards.length === 0) return flashcards;

  const prompt = `
Sen titiz bir kalite kontrol uzmanısın.
DERS NOTLARI:
${notesContent}

FLASHCARDLAR (JSON Formatında):
${JSON.stringify(flashcards.map((f, i) => ({ index: i, front: f.front, back: f.back })))}

GÖREV:
Her bir flashcard'ı incele:
1. "front" (ön yüz) kısmında cevabın kendisi geçiyor mu? (Spolier içeriyor mu?)
2. "back" (arka yüz) kısmındaki bilgi ders notlarıyla tamamen tutarlı mı?
3. Arka yüzdeki cevap muğlak mı? ("değişebilir", "duruma göre", "genellikle" gibi kesin olmayan ifadeler içeriyorsa) -> is_valid: false
4. Arka yüzde rakam, süre veya ceza miktarı varsa ders notundaki değerle birebir örtüşüyor mu? Örtüşmüyorsa -> is_valid: false
5. Ön yüzdeki soru tek bir net cevabı olan bir soru mu? Birden fazla doğru cevabı olabilecek açık uçlu soruysa -> is_valid: false

Sadece şu formatta JSON döndür:
[
  {
    "index": 0,
    "is_valid": true,
    "reason": "Geçerli"
  }
]
Eğer spoiler varsa veya bilgi yanlışsa "is_valid": false yap.
`;

  try {
    const raw = await callAI(prompt, 1, "verification");
    const solverResults = extractCleanJson(raw) as any[];

    const validFlashcards = flashcards.filter((f, i) => {
      const s = solverResults.find((res: any) => res.index === i);
      if (!s) return false;

      if (s.is_valid !== true) {
        console.log(`[SOLVER_AI] ⚠️ Flashcard elendi (Index ${i}): ${s.reason}`);
        return false;
      }
      return true;
    });

    console.log(`[SOLVER_AI] ✅ ${flashcards.length} karttan ${validFlashcards.length} tanesi denetimden geçti.`);
    return validFlashcards;
  } catch (error) {
    console.error("[SOLVER_AI] Flashcard denetimi başarısız oldu — doğrulanmamış kartlar kaydedilmeyecek:", error);
    return [];
  }
}

// ==================== ÇİFT DİL (TR + EN) — CISA/CIA ====================
// Notlar: yalnızca Türkçe. Soru + flashcard: TR ana metin + EN paralel alan.

/** Soru ve flashcard için TR+EN çeviri (uluslararası denetim sınavları) */
export function needsBilingualStudyItems(aiMode: string): boolean {
  return aiMode === "international_audit"
}

/** @deprecated Notlar artık çevrilmiyor — needsBilingualStudyItems kullanın */
export function needsBilingualContent(aiMode: string): boolean {
  return needsBilingualStudyItems(aiMode)
}

export async function translateNotesToEnglish(
  notesTr: string,
  sectionTitle: string,
  courseName: string
): Promise<string | null> {
  if (!notesTr || notesTr.length < 50) return null
  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle} > EN Çeviri]
Sen profesyonel bir teknik çevirmensin. Aşağıdaki TÜRKÇE ders notunu İNGİLİZCE'ye çevir.

KURALLAR:
- Resmi sınav terimlerini (control, audit, governance, assurance, risk) DOĞRU ve standart İngilizce karşılıklarıyla kullan.
- Rakam, süre, oran, madde numarası gibi somut değerleri AYNEN koru — değiştirme.
- Markdown yapısını (başlıklar, tablolar, listeler) koru.
- Uydurma bilgi ekleme, sadece çevir.
- Sohbet/giriş cümlesi yazma, doğrudan markdown ile başla.

TÜRKÇE NOT:
${notesTr.substring(0, 120000)}
`
  try {
    const raw = await callAI(prompt, 1, "verification")
    return raw.trim() || null
  } catch {
    return null
  }
}

export async function translateFlashcardsToEnglish(
  flashcards: Array<{ front: string; back: string }>,
  sectionTitle: string,
  courseName: string
): Promise<Array<{ front_en: string; back_en: string }>> {
  if (flashcards.length === 0) return []
  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle} > Flashcard EN]
Aşağıdaki Türkçe flashcardları İngilizce'ye çevir. Her kart için front_en ve back_en üret.

KURALLAR:
- Resmi CISA/audit terimlerini doğru İngilizce karşılıklarıyla kullan.
- Rakam/süre/oran değerlerini AYNEN koru.
- Anlam kayması olmasın — birebir eşdeğer çeviri.

GİRDİ:
${JSON.stringify(flashcards.map((f, i) => ({ index: i, front: f.front, back: f.back })))}

Sadece JSON array döndür:
[{"index": 0, "front_en": "...", "back_en": "..."}]
`
  try {
    const raw = await callAI(prompt, 1, "verification")
    const parsed = extractCleanJson(raw)
    const list = Array.isArray(parsed) ? parsed : []
    return flashcards.map((_, i) => {
      const row = list.find((r: any) => r.index === i) || list[i]
      return {
        front_en: row?.front_en || "",
        back_en: row?.back_en || "",
      }
    })
  } catch {
    return flashcards.map(() => ({ front_en: "", back_en: "" }))
  }
}

export async function translateQuestionsToEnglish(
  questions: Array<{ text: string; options: string[]; explanation?: string }>,
  sectionTitle: string,
  courseName: string
): Promise<Array<{ text_en: string; options_en: string[]; explanation_en: string }>> {
  if (questions.length === 0) return []
  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle} > Soru EN]
Aşağıdaki Türkçe çoktan seçmeli soruları İngilizce'ye çevir. Şık harfleri (A/B/C/D/E) ve doğru cevap harfi DEĞİŞMEZ — sadece metinleri çevir.

KURALLAR:
- Resmi audit/IT terimlerini standart İngilizce kullan.
- Rakam/süre/oran AYNEN korunur.
- options_en dizisi options ile aynı sırada ve aynı sayıda olmalı.

GİRDİ:
${JSON.stringify(questions.map((q, i) => ({ index: i, text: q.text, options: q.options, explanation: q.explanation || "" })))}

Sadece JSON array döndür:
[{"index": 0, "text_en": "...", "options_en": ["A) ...", ...], "explanation_en": "..."}]
`
  try {
    const raw = await callAI(prompt, 1, "verification")
    const parsed = extractCleanJson(raw)
    const list = Array.isArray(parsed) ? parsed : []
    return questions.map((q, i) => {
      const row = list.find((r: any) => r.index === i) || list[i]
      return {
        text_en: row?.text_en || "",
        options_en: Array.isArray(row?.options_en) ? row.options_en : q.options,
        explanation_en: row?.explanation_en || "",
      }
    })
  } catch {
    return questions.map((q) => ({ text_en: "", options_en: q.options, explanation_en: "" }))
  }
}

/** TR↔EN çeviri tutarlılığı: sayılar ve resmi terimler eşleşiyor mu? */
export async function validateBilingualPairs(
  pairs: Array<{ tr: string; en: string; label: string }>,
  sectionTitle: string,
  courseName: string
): Promise<{ passed: boolean; issues: string[] }> {
  if (pairs.length === 0) return { passed: true, issues: [] }
  const sample = pairs.slice(0, 12)
  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle} > Çeviri Tutarlılık]
Aşağıdaki TR/EN metin çiftlerini incele. Aynı anlamı mı taşıyorlar? Rakamlar/süreler birebir eşleşiyor mu?

${JSON.stringify(sample)}

Sadece JSON döndür:
{"passed": true/false, "issues": ["..."]}
`
  try {
    const raw = await callAI(prompt, 1, "verification")
    const result = extractCleanJson(raw)
    return {
      passed: result.passed === true || result.passed === "true",
      issues: result.issues || [],
    }
  } catch {
    return { passed: false, issues: ["Çeviri tutarlılık denetimi API hatası"] }
  }
}
