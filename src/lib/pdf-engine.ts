import PDFParser from "pdf2json"
import axios from "axios"
import { logDirectGeminiApiCall } from "@/lib/ai-service"

// pdf2json ile metin çıkarma - pdfjs-dist'ten çok daha güvenilir
// PDF'teki her sayfanın metnini ayrı ayrı çıkarır

function fixMathChars(text: string): string {
  return text
    .replace(/³/g, "^3")
    .replace(/²/g, "^2")
    .replace(/∑/g, "Sigma ")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≠/g, "!=")
    .replace(/α/g, "Alpha")
    .replace(/β/g, "Beta");
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser()

    parser.on("pdfParser_dataReady", (data: any) => {
      resolve(data.Pages?.length || 1)
    })

    parser.on("pdfParser_dataError", (err: any) => {
      const errMsg = String(err?.parserError || err || "")
      if (errMsg.toLowerCase().includes("password") || errMsg.toLowerCase().includes("encrypted")) {
        reject(new Error("Şifreli (Parola Korumalı) PDF dosyaları desteklenmemektedir."))
        return
      }
      console.error("[PDF_ENGINE] Page count error:", err)
      resolve(1)
    })

    parser.parseBuffer(buffer)
  })
}



// Tüm sayfaların metnini tek seferde çıkar (çok daha hızlı!)
export async function extractAllText(buffer: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser()

    parser.on("pdfParser_dataReady", (data: any) => {
      const pages = data.Pages || []
      const texts: string[] = []

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        const pageTexts = page.Texts || []

        const textParts: string[] = []
        let lastY = -1

        for (const textItem of pageTexts) {
          const t = textItem.R?.[0]?.T || ""
          let decoded: string
          try { decoded = decodeURIComponent(t) } catch { decoded = t }
          const y = Math.round(textItem.y * 10)

          if (decoded.trim().length === 0) continue

          if (lastY >= 0 && Math.abs(y - lastY) > 1) {
            textParts.push("\n")
          }

          textParts.push(decoded)
          lastY = y
        }

        const fullText = textParts.join(" ")
          .replace(/ +/g, " ")
          .replace(/\n +/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()

        const fixedText = fixMathChars(fullText)
        texts.push(fixedText)
      }

      const totalChars = texts.reduce((sum, t) => sum + t.length, 0)
      const nonEmpty = texts.filter(t => t.length > 20).length
      console.log(`[PDF_ENGINE] Extracted ${pages.length} pages: ${totalChars} total chars, ${nonEmpty} non-empty pages`)

      // ⚠️ NON-SEARCHABLE PDF ALGILAMA
      // Taranmış/resim PDF'lerde text layer olmaz → toplam karakter çok düşük olur
      if (pages.length > 0 && totalChars < 500) {
        console.warn(`[PDF_ENGINE] ⚠️ NON-SEARCHABLE PDF ALGILANDI! ${pages.length} sayfa var ama sadece ${totalChars} karakter çıkarıldı.`)
        console.warn(`[PDF_ENGINE] Bu PDF muhtemelen tarayıcıdan geçirilmiş bir görüntü PDF'idir. Metin çıkarma başarısız olabilir.`)
      } else if (pages.length > 5 && nonEmpty < pages.length * 0.3) {
        console.warn(`[PDF_ENGINE] ⚠️ KISMEN NON-SEARCHABLE PDF! ${pages.length} sayfanın sadece ${nonEmpty} tanesinde anlamlı metin bulundu.`)
      }

      resolve(texts)
    })

    parser.on("pdfParser_dataError", (err: any) => {
      const errMsg = String(err?.parserError || err || "")

      // ŞİFRELİ PDF ALGILAMA
      if (errMsg.toLowerCase().includes("password") || errMsg.toLowerCase().includes("encrypted")) {
        console.error(`[PDF_ENGINE] 🔒 ŞİFRELİ PDF! Bu PDF parola korumalıdır ve işlenemez.`)
        resolve(["__ENCRYPTED__"]) // Upstream'de algılanacak
        return
      }

      console.error("[PDF_ENGINE] Fatal extraction error:", err)
      resolve([])
    })

    parser.parseBuffer(buffer)
  })
}

/** Taranmış PDF bölümlerinde OCR tamamlanana kadar kullanılan geçici işaret */
export const SCANNED_PDF_PENDING_OCR = "[SCANNED_PDF_PENDING_OCR]"

export const MARKDOWN_OCR_SUCCESS_PREFIX = "[MARKDOWN_OCR_SUCCESS]"

/** Görsel OCR gerçekten tamamlandı — yalnızca extractPerfectMarkdownOCR sonunda damgalanır */
export const VISUAL_OCR_COMPLETE_PREFIX = "[VISUAL_OCR_COMPLETE]"

/** Devam Ettir'de yeniden OCR başlatılmaması için minimum anlamlı metin eşiği */
export const MIN_VALID_RAW_CONTENT_FOR_REOCR_SKIP = 500

/** Aranabilir PDF: toplam metin eşiği (pdf2json yerel çıkarma) */
export const SEARCHABLE_PDF_MIN_TOTAL_CHARS = 500

/** Aranabilir PDF: sayfa başına ortalama metin eşiği */
export const SEARCHABLE_PDF_MIN_CHARS_PER_PAGE = 50

/** Günlükte görünen net mesaj — yerel metin katmanı var; görsel okuma ayrıca yapılır */
export const NATIVE_TEXT_LOG_MESSAGE =
  "PDF aranabilir — yerel metin katmanı mevcut, görsel okuma arka planda yapılacak"

export interface PdfSearchabilityResult {
  isSearchable: boolean
  isNonSearchable: boolean
  isPartiallySearchable: boolean
  totalChars: number
  avgCharsPerPage: number
  nonEmptyPages: number
  message: string | null
}

/**
 * PDF aranabilir mi? Yerel metin katmanından yeterli karakter çıkıyorsa evet —
 * yükleme kapısı geçer; görsel okuma (extractPerfectMarkdownOCR) yine de çalışır (şema/resim için).
 */
export function assessPdfSearchability(pageTexts: string[]): PdfSearchabilityResult {
  const totalPages = pageTexts.length
  const totalChars = pageTexts.reduce((sum, t) => sum + t.length, 0)
  const nonEmptyPages = pageTexts.filter((t) => t.length > 20).length
  const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0

  if (totalPages > 0 && totalChars < SEARCHABLE_PDF_MIN_TOTAL_CHARS) {
    return {
      isSearchable: false,
      isNonSearchable: true,
      isPartiallySearchable: false,
      totalChars,
      avgCharsPerPage,
      nonEmptyPages,
      message: `Bu PDF'den metin çıkarılamadı (${totalChars} karakter). Taranmış/görüntü PDF olabilir. Lütfen metin tabanlı (searchable) bir PDF yükleyin veya OCR işlemi uygulayın.`,
    }
  }

  if (totalPages > 5 && nonEmptyPages < totalPages * 0.3) {
    return {
      isSearchable: false,
      isNonSearchable: false,
      isPartiallySearchable: true,
      totalChars,
      avgCharsPerPage,
      nonEmptyPages,
      message: `PDF'in ${totalPages} sayfasından sadece ${nonEmptyPages} tanesinde metin bulundu. Bazı sayfalar taranmış görüntü olabilir.`,
    }
  }

  const meetsPerPage =
    totalPages <= 1 || avgCharsPerPage >= SEARCHABLE_PDF_MIN_CHARS_PER_PAGE
  const isSearchable =
    totalChars >= SEARCHABLE_PDF_MIN_TOTAL_CHARS && meetsPerPage

  return {
    isSearchable,
    isNonSearchable: false,
    isPartiallySearchable: !isSearchable,
    totalChars,
    avgCharsPerPage,
    nonEmptyPages,
    message: null,
  }
}

/** Bölüm sayfa aralığındaki yerel metni birleştirir (Gemini OCR yerine) */
export function joinPageTextsForRange(
  pageTexts: string[],
  pageStart: number,
  pageEnd: number,
): string {
  const start = Math.max(0, pageStart - 1)
  const end = Math.min(pageTexts.length, pageEnd)
  return pageTexts.slice(start, end).join("\n\n")
}

export function isPendingOcrContent(content: string): boolean {
  return content.includes(SCANNED_PDF_PENDING_OCR)
}

export function hasOcrSuccessFlag(content: string): boolean {
  return content.includes(MARKDOWN_OCR_SUCCESS_PREFIX)
}

export function hasVisualOcrComplete(content: string): boolean {
  return content.includes(VISUAL_OCR_COMPLETE_PREFIX)
}

/**
 * Görsel OCR gerekli mi? Yalnızca hem MARKDOWN_OCR_SUCCESS hem VISUAL_OCR_COMPLETE varsa hayır.
 * Eski sahte damgalar (yalnızca yerel metin) yeniden OCR tetikler — API israfı önlenir.
 */
export function shouldRunMarkdownOcr(rawContent: string): boolean {
  if (hasOcrSuccessFlag(rawContent) && hasVisualOcrComplete(rawContent)) return false
  return true
}

/** @deprecated shouldRunMarkdownOcr ters mantığı — course-processing-status uyumluluğu */
export function shouldSkipReOcr(rawContent: string): boolean {
  return !shouldRunMarkdownOcr(rawContent)
}

/** @deprecated Sahte OCR damgası basmaz — yalnızca metni döndürür */
export function stampNativeTextAsReady(rawContent: string): string {
  return rawContent.trim()
}

/**
 * Aranabilir PDF'ten çıkan yerel metin — bölüm ham içeriğine yazılır.
 * Görsel okumayı atlamaz; [MARKDOWN_OCR_SUCCESS] yalnızca extractPerfectMarkdownOCR sonrası gelir.
 */
export function prepareSearchablePdfSectionContent(rawContent: string): string {
  if (isPendingOcrContent(rawContent)) return rawContent
  if (hasOcrSuccessFlag(rawContent)) return rawContent
  return rawContent.trim()
}

// Non-searchable PDF durumunu kontrol et (upload route'dan çağrılır)
export function checkPdfQuality(pageTexts: string[], totalPages: number): {
  isNonSearchable: boolean;
  isPartiallySearchable: boolean;
  message: string | null
} {
  void totalPages
  const assessment = assessPdfSearchability(pageTexts)
  return {
    isNonSearchable: assessment.isNonSearchable,
    isPartiallySearchable: assessment.isPartiallySearchable,
    message: assessment.message,
  }
}

// 🚀 TEK SEFERDE TÜM PDF'İ MARKDOWN'A ÇEVİRİCİ (PARALEL VE ÇOKLU ANAHTAR)
export async function convertPdfToMarkdown(pageTexts: string[], apiKeys: string[]): Promise<string> {
  if (!apiKeys || apiKeys.length === 0) {
    throw new Error("API anahtarı bulunamadı.");
  }
  
  if (pageTexts.length === 0 || pageTexts[0] === "__ENCRYPTED__") {
    throw new Error("PDF okunamadı veya şifreli.");
  }

  // 10 sayfalık chunklara böl
  const CHUNK_SIZE = 10;
  const chunks: string[] = [];
  
  for (let i = 0; i < pageTexts.length; i += CHUNK_SIZE) {
    const chunkPages = pageTexts.slice(i, i + CHUNK_SIZE);
    const chunkText = chunkPages.map((text, idx) => `--- SAYFA ${i + idx + 1} ---\n${text}`).join("\n\n");
    chunks.push(chunkText);
  }

  console.log(`[PDF_ENGINE] Toplam ${chunks.length} chunk oluşturuldu. ${apiKeys.length} anahtar ile paralel işleme başlanıyor...`);

  // Paralel işleme: Her chunk için sıradaki API anahtarını kullanarak promise oluştur
  const promises = chunks.map(async (chunkText, i) => {
    const apiKey = apiKeys[i % apiKeys.length]; // Anahtarları sırayla döndür
    
    // API rate limitine takılmamak için hafif bir gecikme ekle (her anahtar için 500ms * kendi sırası)
    await new Promise(r => setTimeout(r, (i % apiKeys.length) * 500));

    console.log(`[PDF_ENGINE] Markdown dönüşümü: Chunk ${i + 1}/${chunks.length} işleniyor... (Gemini 3.5 Flash)`);

    const body = {
      contents: [
        {
          parts: [
            {
              text: `Aşağıda bir kitabın/ders notunun ${i * CHUNK_SIZE + 1} ile ${Math.min((i + 1) * CHUNK_SIZE, pageTexts.length)} arası sayfalarının ham metin dökümü bulunmaktadır.
Görev: Bu ham metni okuyup, YAPISINI VE BİLGİLERİNİ HİÇ BOZMADAN, EKSİKSİZ BİR ŞEKİLDE profesyonel bir Markdown formatına dönüştürmek.
Kurallar:
1. Hiçbir cümleyi, kelimeyi, tabloyu veya listeyi atlama. Her detayı koru.
2. Gereksiz üstbilgi/altbilgi (sayfa no, kitap adı vb. tekrarlayan yazılar) varsa temizleyebilirsin, ancak asıl içeriğe ve paragraflara DOKUNMA.
3. Uygun Markdown başlıkları (#, ##, ###), listeler (- veya 1.), kalınlaştırmalar (**kelime**) kullan. Tablo benzeri veriler varsa Markdown tablolarına çevir.
4. Sadece çevrilmiş markdown metnini ver, giriş veya kapanış cümlesi (ör: "İşte metin", "Tamamdır") KESİNLİKLE YAZMA.
\n\nHAM METİN:\n${chunkText}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    };

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
        body,
        { headers: { "Content-Type": "application/json" }, timeout: 300000 }
      );
      
      const markdownChunk = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return markdownChunk.trim();
    } catch (e: any) {
      console.error(`[PDF_ENGINE] Chunk ${i + 1} dönüşüm hatası:`, e.response?.data || e.message);
      // Hata durumunda veri kaybını önlemek için ham metni markdown formatında ekle
      return chunkText;
    }
  });

  // Tüm chunkların tamamlanmasını bekle
  const markdownResults = await Promise.all(promises);

  return markdownResults.join("\n\n---\n\n");
}

// 👁️ GÖRSEL MULTIMODAL BÖLÜMLEYİCİ: PDF'i görsel olarak inceleyip bölümleri sıfır hata ile gruplar
export async function detectSectionsMultimodal(
  fileUri: string,
  apiKey: string
): Promise<Array<{ title: string; pageStart: number; pageEnd: number }>> {
  const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }
  const body = {
    contents: [
      {
        parts: [
          { fileData: { mimeType: "application/pdf", fileUri: fileUri } },
          {
            text: `
Ekteki PDF kitabını görsel olarak incele. 
Bu kitaptaki tüm ana bölümleri/üniteleri, başlangıç ve bitiş sayfalarını ve bölüm başlıklarını bul.

ÇOK ÖNEMLİ KURALLAR:
1. FİZİKSEL SAYFA NUMARALARI (ÇOK KRİTİK): Bana İçindekiler Tablosunun (TOC) bulunduğu sayfayı SAKIN VERME! İçindekiler tablosu genelde ilk 10 sayfadadır. Sen bana bölümün GERÇEKTE BAŞLADIĞI FİZİKSEL (MUTLAK) SAYFA İNDEKSİNİ vereceksin. Örneğin "Sayfa 103" yazan sayfa, PDF'in 115. fiziksel sayfası olabilir. Lütfen kitabın asıl içeriğinin başladığı gerçek mutlak sayfa sırasını hesapla ve onu ver! Her bölüm için "pageStart" değeri GİDEREK ARTMALIDIR, asla aynı sayfa (örnek: 4) olamaz!
2. EKSİKSİZLİK: "Kısaltmalar", "Tanımlar" veya "Kavramlar" gibi sınav için kritik olan başlıklar varsa, bunları da mutlaka ayrı bir bölüm olarak listeye dahil et, asla atlama. ANCAK "Kaynakça" veya "Kaynaklar" gibi referans bölümlerini ASLA LİSTEYE ALMA, tamamen yoksay ve sil!
3. TEMİZ BAŞLIK: Başlıklara ASLA "(Bölüm 3/20)" gibi bölüm numarası veya parantez içi sayaçlar EKLEME. "Ünite 1" gibi genel başlıklar kullanma, direkt konunun öz adını yaz (Örn: "Bilgi Güvenliği Yönetimi").

Sadece aşağıdaki JSON array formatında çıktı ver (başka hiçbir şey yazma):
[
  {"title": "Bölüm Başlığı", "pageStart": 15, "pageEnd": 25}
]
`
          }
        ]
      }
    ],
    generationConfig: { temperature: 0.2 }
  }

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
    body,
    { headers, timeout: 300000 }
  )
  const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]"
  try {
    // Markdown code block varsa içini al
    let cleaned = raw.trim()
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      cleaned = match[1].trim()
    }
    return JSON.parse(cleaned)
  } catch {
    const match = raw.match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) : []
  }
}

// 🧠 METİN TABANLI AI YEDEĞİ: Görsel AI API kotalarına takılırsa, içindekiler tablosunu düz metinden çıkarır.
export async function detectSectionsTextAI(
  pageTexts: string[],
  apiKey: string
): Promise<Array<{ title: string; pageStart: number; pageEnd: number }>> {
  // Tüm kitabı veriyoruz, Gemini 1.5/2.5 Flash 1M token destekler. 121 sayfa çerez kalır.
  const tocText = pageTexts.map((t, i) => `--- SAYFA ${i + 1} ---\n${t}`).join("\n\n");

  const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }
  const body = {
    contents: [
      {
        parts: [
          {
            text: `
Aşağıda BİR KİTABIN TAMAMININ saf metin dökümü verilmiştir. Metnin içinde her sayfanın başında "--- SAYFA X ---" şeklinde fiziksel sayfa etiketleri vardır.

Senin görevin kitabın İÇİNDEKİ TÜM ANA BÖLÜMLERİ/ÜNİTELERİ ve bunların GERÇEK FİZİKSEL başlangıç/bitiş sayfalarını çıkarmaktır.

HATA YAPMAMAK İÇİN ŞU ADIMLARI İZLE:
ADIM 1: "İçindekiler" tablosuna bak ve ana başlıkları tespit et.
ADIM 2: İçindekiler tablosunda yazan (sağ alttaki) matbaa numaralarını KESİNLİKLE ÇÖPE AT! Asla kullanma!
ADIM 3: Tespit ettiğin her başlığı, KİTABIN ASIL METNİ İÇİNDE (ilerleyen sayfalarda) ara.
ADIM 4: Başlığı asıl metinde bulduğunda, o başlığın tam üstünde yazan "--- SAYFA X ---" etiketindeki X numarasını o bölümün "pageStart" değeri olarak kabul et.

ÇOK ÖNEMLİ KURALLAR:
1. "Kısaltmalar", "Tanımlar", "Kavramlar" gibi başlıkları mutlaka dahil et. ANCAK "Kaynakça" veya "Kaynaklar" gibi referans bölümlerini ASLA LİSTEYE ALMA, yoksay!
2. Başlıklara "(Bölüm 3/20)" gibi sayaçlar veya "Ünite 1" gibi ekler KOYMA.
3. TÜM KİTABI son sayfasına kadar tara.

Sadece aşağıdaki JSON array formatında çıktı ver (başka hiçbir şey yazma):
[
  {"title": "Kısaltmalar", "pageStart": 7, "pageEnd": 10},
  {"title": "Üçüncü Taraflarla İletişim Güvenliği", "pageStart": 113, "pageEnd": 118}
]

KAYNAK METİN:
${tocText}
`
          }
        ]
      }
    ],
    generationConfig: { temperature: 0.1 }
  }

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
    body,
    { headers, timeout: 300000 }
  )
  const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]"
  try {
    let cleaned = raw.trim()
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      cleaned = match[1].trim()
    }

    let sections: Array<{ title: string; pageStart: number; pageEnd: number }> = JSON.parse(cleaned)

    // YZ halüsinasyonlarını engellemek için sadece başlık temizliği yapıyoruz, sayfalara dokunmuyoruz
    for (let i = 0; i < sections.length; i++) {
      // 1. "1.", "1.2 ", "Bölüm 1 - " gibi saçma önekleri temizle
      let cleanTitle = sections[i].title.replace(/^(Bölüm|Ünite|Kısım)?\s*\d+[\.\-\:]?\s*/i, "").trim()
      sections[i].title = cleanTitle
    }

    // 3. pageEnd değerlerini düzelt (Bir sonraki bölümün başlangıcından 1 çıkararak)
    for (let i = 0; i < sections.length; i++) {
      if (i < sections.length - 1) {
        sections[i].pageEnd = Math.max(sections[i].pageStart, sections[i + 1].pageStart - 1)
      } else {
        sections[i].pageEnd = pageTexts.length // Son bölüm kitabın sonuna kadar gider
      }
    }

    return sections
  } catch (e) {
    console.error("[TextAI Fallback Error] Parse failed:", e)
    const match = raw.match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) : []
  }
}

// 🛡️ GENEL REGEX YEDEĞİ: Tüm AI servisleri çökerse devreye giren Jenerik Bölüm Çıkarıcı
export function extractSectionsRegex(pageTexts: string[]): Array<{ title: string; pageStart: number; pageEnd: number }> {
  const sections: Array<{ title: string; pageStart: number; pageEnd: number }> = [];

  // Akademik dokümanlardaki genel bölüm başlık formatları
  const patterns = [
    /^(\d+)\.\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü\s]{4,60})$/m, // "1. BİLGİ GÜVENLİĞİ", "2. Varlık Yönetimi"
    /^(BÖLÜM|ÜNİTE)\s+(\d+)\s*[:.–-]?\s*([A-ZÇĞİÖŞÜ].{4,60})$/im, // "BÖLÜM 1: GİRİŞ"
    /^([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]{5,60})$/m // "KISALTMALAR", "KAYNAKLAR" (Tamamı büyük harf)
  ];

  let currentSection = null;

  for (let i = 0; i < pageTexts.length; i++) {
    const pageText = pageTexts[i];
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Her sayfanın ilk 5 satırına bak (Bölüm başlıkları genelde sayfa başındadır)
    for (let j = 0; j < Math.min(5, lines.length); j++) {
      const line = lines[j];

      // İçindekiler tablosunu atla (sayfa 1-10 arası çok fazla eşleşme olur)
      if (i < 10 && (line.toUpperCase().includes("İÇİNDEKİLER") || line.toUpperCase().includes("CONTENTS"))) {
        break; // Bu sayfayı atla
      }

      let matchedTitle = null;
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          // Başlık çok uzunsa muhtemelen paragraftır, atla
          if (line.length > 80) continue;

          // Grup yakalamalarına göre başlığı belirle
          if (match.length === 3 && typeof match[1] === "string" && !isNaN(Number(match[1]))) {
            matchedTitle = `${match[1]}. ${match[2].trim()}`;
          } else if (match.length === 4) {
            matchedTitle = `${match[2]}. ${match[3].trim()}`;
          } else {
            matchedTitle = match[1] || match[0];
          }
          break;
        }
      }

      if (matchedTitle) {
        // Eğer aynı başlık zaten varsa veya çok benziyorsa (header/footer tekrarı), ekleme
        const isDuplicate = sections.some(s => s.title.toUpperCase() === matchedTitle?.toUpperCase());

        if (!isDuplicate) {
          // Önceki bölümün bitiş sayfasını ayarla
          if (currentSection) {
            currentSection.pageEnd = i; // Önceki bölüm bu sayfadan önce bitti
          }

          currentSection = {
            title: matchedTitle,
            pageStart: i + 1,
            pageEnd: pageTexts.length // Şimdilik sonuna kadar
          };
          sections.push(currentSection);
          break; // Bu sayfada başlık bulduk, diğer satırlara bakmaya gerek yok
        }
      }
    }
  }

  // Eğer hiçbir bölüm bulunamadıysa fallback olarak tüm PDF'i tek bölüm yap
  if (sections.length === 0) {
    sections.push({
      title: "Ana Metin",
      pageStart: 1,
      pageEnd: pageTexts.length
    });
  }

  return sections;
}

function parseTitleArrayFromAi(raw: string): string[] {
  try {
    let cleaned = raw.trim()
    const block = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (block) cleaned = block[1].trim()
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string" && t.trim().length >= 2)
    }
  } catch {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (Array.isArray(parsed)) {
          return parsed.filter((t): t is string => typeof t === "string" && t.trim().length >= 2)
        }
      } catch { /* ignore */ }
    }
  }
  return []
}

const TITLES_ONLY_PROMPT = `
Kitabın İÇİNDEKİLER (TOC) bölümünden TÜM ANA BÖLÜM/ÜNİTE başlıklarını sırayla çıkar.

KURALLAR:
1. SADECE başlık listesi ver — sayfa numarası ASLA verme.
2. "Kısaltmalar", "Tanımlar", "Kavramlar" varsa dahil et.
3. "Kaynakça", "Kaynaklar", "Önsöz", "İçindekiler" ASLA dahil etme.
4. Başlıklara "(Bölüm 3/20)" gibi sayaç ekleme; kitaptaki gerçek adı yaz.
5. Numaralı bölümlerde "1. Bilgi Güvenliği Yönetimi" formatını koru.

Sadece JSON string array döndür:
["Kısaltmalar", "1. Bilgi Güvenliği Yönetimi", "2. Varlık Yönetimi"]
`

/** AI yalnızca başlık listesi döndürür — sayfa numarası güvenilmez, kullanılmaz */
export async function detectSectionTitlesOnlyTextAI(
  tocSnippet: string,
  apiKey: string,
  logContext?: { courseSlug?: string | null }
): Promise<string[]> {
  const model = "gemini-2.5-flash"
  const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }
  const body = {
    contents: [
      {
        parts: [
          {
            text: `${TITLES_ONLY_PROMPT}\n\nKAYNAK METİN (içindekiler bölgesi):\n${tocSnippet}`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.1 },
  }

  const started = Date.now()
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      body,
      { headers, timeout: 180000 }
    )
    const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]"
    await logDirectGeminiApiCall({
      apiKey,
      model,
      operation: "section_titles_text",
      stage: "section_detect",
      courseSlug: logContext?.courseSlug ?? null,
      status: "SUCCESS",
      durationMs: Date.now() - started,
    })
    return parseTitleArrayFromAi(raw)
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string }
    const status = err.response?.status === 429 ? "RATE_LIMIT_429" : err.response?.status === 403 ? "FORBIDDEN_403" : `HTTP_${err.response?.status ?? "ERR"}`
    await logDirectGeminiApiCall({
      apiKey,
      model,
      operation: "section_titles_text",
      stage: "section_detect",
      courseSlug: logContext?.courseSlug ?? null,
      status,
      errorDetail: (err.message || "section_titles_text failed").substring(0, 500),
      durationMs: Date.now() - started,
    })
    throw e
  }
}

/** Multimodal: PDF'ten yalnızca başlık listesi */
export async function detectSectionTitlesOnlyMultimodal(
  fileUri: string,
  apiKey: string,
  logContext?: { courseSlug?: string | null }
): Promise<string[]> {
  const model = "gemini-2.5-flash"
  const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }
  const body = {
    contents: [
      {
        parts: [
          { fileData: { mimeType: "application/pdf", fileUri } },
          { text: TITLES_ONLY_PROMPT },
        ],
      },
    ],
    generationConfig: { temperature: 0.1 },
  }

  const started = Date.now()
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      body,
      { headers, timeout: 300000 }
    )
    const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]"
    await logDirectGeminiApiCall({
      apiKey,
      model,
      operation: "section_titles_multimodal",
      stage: "section_detect",
      courseSlug: logContext?.courseSlug ?? null,
      status: "SUCCESS",
      durationMs: Date.now() - started,
    })
    return parseTitleArrayFromAi(raw)
  } catch (e: unknown) {
    const err = e as { response?: { status?: number }; message?: string }
    const status = err.response?.status === 429 ? "RATE_LIMIT_429" : err.response?.status === 403 ? "FORBIDDEN_403" : `HTTP_${err.response?.status ?? "ERR"}`
    await logDirectGeminiApiCall({
      apiKey,
      model,
      operation: "section_titles_multimodal",
      stage: "section_detect",
      courseSlug: logContext?.courseSlug ?? null,
      status,
      errorDetail: (err.message || "section_titles_multimodal failed").substring(0, 500),
      durationMs: Date.now() - started,
    })
    throw e
  }
}
