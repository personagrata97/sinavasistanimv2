import { callAI, extractCleanJson } from "@/lib/ai-service"

export type AuditFinding = {
  description: string
  severity: "CRITICAL" | "MEDIUM" | "LOW"
  type: "missing" | "contradiction"
}

export type AuditResult = {
  passed: boolean
  findings: AuditFinding[]
  missingDetails: string[]
  contradictions: string[]
}

/**
 * Kaynak metni paragraf sınırlarından ayırır ve yaklaşık 3500 karakterlik denetim paketlerine gruplar
 */
export function splitSourceIntoAuditChunks(sourceText: string, maxChunkLen = 3500): string[] {
  const paragraphs = sourceText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
  const chunks: string[] = []
  let currentChunk = ""

  for (const p of paragraphs) {
    if ((currentChunk + "\n\n" + p).length > maxChunkLen && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = p
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + p : p
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk)
  }
  return chunks
}

/**
 * 3.5 Flash modeli — Eksik Bilgi (Omission) Denetçisi
 */
async function auditOmissions(
  sourceChunk: string,
  notesContent: string,
  sectionTitle: string,
  courseLabel: string,
): Promise<AuditFinding[]> {
  const prompt = `[LOG_CONTEXT: ${courseLabel}]
BÖLÜM: "${sectionTitle}"
GÖREV: Sen bir sınav hazırlık eksik bilgi denetim uzmanısın. Aşağıdaki KAYNAK METİN parçasındaki kritik yasal süreleri, limitleri, oranları, cezaları ve kuralları incele.
Bunların hangileri DERS NOTLARINDA eksik bırakılmış (atlanmış)? Pedagojik zenginleştirme yorumlarını atla. Sadece sınavda çıkabilecek yasal/somut eksiklikleri bul.

KAYNAK METİN:
${sourceChunk}

DERS NOTLARI:
${notesContent}

Döndüreceğin JSON formatı (Başka hiçbir açıklama yazma, sadece JSON döndür):
{
  "findings": [
    {
      "description": "Eksik bırakılan detay veya kural açıklaması",
      "severity": "CRITICAL veya MEDIUM veya LOW"
    }
  ]
}`

  try {
    const raw = await callAI(prompt, 1, "mufettis")
    const parsed = extractCleanJson(raw) as { findings?: any[] }
    return (parsed?.findings ?? []).map(f => ({
      description: f.description || "",
      severity: (["CRITICAL", "MEDIUM", "LOW"].includes(f.severity) ? f.severity : "MEDIUM") as any,
      type: "missing" as const
    }))
  } catch {
    return []
  }
}

/**
 * 2.5 Flash modeli — Çelişki ve Uydurma (Contradiction & Fabrication) Denetçisi
 */
async function auditContradictions(
  sourceChunk: string,
  notesContent: string,
  sectionTitle: string,
  courseLabel: string,
): Promise<AuditFinding[]> {
  const prompt = `[LOG_CONTEXT: ${courseLabel}]
BÖLÜM: "${sectionTitle}"
GÖREV: Sen bir sınav hazırlık bilgi doğruluğu denetim uzmanısın. Aşağıdaki KAYNAK METİN parçasını incele. 
DERS NOTLARINDA bu kaynak parçasıyla ÇELİŞEN (yanlış yazılmış süre/oran/kanun no) veya kaynakta HİÇ GEÇMEYEN (tamamen yapay zeka tarafından uydurulmuş) süreler, limitler, cezalar veya iddialar var mı?

KAYNAK METİN:
${sourceChunk}

DERS NOTLARI:
${notesContent}

Döndüreceğin JSON formatı (Başka hiçbir açıklama yazma, sadece JSON döndür):
{
  "findings": [
    {
      "description": "Çelişen veya uydurulmuş bilginin doğrusuyla birlikte açıklaması",
      "severity": "CRITICAL veya MEDIUM"
    }
  ]
}`

  try {
    const raw = await callAI(prompt, 1, "kontrolor")
    const parsed = extractCleanJson(raw) as { findings?: any[] }
    return (parsed?.findings ?? []).map(f => ({
      description: f.description || "",
      severity: (["CRITICAL", "MEDIUM", "LOW"].includes(f.severity) ? f.severity : "MEDIUM") as any,
      type: "contradiction" as const
    }))
  } catch {
    return []
  }
}

/**
 * Kapsamlı Başmüfettiş denetim döngüsü: Paragrafları gruplar halinde 3.5 ve 2.5 modellerine eşzamanlı sorgulatır
 */
export async function runExhaustiveAudit(
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string,
): Promise<AuditResult> {
  const chunks = splitSourceIntoAuditChunks(sourceContent)
  const allFindings: AuditFinding[] = []
  const courseLabel = `${courseName} > ${sectionTitle}`

  console.log(`[MUFETTIS_EXHAUSTIVE] 🕵️‍♂️ Bölüm "${sectionTitle}" ${chunks.length} adet denetim paketine bölündü.`)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    console.log(`[MUFETTIS_EXHAUSTIVE] 📦 Paket #${i + 1}/${chunks.length} denetleniyor...`)
    
    const [omissions, contradictions] = await Promise.all([
      auditOmissions(chunk, generatedNotes, sectionTitle, courseLabel),
      auditContradictions(chunk, generatedNotes, sectionTitle, courseLabel)
    ])

    allFindings.push(...omissions, ...contradictions)
    await new Promise(r => setTimeout(r, 500))
  }

  const passed = !allFindings.some(f => f.severity === "CRITICAL" || f.severity === "MEDIUM")
  const missingDetails = allFindings.filter(f => f.type === "missing").map(f => `[${f.severity}] ${f.description}`)
  const contradictions = allFindings.filter(f => f.type === "contradiction").map(f => `[${f.severity}] ${f.description}`)

  return {
    passed,
    findings: allFindings,
    missingDetails,
    contradictions
  }
}
