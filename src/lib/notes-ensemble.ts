import { generateCourseNotes, callAI } from "@/lib/ai-service"
import { DocumentType } from "@/lib/document-processing-profile"

/**
 * İki ayrı prompt/üretim ile Not A ve Not B oluşturur, ardından bunları kaynak referansıyla konsensüs birleşimine tabi tutar
 */
export async function generateCourseNotesEnsemble(
  content: string,
  sectionTitle: string,
  courseName: string,
  userLevel = "beginner",
  aiMode = "general",
  pageStart?: number,
  pageEnd?: number,
  previousContext?: string,
  sourceMode: "strict" | "enriched" = "strict",
  documentNoteStyle?: string,
  documentType?: DocumentType,
  nextSectionTitle?: string,
): Promise<{ notes: string; ensembleMode: "consensus" | "noteA_fallback" }> {
  console.log(`[NOTES_ENSEMBLE] 🎨 Çift üretim başlatılıyor (Not A ve Not B)...`)

  // 1. Not A üretimi (Standart Stil)
  const noteA = await generateCourseNotes(
    content,
    sectionTitle,
    courseName,
    userLevel,
    aiMode,
    pageStart,
    pageEnd,
    false,
    0,
    1,
    previousContext,
    sourceMode,
    documentNoteStyle,
    documentType,
    nextSectionTitle,
  )

  // Not A ve Not B istekleri arasına 5 saniye bekleme süresi
  console.log(`[NOTES_ENSEMBLE] ⏱️ Hız limiti koruması: Not B öncesi 5 saniye bekleniyor...`)
  await new Promise(r => setTimeout(r, 5000))

  // 2. Not B üretimi (Hukuki/Sayısal doğruluk odaklı alternatif prompt stili)
  const alternativeStyle = `${documentNoteStyle || ""}\n\nEkstra Talimat: Özellikle yasal süreler, yüzdelik oranlar, parasal limitler ve idari para cezaları konusunda sıfır toleransla çalış. En ufak bir sayıyı dahi atlama.`
  const noteB = await generateCourseNotes(
    content,
    sectionTitle,
    courseName,
    userLevel,
    aiMode,
    pageStart,
    pageEnd,
    false,
    0,
    1,
    previousContext,
    sourceMode,
    alternativeStyle,
    documentType,
    nextSectionTitle,
  )

  // Not B ve Birleştirme istekleri arasına 5 saniye bekleme süresi
  console.log(`[NOTES_ENSEMBLE] ⏱️ Hız limiti koruması: Konsensüs birleştirme öncesi 5 saniye bekleniyor...`)
  await new Promise(r => setTimeout(r, 5000))

  console.log(`[NOTES_ENSEMBLE] 🤝 Üretimler tamamlandı. Konsensüs birleştirme yapılıyor...`)

  // 3. Konsensüs Birleştirme
  const mergePrompt = `
Görevin, aynı kaynak metinden türetilmiş iki farklı ders notunu (Not A ve Not B) tek bir kusursuz ders notu olarak birleştirmektir.

ÇOK KRİTİK KURALLAR:
1. OLGUSAL TUTARLILIK (HALÜSİNASYON ENGELİ): Not A ve Not B'deki tüm süreler (gün, ay), oranlar (%), kanun/madde referansları ve cezalar kaynak metinle eşleşmelidir. İki not arasında çelişen bir rakam varsa, aşağıdaki KAYNAK METNE bakarak doğrusunu yaz.
2. EKSİKSİZLİK: Her iki notta da geçen tüm önemli konu başlıklarını, tanımları ve kuralları birleştirilmiş nota dahil et. Notlardan birinde geçip diğerinde atlanmış olan yasal kuralları da atlamadan ekle.
3. FORMAT: Markdown başlık yapısını (##, ###) ve varsa Mermaid diyagramları ile tabloları eksiksiz koru.

NOT A:
${noteA}

NOT B:
${noteB}

KAYNAK METİN REFERANSI:
${content.slice(0, 10000)}

Nihai birleştirilmiş ders notunu doğrudan Markdown formatında döndür (Başka hiçbir açıklama yazma):
`

  try {
    const mergedNotes = await callAI(mergePrompt, 1, "notes_generation")
    return {
      notes: repairMermaidInText(mergedNotes || noteA),
      ensembleMode: mergedNotes ? "consensus" : "noteA_fallback"
    }
  } catch (err: any) {
    console.warn(`[NOTES_ENSEMBLE] ⚠️ Konsensüs birleştirme başarısız oldu, yedek olarak Not A kullanılıyor:`, err.message)
    return {
      notes: repairMermaidInText(noteA),
      ensembleMode: "noteA_fallback"
    }
  }
}

export function repairMermaidSyntax(mermaidCode: string): string {
  let repaired = mermaidCode
  // Fix arrows: -- > to -->, -> to -->
  repaired = repaired.replace(/--\s*>/g, "-->")
  repaired = repaired.replace(/\s+->\s+/g, " --> ")
  
  // Fix arrow label quotes: -->|Label| to -->|"Label"|
  repaired = repaired.replace(/-->\|([^|"]+)\|/g, (match, p1) => `-->|"${p1.trim()}"|`)

  // Fix node brackets globally: NodeId["Label"] or NodeId("Label") etc.
  repaired = repaired.replace(/\b([a-zA-Z0-9_-]+)\s*(\[|\(\(|\(|\{)"?([^"\])}]+)"?(\]?|\)\)?|\)?|\}?)/g, (match, id, open, content, close) => {
    let correctClose = ""
    if (open === "[") correctClose = "]"
    else if (open === "(") correctClose = ")"
    else if (open === "((") correctClose = "))"
    else if (open === "{") correctClose = "}"
    
    return `${id}${open}"${content.trim()}"${correctClose}`
  })

  return repaired
}

export function repairMermaidInText(text: string): string {
  if (!text) return text
  return text.replace(/```mermaid([\s\S]*?)```/g, (match, mermaidCode) => {
    return `\`\`\`mermaid\n${repairMermaidSyntax(mermaidCode).trim()}\n\`\`\``
  })
}

