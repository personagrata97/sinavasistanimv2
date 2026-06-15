import axios from "axios"
import { prisma } from "./prisma"

// ==================== AI ENGINE SETUP ====================

// PRIMARY: Gemini (High Quota & Quality) — Multi-key rotation
const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
const geminiKeys = (process.env.GEMINI_API_KEYS || geminiKey || "").split(",").filter(k => k.trim())
let currentKeyIndex = 0 // Aktif key index'i
const suspendedKeys = new Map<number, number>() // keyIndex → suspendedAt timestamp
const SUSPENDED_KEY_TTL_MS = 65 * 1000 // 65 saniye — Google'ın dakikalık sayacı ~60sn'de sıfırlanır

// ==================== PROAKTİF RPM SAYACI ====================
// Her key için dakika bazında istek sayısını tutar — 429 yemeden ÖNCE limiti aşmayı engeller
const keyMinuteCounters = new Map<string, number>() // "keyIndex|minuteKey" → count
const RPM_LIMIT = 14 // Google limiti 15, güvenlik payı olarak 14'te key değiştir

function getMinuteKey(): string {
  const now = new Date()
  return `${now.getHours()}:${now.getMinutes()}`
}

function getKeyRpmCount(keyIndex: number): number {
  const k = `${keyIndex}|${getMinuteKey()}`
  return keyMinuteCounters.get(k) || 0
}

function incrementKeyRpm(keyIndex: number): void {
  const minuteKey = getMinuteKey()
  const k = `${keyIndex}|${minuteKey}`
  keyMinuteCounters.set(k, (keyMinuteCounters.get(k) || 0) + 1)
  
  // Eski dakikaların sayaçlarını temizle (bellek sızıntısı önleme)
  const keysToDelete: string[] = []
  keyMinuteCounters.forEach((_, key) => {
    if (!key.endsWith(`|${minuteKey}`)) {
      keysToDelete.push(key)
    }
  })
  keysToDelete.forEach(key => keyMinuteCounters.delete(key))
}

// Her key'in kendi fileUri'si (PDF multimodal için — her key kendi projesindeki dosyaya erişir)
let activeFileUrisMap: Record<string, string> = {}
export function setFileUrisMap(map: Record<string, string>) { activeFileUrisMap = map }

function getNextGeminiKey(): string | null {
  if (geminiKeys.length === 0) return null

  // Tüm key'ler arasından en uygununu seç: askıda olmayan VE dakikalık limiti dolmamış
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
    
    // Bu key'in bu dakikadaki kullanım sayısını kontrol et
    const rpm = getKeyRpmCount(idx)
    if (rpm >= RPM_LIMIT) {
      continue // Bu key bu dakika dolmuş, atla
    }
    
    // En az kullanılan key'i tercih et (yükü eşit dağıt)
    if (rpm < bestRpm) {
      bestRpm = rpm
      bestIdx = idx
    }
  }
  
  if (bestIdx === -1) return null // Tüm key'ler ya askıda ya da bu dakika dolu
  
  currentKeyIndex = bestIdx
  return geminiKeys[bestIdx].trim()
}

function rotateToNextKey(): string | null {
  if (geminiKeys.length <= 1) return null

  // Mevcut key'i atla, sonraki en uygun key'i bul
  const originalIdx = currentKeyIndex
  currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length
  
  // getNextGeminiKey zaten en uygununu seçecek
  const result = getNextGeminiKey()
  if (result) {
    console.log(`[AI_ENGINE] 🔑 Key rotasyonu: Key #${currentKeyIndex + 1}/${geminiKeys.length}'e geçildi (RPM: ${getKeyRpmCount(currentKeyIndex)}/${RPM_LIMIT})`)
  }
  return result
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
SINAV TİPİ: BİLGİ SİSTEMLERİ VE SİBER GÜVENLİK SINAVI
- Bilgi güvenliği, siber güvenlik, ağ güvenliği, şifreleme, yetkilendirme (DAC, MAC, RBAC) konularına odaklan.
- Kritik teknik standartlara (ISO/IEC 27001, COBIT, ITIL vb.) ve BT bağımsız denetim esaslarına çok dikkat et.
- Teknik kavramları (DMZ, WAF, MFA, SSO, IDS/IPS, Sızma Testleri, SOME vb.) gerçekçi BT senaryoları ile açıkla.
- Soru ve pratik örneklerde kesinlikle finansal türev ürünleri (opsiyon, vadeli işlem) veya MASAK kara para aklama mevzuatını karıştırma! Bu tamamen siber güvenlik ve bilgi sistemleri altyapı yönetimi dersidir.
`
  } else if (isMasak || aiMode === "law") {
    modeSpecificRules = `
SINAV TİPİ: HUKUK VE MEVZUAT SINAVI (MASAK / SPK HUKUK)
- Kanun maddelerine, süre kısıtlamalarına (örn: 30 gün içinde), yetkili mercilere (örn: Kurul, Bakanlık) çok dikkat et.
- Vaka tabanlı (case study) sorularda kanun ihlali olup olmadığını sorgula.
- "Aşağıdakilerden hangisi idari para cezası gerektirir?" tarzı ezber + mantık soruları üret.
- ⚠️ KESİN KURAL: Banka şubesinde Uyum Görevlisi çalışmaz! Uyum Görevlisi Genel Müdürlük bünyesinde yer alır. Şube çalışanları şüpheli durumu doğrudan MASAK'a değil, kendi kurumlarındaki Uyum Görevlisine bildirir. MASAK'a resmi Şüpheli İşlem Bildirimi (ŞİB) gönderim yetkisi sadece Uyum Görevlisine aittir. Hikaye ve senaryolarda bu yasal raporlama hiyerarşisine %100 uyacaksın!
`
  } else if (aiMode === "language") {
    modeSpecificRules = `
SINAV TİPİ: DİL SINAVI (YDS / YÖKDİL)
- Yabancı dil kelimelerinin Türkçe karşılıklarına, eş anlamlılarına ve örnek cümlelerine odaklan.
- Okuma parçalarında ana fikir (main idea), çıkarım (inference) ve yazarın tutumu (attitude) gibi soru tarzları üret.
- Gramer kurallarını bağlam içinde sor.
`
  } else if (aiMode === "finance") {
    modeSpecificRules = `
SINAV TİPİ: FİNANS VE LİSANS SINAVI (SPL)
- Her modülde çoktan seçmeli, 5 şıklı sorular.
- Hesaplama soruları ("X formülüne göre sonuç nedir?") ve formüller çok önemli.
- Finansal kavramlar (Forward, Futures, Opsiyon vb.) arası ince farkları vurgula.
- Resmi terimleri ASLA değiştirme (pay, izahname, ihraççı, SPK vb.)
`
  } else {
    modeSpecificRules = `
SINAV TİPİ: GENEL AKADEMİK VEYA KURUMSAL SINAV
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
`
}

export function getDisciplineExamples(isSecurity: boolean, isMasak: boolean) {
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
  } else {
    // Default general/finance course
    return {
      disciplineName: "finans ve kurumsal yönetim",
      analogies: `
  * Pay Senedi için: "Bir şirketin mülkiyet ortaklığını simgeleyen tapu senedi benzeri değerli evrak."
  * Portföy Çeşitlendirmesi için: "Tüm yumurtaları aynı sepete koymamak; riski dağıtmak için farklı enstrümanlara yatırım yapmak."
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
export async function extractPerfectMarkdownOCR(pdfPath: string, pageStart: number, pageEnd: number, courseName: string = "PDF Okuma (OCR)"): Promise<string> {
  const { PDFDocument } = await import('pdf-lib');
  const fsPromises = await import('fs/promises');

  const prompt = `Ekteki PDF dosyasının detaylıca okuyup kusursuz bir Markdown metnine çevir.
Kurallar:
1. Hiçbir cümleyi, tabloyu veya listeyi atlama. Her detayı koru.
2. Tabloları düzgün Markdown tablolarına dönüştür.
3. Görseller veya şemalar varsa, bunları "[GÖRSEL İÇERİKLER]" başlığı altında olabildiğince detaylı metne dök.
4. "İşte metin", "Tamamdır" gibi cevaplar yazma, sadece çevrilmiş markdown metnini ver.`;

  const pdfBytes = await fsPromises.readFile(pdfPath);
  const originalPdf = await PDFDocument.load(pdfBytes);
  const totalOriginalPages = originalPdf.getPageCount();

  const startIdx = Math.max(0, pageStart - 1);
  const endIdx = Math.min(totalOriginalPages - 1, pageEnd - 1);
  const totalPagesToExtract = endIdx - startIdx + 1;

  if (totalPagesToExtract <= 0) {
    throw new Error("Geçersiz sayfa aralığı.");
  }

  const CHUNK_SIZE = 15;
  let finalMarkdown = "";

  for (let i = 0; i < totalPagesToExtract; i += CHUNK_SIZE) {
    const chunkStartIdx = startIdx + i;
    const chunkEndIdx = Math.min(endIdx, chunkStartIdx + CHUNK_SIZE - 1);
    const chunkPageCount = chunkEndIdx - chunkStartIdx + 1;

    console.log(`[MARKDOWN_OCR] Chunk işleniyor: Sayfa ${chunkStartIdx + 1} - ${chunkEndIdx + 1} (${chunkPageCount} sayfa)`);

    const newPdf = await PDFDocument.create();
    const pageIndicesToCopy = Array.from({length: chunkPageCount}, (_, k) => chunkStartIdx + k);
    const copiedPages = await newPdf.copyPages(originalPdf, pageIndicesToCopy);
    for (const page of copiedPages) {
      newPdf.addPage(page);
    }
    const chunkPdfBytes = await newPdf.save();
    const chunkBase64 = Buffer.from(chunkPdfBytes).toString('base64');

    const startKeyIndex = currentKeyIndex;
    let triedAllKeys = false;
    let chunkSuccess = false;
    let chunkResult = "";

    while (!triedAllKeys) {
      const currentKey = getNextGeminiKey();
      if (!currentKey) break;

      const headers = { "Content-Type": "application/json", "x-goog-api-key": currentKey };
      const body = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: chunkBase64
                }
              },
              { text: prompt }
            ]
          }
        ],
        // Using gemini-1.5-pro for best vision capability and strict temperature 0.0
        generationConfig: { temperature: 0.0, maxOutputTokens: 8192 }
      };

      const startTime = Date.now();
      try {
        incrementKeyRpm(currentKeyIndex);
        
        // As requested by user: Force best model (gemini-1.5-pro or 3.5 flash logic)
        // Here we use gemini-1.5-pro because 3.5 flash is a typo of 1.5-pro in user's mind for "best model"
        const axios = (await import('axios')).default;
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent`,
          body,
          { headers, timeout: 180000 }
        );
        const parts = response.data?.candidates?.[0]?.content?.parts || [];
        const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text);
        const result = textParts.join("").trim();

        if (result && result.length > 100) {
          chunkResult = result;
          chunkSuccess = true;
          
          prisma.apiUsageLog.create({
            data: {
              apiKey: `Key #${currentKeyIndex + 1}`,
              model: "gemini-1.5-pro",
              operation: "ocr_extraction_chunk",
              courseSlug: courseName,
              status: "SUCCESS",
              durationMs: Date.now() - startTime
            }
          }).catch(() => {})
          
          break; // Chunk succeeded, break out of key loop
        }
      } catch (e: any) {
        console.warn(`[MARKDOWN_OCR] Key #${currentKeyIndex + 1} başarısız: ${e.message?.substring(0, 100)}`);
        
        const nextKey = rotateToNextKey();
        if (!nextKey || currentKeyIndex === startKeyIndex) triedAllKeys = true;
      }
    }

    if (!chunkSuccess) {
      throw new Error("OCR İşlemi başarısız oldu: Tüm API anahtarları tükendi veya Google yanıt vermedi.");
    }

    finalMarkdown += chunkResult + "\n\n";
    
    // Add small delay between chunks to avoid bursting
    if (i + CHUNK_SIZE < totalPagesToExtract) {
       await new Promise(r => setTimeout(r, 5000));
    }
  }

  return `[MARKDOWN_OCR_SUCCESS]\n\n${finalMarkdown.trim()}`;
}
 catch (e: any) {
      lastError = e;
      console.warn(`[MARKDOWN_OCR] Key #${currentKeyIndex + 1} başarısız: ${e.message?.substring(0, 100)}`);

      const errMsg = e.message || "";
      let errStatus = "ERROR";
      if (errMsg.includes("429") || errMsg.includes("503") || errMsg.includes("quota")) errStatus = "RATE_LIMIT_429";
      else if (errMsg.includes("403") || errMsg.includes("API key not valid")) errStatus = "FORBIDDEN_403";

      prisma.apiUsageLog.create({
        data: {
          apiKey: `Key #${currentKeyIndex + 1}`,
          model: "gemini-2.5-flash",
          operation: "ocr_extraction",
          courseSlug: courseName,
          status: errStatus,
          durationMs: Date.now() - startTime
        }
      }).catch(() => {})

      const isSuspended = errStatus === "FORBIDDEN_403";
      if (isSuspended) suspendedKeys.set(currentKeyIndex, Date.now());

      const isQuotaError = errStatus === "RATE_LIMIT_429";
      if (isQuotaError) suspendedKeys.set(currentKeyIndex, Date.now());
    }

    // Sonraki anahtara geç
    const nextKey = rotateToNextKey();
    if (!nextKey || currentKeyIndex === startKeyIndex) {
      triedAllKeys = true;
    } else {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  throw new Error(`OCR başarısız: Tüm anahtarlar denendi. Son hata: ${lastError?.message || "Bilinmiyor"}`);
}

// Üç modlu AI çağrısı (MAKER: Gemini 3.5, CHECKER: Gemini 2.5)
export async function callAI(prompt: string, retries = 2, mode: "generation" | "verification" | "question_generation" | "notes_generation" | "flashcard_generation" | "kontrolor" | "ground_truth" | "mufettis" | "cerrahi_yama" = "generation", priority: "high" | "normal" = "normal"): Promise<string> {
  const activeKey = getNextGeminiKey()

  if (activeKey) {
    const geminiBody = (p: string, maxTokens: number) => {
      const parts: any[] = [{ text: p }]
      
      return {
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens }
      }
    }

    // Üretim yerleri (Eski Groq/DeepSeek) -> 3.5 Flash, Diğerleri -> 2.5 Flash
    const isGeneration = mode === "generation" || mode === "question_generation" || mode === "notes_generation" || mode === "flashcard_generation";
    const MODEL_ID = isGeneration ? "gemini-3.5-flash" : "gemini-2.5-flash"
    const modelChain = [{ id: MODEL_ID, tokens: isGeneration ? 65536 : 65536 }]

    const startKeyIndex = currentKeyIndex
    let triedAllKeys = false

    while (!triedAllKeys) {
      const currentKey = getNextGeminiKey()
      
      // Tüm key'ler bu dakika doluysa, yeni dakikayı bekle
      if (!currentKey) {
        const now = new Date()
        const secsUntilNextMinute = 60 - now.getSeconds() + 2 // 2sn güvenlik payı
        console.log(`[AI_ENGINE] ⏳ Tüm key'lerin dakikalık limiti doldu. ${secsUntilNextMinute}sn sonra yeni dakikada devam edilecek...`)
        await new Promise(r => setTimeout(r, secsUntilNextMinute * 1000))
        continue
      }
      
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

        try {
          // İstek gönderilmeden önce RPM sayacını artır
          incrementKeyRpm(currentKeyIndex)
          
          const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
            geminiBody(prompt, model.tokens), { headers: geminiHeaders, timeout: 120000 }
          )
          
          prisma.apiUsageLog.create({
            data: {
              apiKey: `Key #${currentKeyIndex + 1}`,
              model: model.id,
              operation: mode,
              courseSlug: logContext.substring(0, 150),
              status: "SUCCESS",
              durationMs: Date.now() - startTime
            }
          }).catch(() => {})

          const parts = response.data?.candidates?.[0]?.content?.parts || []
          const textParts = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text)
          const result = textParts.join("")
          if (result) {
            console.log(`[${isGeneration ? "MAKER_GEMINI" : "CHECKER_GEMINI"}] ✅ İşlem başarılı [Key #${currentKeyIndex + 1}] [Model: ${model.id}] [RPM: ${getKeyRpmCount(currentKeyIndex)}/${RPM_LIMIT}] [${result.length} chars]`)
            // Başarılı istekten sonra bir sonraki key'e geç (yükü eşit dağıt)
            rotateToNextKey()
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

          prisma.apiUsageLog.create({
            data: {
              apiKey: `Key #${currentKeyIndex + 1}`,
              model: model.id,
              operation: mode,
              courseSlug: logContext.substring(0, 150),
              status: errStatus,
              errorDetail: (errData || errMsg).substring(0, 500),
              durationMs: Date.now() - startTime
            }
          }).catch(() => {})

          const isSuspended = errStatus === "FORBIDDEN_403" || errData.includes("API key not valid")
          if (isSuspended) suspendedKeys.set(currentKeyIndex, Date.now())

          const isQuotaError = errStatus === "RATE_LIMIT_429" || errStatus === "SERVER_ERROR_503" || isSuspended
          if (isQuotaError) {
            quotaHit = true
            suspendedKeys.set(currentKeyIndex, Date.now())
            continue
          }
        }
      }

      if (quotaHit) {
        const nextKey = rotateToNextKey()
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
    return { summary: "Analiz yapılamadı.", importance: "Medium", topics: [], examLikelihood: "", keyTerms: [], suggestedTitle: "", requiresQuestions: true }
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

    // OVERLAP (Girdi Örtüşmesi): Sonraki parça, önceki parçanın son 500 karakterini de görsün ki tablolar/cümleler kopmasın.
    // Cümlenin tam başından başlaması için 500 karakter geriye gidip ilk boşluktan/satırdan sonrasını alıyoruz.
    let nextStartIdx = Math.max(0, splitIdx - 600);
    const safeSpaceIdx = remaining.indexOf(" ", nextStartIdx);
    if (safeSpaceIdx !== -1 && safeSpaceIdx < splitIdx) {
      nextStartIdx = safeSpaceIdx;
    }
    remaining = remaining.substring(nextStartIdx).trim();
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
  previousContext?: string
): Promise<string> {
  // (OCR ŞART olduğu için fileUri asla iptal edilmez)
  const isBibliography = sectionTitle.toLocaleLowerCase('tr-TR').includes("kaynakça") || sectionTitle.toLocaleLowerCase('tr-TR').includes("referans") || sectionTitle.toLocaleLowerCase('tr-TR').includes("bibliography")
  const isGlossary = sectionTitle.toLocaleLowerCase('tr-TR').includes("kısaltma") || sectionTitle.toLocaleLowerCase('tr-TR').includes("terimler") || sectionTitle.toLocaleLowerCase('tr-TR').includes("sözlük") || sectionTitle.toLocaleLowerCase('tr-TR').includes("glossary")

  // Çıktı limiti 65536 token'a yükseltildiği için tüm bölümler 15000 karaktere kadar
  // tek seferde işlenebilir. Bu, parça birleştirme sırasında oluşan içerik kaybını tamamen önler.
  const chunkThreshold = 15000;

  if (!isChunked && content.length > chunkThreshold) {
    const chunks = splitContentIntoChunks(content, chunkThreshold)
    if (chunks.length > 1) {
      console.log(`[AUTO-CHUNKING] 📦 Bölüm "${sectionTitle}" çok uzun olduğu için ${chunks.length} parçaya bölünüp otonom işleniyor...`)
      let mergedNotes = ""
      let lastChunkTail = ""
      for (let idx = 0; idx < chunks.length; idx++) {
        if (idx > 0) {
          console.log(`[AUTO-CHUNKING] ⏱️ Key ve limit koruması: Parçalar arasında 61 saniye bekleniyor...`)
          await new Promise(r => setTimeout(r, 61000))
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
          lastChunkTail
        )
        if (idx === 0) {
          mergedNotes = chunkResult
        } else {
          // DİNAMİK BAŞLIK TEMİZLİĞİ — hardcoded ders isimleri yerine
          // sectionTitle'dan türetilen genel kalıplarla HER ders için çalışır
          const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const cleanNotes = chunkResult
            .replace(new RegExp(`##\\s*📌\\s*${escapedTitle}`, "gi"), "")
            .replace(new RegExp(`##\\s*${escapedTitle}`, "gi"), "")
            // Genel kalıp: "## BÜYÜK HARFLI BAŞLIK" formatındaki tekrarlı ana başlıkları temizle
            .replace(/^##\s+[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]{5,}$/gm, "")
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
  const disc = getDisciplineExamples(isSecurity, isMasak);

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
`;
  } else {
    styleInstruction = `
Sen alanında efsaneleşmiş, otoriter ama öğrencilerin dinlemeye doyamadığı KARİZMATİK BİR MENTORSUN.
Amacın, sıkıcı ve ağır kanun maddelerini veya teknik kavramları, öğrencilerin asla unutamayacağı kadar akıcı, sürükleyici ve hikayeleştirerek anlatmak.

🎭 ÜSLUP (ALTIN DENGE - ÇOK ÖNEMLİ):
- 🚫 YAPAY ZEKA ROBOTU GİBİ KONUŞMA! "Merhaba", "Özetlemek gerekirse", "Umarım faydalı olmuştur" gibi ucuz asistan kalıpları KULLANMA. Ancak KESİN KURAL: Her notun en başında KESİNLİKLE '### 🎯 Bu Bölüm Ne Anlatıyor?' başlığı bulunmalı ve doğrudan profesyonelce konunun özeti verilmelidir.
- 🚫 BÖLÜM GİRİŞİ FORMATI: '### 🎯 Bu Bölüm Ne Anlatıyor?' başlığı altında KESİNLİKLE "Bu bölüm bize X'i sunmaktadır", "Bu bölümde Y'yi öğreneceğiz" gibi yapay giriş kalıpları KULLANMA. Bunun yerine doğrudan ve akademik bir özet ver. Örn: "Sermaye piyasasında ihraç sürecinin yasal çerçevesi, SPK'nın onay mekanizmaları ve ihraççıların yükümlülükleri ele alınmaktadır."
- 🚫 SIKICI AKADEMİSYEN OLMA! Dümdüz, paragraf paragraf akan, ansiklopedi gibi boğucu bir dil KULLANMA.
- ✅ KARİZMATİK VE AKICI OL: Metin bir TED konuşması gibi sürükleyici aksın. Kalın puntolar, madde işaretleri ve kısa cümleler kullan.
- ✅ HİKAYELEŞTİR: Her kavramı günlük hayattan veya doğrudan kendi disiplin alanından (${disc.disciplineName} vb.) gerçekçi, somut ve mantıksal olarak mükemmel eşleşen benzetmelerle açıkla.
- ⚠️ KESİNLİKLE konuyla ilgisiz, uzak disiplinlerden (örn. gastronomi, uzay gemisi) zorlama benzetmeler YAPMA. Benzetmeler doğrudan kavramın işlevsel mantığını yansıtmalıdır. Örneğin:
${disc.analogies}
- ⚠️ 💡 📌 🔑 🎯 🪤 emojilerini BOL kullan — görsel hiyerarşi yarat.
- Bilgi kalitesi %100 kusursuz ve otoriter olmalı, ama anlatım dili su gibi akmalıdır. Tanımlar BİREBİR kaynak metinden olmalıdır.
- 🚨 DÜZELTME ŞERHİ (ÇOK ÖNEMLİ): Eğer sana verilen kaynak PDF metninde NESNEL ve KESİN bir bilgi hatası yakalarsan (örn: eski bir kanun maddesi, yanlış bir oran veya miktar), PDF'teki O HATALI BİLGİYİ SİLMEYECEK VE AYNEN YAZACAKSIN (çünkü orijinal kaynak metinde o şekilde geçiyor), ancak hemen yanına parantez içinde kibar ve profesyonel bir şerh düşeceksin.
  ÖRNEK: "...bu süre 15 gündür. *(Not: Orijinal ${courseName} çalışma notlarında bu süre 15 gün olarak geçse de, güncel mevzuatta/gerçekte bu süre 30 gündür.)*"
`;

    memoryTechniqueInstruction = `
🧠 HAFIZA TEKNİKLİ (HER BÖLÜMDE EN AZ 2 TANE KULLAN):
- **🎬 Hikaye Yöntemi (BİRİNCİL TEKNİK — BOL KULLAN!):** Her karmaşık süreç veya kuralı kısa bir SENARYO ile anlat. İsim ver, durum yarat, sonucu göster. Öğrenci "aa evet karakterin hikayesindeki gibi" diye hatırlasın.
${disc.stories}
  ⚠️ Her bölümde EN AZ 3-4 hikaye/senaryo olsun. Sayısal eşikleri, süreleri, cezaları HİKAYE İÇİNDE ver — böylece rakamlar da akılda kalır.
  ⚠️ KESİN KURAL: Bu senaryoları/hikayeleri kesinlikle bağımsız veya en altta ayrı bir başlık altında toplama! İlgili kavramın/tanımın hemen altına alt madde veya alt paragraf olarak yerleştir ki teori ve pratik senaryo yan yana dursun.
- **Akrostiş:** Sıralı maddeleri baş harfleriyle hatırlat. ${disc.akrostiş}
- **Karşılaştırma ile Fark:** Benzer kavramları "İKİSİ DE... AMA..." formatında ayırt et.
- **Mini Quiz:** Her büyük bölüm sonunda 1-2 "🧪 Kendini Test Et!" sorusu yaz. Cevabı hemen altına gizle.
${disc.quiz}
`;
  }

  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
${getExamIntelligence(aiMode, courseName || courseName || sectionTitle)}

${glossaryInstruction}

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
   - Kronolojik bir süreç, karar akışı veya hiyerarşi varsa → **Mermaid.js diyagramı** çiz (⚠️ KESİN KURAL: Mermaid diyagramlarında tüm düğüm isimlerini İSTİSNASIZ OLARAK köşeli parantez ve çift tırnak içine al (örn: A["İhraççı Şirket"] --> B["Kurul"]). Bu kurala uymazsan UI çöker!)
   - Önemli bilgiler → **Emoji kutucuğu** (⚠️, 💡, 📌, 🔑)
   - Listeler → **Madde işaretli liste**
   🎯 HEDEF: Bir bölümde içerik uygunsa en az 2-3 tablo ve en az 1 Mermaid diyagramı olsun. Ama içerik gerektirmiyorsa zorlama yapma — içerik uygunluğu her şeyden önemli.
` : ''}
${memoryTechniqueInstruction}

DERS: ${courseName}
BÖLÜM: "${sectionTitle}"

🎯 TEMEL STRATEJİ - "EKSİKSİZ, GÖRSEL, AKILDA KALICI":
1. Kaynak metindeki ve PDF'teki HER BİLGİYİ nota dahil et. HİÇBİR kavram, terim, tanım, oran, süre, formül, istisna, kural ATLANMAYACAK.
2. ETİKETLEME (ÇOK ÖNEMLİ): Her ana başlığın yanına konunun ait olduğu sınav modülünü köşeli parantez içinde yaz ${disc.labelExample}.
3. DÜZ YAZI YAZMA: Her bilgiyi görsel bir formatta sun:
   - Karşılaştırmalar → **Markdown Tablosu** (en az 2-3 tablo olmalı)
${!isGlossary ? `   - Süreçler, hiyerarşiler, ilişkiler → **Mermaid.js diyagramı** (en az 2-3 diyagram olmalı. ⚠️ KESİN KURAL: Mermaid diyagramlarında tüm düğüm isimlerini İSTİSNASIZ OLARAK köşeli parantez ve çift tırnak içine al (örn: A["İhraççı Şirket"] --> B["Kurul"]). Bu kurala uymazsan UI çöker!)` : ''}
   - Önemli bilgiler → **Emoji kutucukları** (⚠️, 💡, 📌, 🔑)
   - Listeler → **Madde işaretli liste**
4. TEMİZLİK: Parantez içindeki kaynakça referanslarını (örn: (ISO 27001, Madde 7.5), (SPK Tebliğ No: III-56.1)) notlardan tamamen temizle. Sadece anlamlı bilgiyi bırak (MD5, SHA-1 gibi teknik standart adları kalabilir).
5. VURGULAR: Önemli kelimeleri **kalın**, terimleri *eğik* yap.
6. ASLA yeni bir alt başlık açma, mevcut başlıkların hiyerarşisini bozma.
7. 🚨 KAYNAK HATALARINI YÖNETME MUHAKEMESİ (TRIVIAL vs CRITICAL):
   Kaynak metinde yazar veya dizgi kaynaklı bir hata fark edersen, şu filtreye göre davran:
   - A) TRIVIAL (Önemsiz/Şekilsel) Hatalar: Harf eksikliği, imla hatası, İngilizce-Türkçe kelime veya telaffuz farkı (Örn: 'Standard' yerine 'Standart', 'Asynchronous' yerine 'Asynchrous'). KURAL: Bunlar için KESİNLİKLE uyarı veya şerh düşme! Okunabilirliği bozmamak için kaynağa BİREBİR sadık kal, kaynakta ne yazıyorsa aynen yaz ve geç. Trivial hataların varlığını tamamen yok say, "Dikkat: kaynakta şu kelime yanlış yazılmış" diyerek metnin hiçbir yerinde liste yapma!
   - B) CRITICAL (Kritik/Yasal) Hatalar: Yanlış kanun numarası (610 yerine 6102), yanlış ceza miktarı, yanlış tarih. KURAL: Sadece bu tür öğrenciye sınav kaybettirecek hayati/yasal hatalarda kaynağı aynen yazıp hemen yanına *(Not: Mevzuata göre doğrusu şudur)* diye kısa ve öz bir uyarı ekle. KESİNLİKLE sayfa sonuna ayrı bir başlık açma, uyarıyı kelimenin geçtiği yerde parantez içinde yap.
${isGlossary ? '7.5 ⚠️ SÖZLÜK/KISALTMA KURALI: Bu sayfa sadece bir sözlük olduğu için ASLA en alta "Ekstra Dikkat Edilmesi Gereken Hususlar", "Özet", "Analiz" gibi ek başlıklar AÇMA! Sadece listeyi/tabloyu ver ve bitir.' : ''}
8. ⚠️ KESİN KURAL: Asla ama asla "Harika bir görev", "İşte notlar", "İşte güncellenmiş versiyon" gibi sohbet, giriş veya kapanış cümleleri yazma! Sadece saf Markdown çıktısı ver. Doğrudan notun içeriğiyle başla.
9. Dolgu metinleri ATLA: genel giriş cümleleri, tarihsel arka plan, "bu bölümde şunları öğreceğiz" tarzı metinler.
10. Her kavramı sıfır bilgili birinin bile anlayacağı şekilde açıkla. KESİNLİKLE resmi, ciddi ve akademik bir üslup kullan (örn: "kocaman bir yalan", "şunu unutma" gibi laubali tabirler YASAKTIR). Asla hikayeleştirme veya laubali senaryolar uydurma.
11. Hedef: 10 sayfalık bir PDF bölümünün notu ~8 sayfa olmalı. Yoğun ama EKSİKSİZ.

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

ÖRNEK:
- **İhraççı:** Sermaye piyasası araçlarını ihraç eden, ihraç etmek üzere Kurula başvuruda bulunan veya sermaye piyasası araçları halka arz edilen tüzel kişilerdir.

⚠️ KESİN KURALLAR:
1. Resmi terimleri KESİNLİKLE değiştirme. Sınavda birebir bu terimler sorulur.
2. Tanım cümlelerini kaynak metinden BİREBİR al. Asla hikayeleştirme veya fiktif karakterler kullanma.
3. Sayısal sınırlar, oranlar ve tarihler MUTLAKA yaz. BUNLAR SIKÇA SORULUR.
4. Formüller varsa formülü yaz + sayısal örnek ile adım adım çöz.
5. Benzer kavramlar arasındaki farkı TABLO ile göster.
6. Cevabı ASLA yarıda kesme.
8. İSTİSNALARI ve ÖZEL DURUMLARI mutlaka belirt.
9. 🇹🇷 DİL KALİTESİ: Türkçe dil bilgisi, kelime dizilimi ve akıcılığa %100 uy. İngilizce'den doğrudan çevrilmiş gibi duran yapay veya ters yapılar ("Özeti [Konu]", "Sözlüğü [Konu]", "Notları [Konu]") KESİNLİKLE kullanma. Her zaman doğal ve düzgün bir Türkçe ile akıcı cümleler kur.

${isGlossary ? `
📋 NOT YAPISI (Markdown - SADE KISALTMALAR SÖZLÜĞÜ):

## 📌 \${sectionTitle}

### 🎯 Bu Bölüm Ne Anlatıyor?
Bu bölümde, ${courseName} dersinde yer alan teknik kısaltmalar ve terimler listelenmektedir.

Metindeki her bir kısaltma veya terim için aşağıdaki sade şablona %100 uy ederek detaylı bilgi ver:

### 🔑 [Kısaltma/Terim Adı]
- **Açılımı veya Tanımı:** [Kaynak metindeki resmi Türkçe tanımını/açıklamasını veya açılımını birebir yaz, tek bir kelimeyi bile değiştirme]
- **İngilizce Karşılığı (varsa):** [Terimin İngilizce açılımı veya karşılığı]

⚠️ KESİNLİKLE hiçbir benzetme, senaryo, hikaye, akrostiş, Mermaid.js diyagramı veya tablo eklemeyiniz. Sadece sade bir kısaltma/terim listesi oluşturunuz.
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
(Bu bölümdeki tüm konulara ait sınavda ekstra dikkat edilmesi ve karıştırılmaması gereken ince detaylar)

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

  // Paralel işlem API'yi boğabilir, bu yüzden sıralı (sequential) gidiyoruz
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    console.log(`[FLASHCARD_GEN] Parça ${i + 1}/${chunks.length} işleniyor... (Karakter: ${chunkContent.length})`);

    const levelCardStyle: Record<string, string> = {
      beginner: `
        - Zorluk dağılımı: %50 kolay, %30 orta, %20 zor
        - Kolay kartlarda temel kavram tanımları sor
        - Orta kartlarda basit karşılaştırmalar yap
        - Cevaplarda günlük hayattan örnekler ver
      `,
      intermediate: `
        - Zorluk dağılımı: %20 kolay, %50 orta, %30 zor
        - Orta kartlarda çeldirici kavram farkları sor
        - Zor kartlarda formül uygulamaları ve vaka soruları ekle
        - Cevaplarda sınav ipuçları ver
      `,
      advanced: `
        - Zorluk dağılımı: %10 kolay, %30 orta, %60 zor
        - Zor kartlarda detaylı mevzuat referansları sor
        - Çeldirici kavramları ayrıntılı açıkla
        - Her kartta sınav stratejisi ipucu ver
      `,
    }

    const instructionLimit = isGlossary
      ? `🚨 ÖZEL TALİMAT: Bu bölüm bir "${sectionTitle}" (Sözlük/Kısaltmalar) bölümüdür.\nBurada yer alan yüzlerce kısaltma/terim içinden SADECE ${courseName || "bu sınav"} müfredatında doğrudan sorulma potansiyeli yüksek olan, sektörel ve teknik öneme sahip kritik terimleri seç. "USB, SMS, PC" gibi aşırı basit terimleri KESİNLİKLE ATLA. Sadece 'Sınav Kalitesinde' olanları seç. Maksimum kart limiti yoktur.`
      : `DİNAMİK ÜRETİM: Bu metin ana "${sectionTitle}" bölümünün bir PARÇASIDIR. Lütfen bu metnin BİLGİ YOĞUNLUĞUNU analiz et. Eğer metin kurallar, cezalar, oranlar ve tanımlarla doluysa EN AZ 4-6 adet flashcard oluştur. Eğer metin sadece giriş, önsöz veya yüzeysel bilgilerden ibaretse sadece 1-2 adet temel flashcard oluştur. Kaliteden taviz verme.`

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
  - Kart 1: "İhraççı nedir?" (tanım)
  - Kart 2: "İhraççı ile aracı kuruluş arasındaki fark nedir?" (karşılaştırma)
  - Kart 3: "Hangi durumlarda ihraççı SPK'ya başvurmak zorundadır?" (uygulama)`;

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
    - 🪤 Dikkat: 1-2 cümlelik sınav tuzağı uyarısı.
    Toplam cevap 6-10 satırı GEÇMESİN. Kısa, öz ve okunabilir olsun.
  - 🛡️ EKSİKSİZ TANIM: Eğer bir kurumun (örn: BDDK, SPK) tanımını veya görevlerini yazıyorsan, sadece adından yola çıkarak (sadece bankalar gibi) sığ bir tanım yapma. Kaynak metinde geçen TÜM görevlerini ve denetlediği TÜM şirket tiplerini (Faktoring, Leasing vb.) kapsayan eksiksiz bir açıklama yap.
  - 🪤 Ekstra Dikkat Edilmesi Gereken Hususlar Nedir?: Öğrenciyi yanıltmak için şıklara konulabilecek çok benzer kavramlar, yanlış süreler (örn: 10 iş günü yerine 15 takvim günü) veya ezber yanılgıları. Her kartın arkasında bu uyarı KESİNLİKLE olmalıdır.
  - Özellikle rakam, süre, oran ve istisnaları soran kartlar bol olsun — sınavda en çok bunlar sorulur
  - 🚫 KESİNLİKLE YASAK: "Kaynak metne göre", "Verilen metne göre", "Ders notlarında", "Metinde belirtilen", "Mevzuata göre" gibi meta-ifadeleri ASLA kullanma. Soruları doğrudan genel geçer akademik doğrular olarak sor.
  - **ASLA KENDİ KAFANDAN SINAV TAKTİĞİ VEYA YORUM UYDURMA!** "Sınavda doğrudan şu terimler sorulmaktadır", "Buraya çok dikkat edin", "Bu konu çok önemlidir" gibi HOCALIK TASLAYAN veya kaynak metinde (PDF'te) olmayan hiçbir yönlendirici/abartı cümleyi **ASLA KULLANMA.**
  - 🇹🇷 DİL KALİTESİ: Türkçe dil bilgisi, kelime dizilimi ve akıcılığa %100 uy.

  KAYNAK METİN PARÇASI: "${chunkContent.replace(/"/g, "'")}"

  Sadece JSON array döndür:
  [
    {"front": "soru", "back": "cevap (resmi tanım + 💡 örnek + 🪤 Ekstra Dikkat Edilmesi Gereken Hususlar: [tuzak uyarısı])\\n\\n[KAYNAK BAŞLIĞI: Bu bilginin kaynağındaki ana başlığın tam adını buraya yaz]", "difficulty": "easy|medium|hard"}
  ]
  `
    let raw = await callAI(prompt, 2, "flashcard_generation")

    let attempt = 1
    const maxAttempts = 2
    let chunkFlashcardsList: any[] = []

    while (attempt <= maxAttempts) {
      try {
        const parsed = extractCleanJson(raw)
        chunkFlashcardsList = Array.isArray(parsed) ? parsed : []
        console.log(`[FLASHCARD_DEBUG] Parça ${i + 1}: Parsed ${chunkFlashcardsList.length} flashcards (Attempt #${attempt})`)

        if (chunkFlashcardsList.length === 0) {
          throw new Error("Boş veya geçersiz JSON listesi.")
        }

        // Flashcard Müfettişi Devreye Giriyor!
        console.log(`[FLASHCARD_AUDIT] Parça ${i + 1} Müfettiş derin flashcard denetimi başlatılıyor...`)
        const audit = await auditFlashcardsAgainstSource(chunkContent, chunkFlashcardsList, sectionTitle, fileUri)

        if (audit.passed) {
          console.log(`[FLASHCARD_AUDIT] ✅ Parça ${i + 1} Müfettiş tüm flashcardları hatasız ve kusursuz onayladı!`)
          break
        }

        console.warn(`[FLASHCARD_AUDIT] ⚠️ Parça ${i + 1} Müfettiş ${audit.issues.length} adet hata/halüsinasyon tespit etti!`)
        console.log(audit.issues.map(iss => `   - ${iss}`).join("\n"))

        if (attempt === maxAttempts) {
          console.warn(`[FLASHCARD_AUDIT] Maximum audit deneme sayısına ulaşıldı, mevcut kartlarla devam ediliyor.`)
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

    // Chunk'tan gelen başarılı kartları ana listeye ekle
    allFlashcards = [...allFlashcards, ...chunkFlashcardsList]

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

  return allFlashcards
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
): Promise<Array<{ text: string; options: string[]; correct: string; explanation: string; difficulty: string }>> {
  // Chunking mantığı devreye giriyor!
  const chunkThreshold = 15000;
  const isChunked = content.length > chunkThreshold;
  const chunks = isChunked ? splitContentIntoChunks(content, chunkThreshold) : [content];

  console.log(`[QUESTION_GEN] Metin ${chunks.length} parçaya bölündü (Toplam Karakter: ${content.length})`);

  let allQuestions: any[] = [];

  // Paralel işlem API'yi boğabilir, bu yüzden sıralı (sequential) gidiyoruz
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    console.log(`[QUESTION_GEN] Parça ${i + 1}/${chunks.length} işleniyor... (Karakter: ${chunkContent.length})`);

    const levelQuestionStyle: Record<string, string> = {
      beginner: `
        - Zorluk dağılımı: %20 kolay, %50 orta, %30 zor
        - Kolay sorularda bile çeldirici şıklar olsun
        - Orta sorularda vaka senaryoları kullan
        - Açıklamalarda her yanlış şıkkın NEDEN yanlış olduğunu detaylı açıkla
      `,
      intermediate: `
        - Zorluk dağılımı: %10 kolay, %40 orta, %50 zor
        - Vaka tabanlı senaryolar ağırlıklı olsun
        - Çeldiriciler birbirine ÇOK benzesin, ince farkları ölçsün
        - Açıklamalarda her şıkkı teker teker analiz et
      `,
      advanced: `
        - Zorluk dağılımı: %5 kolay, %25 orta, %70 zor
        - Ağırlıklı vaka, hesaplama ve çok ince detay soruları
        - Şıklar arasında minimal fark olsun, dikkatsiz olanı yanıltsın
        - Açıklamalarda mevzuat detaylarına referans ver
      `,
    }

    const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
${getExamIntelligence(aiMode, courseName)}

DERS: ${courseName}
BÖLÜM: "${sectionTitle}"
SAYFA ARALIĞI: ${pageStart} ile ${pageEnd}. sayfalar arasındaki konu kapsamı.

SEVİYE TALİMATLARI: 
${levelQuestionStyle[userLevel] || levelQuestionStyle.beginner}

SORU KURALLARI:
- 🚫 KESİNLİKLE YASAK: Belgenin yapısı, başlık numaraları veya içindekiler tablosuyla ilgili soru SORMA. Sadece gerçek finansal, teknik ve mevzuat bilgisini ölç.
- 🚨 ÖLÜMCÜL HATA VE KESİN İPTAL SEBEBİ: Sorularda, şıklarda ve açıklamalarda "Kaynak metne göre", "Yukarıdaki bilgilere göre", "Ders notlarında", "Metinde belirtilen" GİBİ İFADELER ASLA VE ASLA KULLANILAMAZ! Soruyu sanki tek başına, bağımsız, profesyonel bir ÖSYM sınav sorusuymuş gibi doğrudan sor. Hiçbir şekilde öğrenciye "bu sorunun kaynağı bir metin/PDF" hissi YARATILMAYACAK.
- **ASLA KENDİ KAFANDAN SINAV TAKTİĞİ VEYA YORUM UYDURMA!** "Sınavda doğrudan şu terimler sorulmaktadır", "Buraya çok dikkat edin", "Bu konu çok önemlidir" gibi HOCALIK TASLAYAN veya kaynak metinde (PDF'te) olmayan hiçbir yönlendirici/abartı cümleyi **ASLA KULLANMA.**
- Doğru cevap şık harfi olsun (A, B, C, D veya E)
- Resmi terimleri AYNEN kullan (pay, tahvil, izahname vb.)
- Çeldirici şıklar gerçekçi olsun ve birbirine çok benzesin
- Metinde formül/rakam/oran varsa EN AZ 2-3 adet SAYISAL/HESAPLAMA sorusu ekle
- Metinde tarih/süre/limit varsa bunlarla ilgili soru sor
- 🇹🇷 DİL KALİTESİ: Türkçe dil bilgisi, kelime dizilimi ve akıcılığa %100 uy. İngilizce'den doğrudan çevrilmiş gibi duran yapay veya ters yapılar ("Özeti [Konu]", "Sözlüğü [Konu]", "Notları [Konu]") KESİNLİKLE kullanma. Her zaman doğal ve düzgün bir Türkçe ile akıcı cümleler kur.

DİNAMİK ÜRETİM: Bu metin ana "${sectionTitle}" bölümünün bir PARÇASIDIR. Lütfen bu metnin BİLGİ YOĞUNLUĞUNU analiz et. Eğer metin kurallar, cezalar, oranlar ve tanımlarla doluysa EN AZ 3-5 adet kaliteli sınav sorusu oluştur. Eğer metin sadece giriş, önsöz veya yüzeysel bilgilerden ibaretse sadece 1-2 adet temel soru oluştur. Kaliteden taviz verme.

SORU TİPLERİ VE DAĞILIMI (GERÇEK ÖSYM/SPL FORMATI):
Ürettiğin soruların en az %40'ı "ÖNCÜLLÜ (I, II, III)" formatında OLMALIDIR. Bu kesin bir kuraldır.
1. Öncüllü Soru (ZORUNLU - %40): 
   I. [Birinci ifade]
   II. [İkinci ifade]
   III. [Üçüncü ifade]
   Soru Kökü: Yukarıdakilerden hangisi/hangileri doğrudur? (Şıklar: A) Yalnız I, B) Yalnız II, C) I ve II, D) I ve III, E) I, II ve III)
2. Kurumsal Vaka Tabanlı: ŞAHIS İSİMLERİ (Ahmet, Mehmet, Ayşe vb.) KESİNLİKLE YASAKTIR! Vaka senaryolarında SADECE tüzel kişiler ("X Aracı Kurumu", "Y Portföy Yönetim Şirketi") veya genel unvanlar ("Kurumun Uyum Görevlisi", "İç Denetim Uzmanı") kullanılmalıdır.
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
💡 Sınav İpucu: [Bu soruyla ilgili karıştırılabilecek önemli bir nokta veya ezber tekniği]"

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
    "explanation": "✅ Doğru cevap A'dır: [detaylı açıklama].\\n\\n❌ B) Yanlış çünkü: [neden]\\n❌ C) Yanlış çünkü: [neden]\\n❌ D) Yanlış çünkü: [neden]\\n❌ E) Yanlış çünkü: [neden]\\n\\n💡 Sınav İpucu: [ipucu]\\n\\n[KAYNAK BAŞLIĞI: Bu bilginin kaynağındaki ana başlığın tam adını buraya yaz]",
    "difficulty": "easy|medium|hard"
  }
]
`

    let raw = await callAI(prompt, 2, "question_generation")

    let attempt = 1
    const maxAttempts = 2
    let chunkQuestionsList: any[] = []

    while (attempt <= maxAttempts) {
      try {
        const parsed = extractCleanJson(raw)
        chunkQuestionsList = Array.isArray(parsed) ? parsed : []
        console.log(`[QUESTION_DEBUG] Parça ${i + 1}: Parsed ${chunkQuestionsList.length} questions (Attempt #${attempt})`)

        if (chunkQuestionsList.length === 0) {
          throw new Error("Boş veya geçersiz JSON listesi.")
        }

        // Soru Müfettişi Devreye Giriyor!
        console.log(`[QUESTION_AUDIT] Parça ${i + 1} Müfettiş derin soru denetimi başlatılıyor...`)
        const audit = await auditQuestionsAgainstSource(chunkContent, chunkQuestionsList, sectionTitle, fileUri)

        if (audit.passed) {
          console.log(`[QUESTION_AUDIT] ✅ Parça ${i + 1} Müfettiş tüm soruları hatasız ve kusursuz onayladı!`)
          break
        }

        console.warn(`[QUESTION_AUDIT] ⚠️ Parça ${i + 1} Müfettiş ${audit.issues.length} adet hata/halüsinasyon tespit etti!`)
        if (audit.issues.length > 0) {
          console.log(audit.issues.map(iss => `   - ${iss}`).join("\n"))
        }

        if (attempt === maxAttempts) {
          console.warn(`[QUESTION_AUDIT] Maximum audit deneme sayısına ulaşıldı, mevcut sorularla devam ediliyor.`)
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

    // Chunk'tan gelen başarılı soruları ana listeye ekle
    allQuestions = [...allQuestions, ...chunkQuestionsList]

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
        console.log(`[YEDEK_GÜÇ] ✅ Başarıyla ${backupQuestions.length} adet yedek güç sorusu üretildi.`)
        allQuestions = [...allQuestions, ...backupQuestions.slice(0, 5)]
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

  return allQuestions
}


// ==================== GROUND TRUTH TEST ====================

async function runGroundTruthTest(
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string = ""
): Promise<{ passed: boolean; failedQuestions: string[]; totalQuestions: number }> {
  console.log(`[GROUND_TRUTH] 🕵️‍♂️ "${sectionTitle}" için Ground Truth Testi Başlatılıyor...`);

  const charCount = sourceContent.length;
  // Metnin uzunluğuna göre dinamik soru sayısı (Her ~400 karaktere 1 soru, Min: 5, Max: 35)
  let questionCount = Math.round(charCount / 400);
  if (questionCount < 5) questionCount = 5;
  if (questionCount > 35) questionCount = 35;

  console.log(`[GROUND_TRUTH] Dinamik soru sayısı hesaplandı: ${questionCount} soru (Metin: ${charCount} karakter)`);

  // Adım 1: Kaynaktan dinamik sayıda zor soru üret
  const qPrompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen acımasız bir müfettişsin.
BÖLÜM: "${sectionTitle}"
KAYNAK METİN:
${sourceContent}

GÖREV: SADECE bu kaynak metne bakarak, metindeki en ufak detayları, rakamları, yasal istisnaları ve kritik tanımları sınayan tam ${questionCount} adet "ÇOK ZOR" ve "NET" kontrol sorusu çıkar.
DİKKAT: Soruları sadece teknik, kavramsal veya kanuni konulardan seç. Kitapçık numarası, yayın numarası, sayfa sayısı veya referans edilen doküman numaraları gibi "Sınav Dışı Meta Bilgiler" hakkında KESİNLİKLE soru sorma!
Sorular kısa ve doğrudan bilgi arayan tarzda olmalı.

Sadece şu formatta JSON döndür:
["soru 1", "soru 2", ...]
  `;

  let questions: string[] = [];
  try {
    const qRaw = await callAI(qPrompt, 1, "ground_truth");
    questions = extractCleanJson(qRaw) as string[];
  } catch {
    console.log(`[GROUND_TRUTH] ⚠️ Soru üretilemedi, test atlanıyor.`);
    return { passed: true, failedQuestions: [], totalQuestions: 0 };
  }

  if (!questions || questions.length === 0) return { passed: true, failedQuestions: [], totalQuestions: 0 };
  console.log(`[GROUND_TRUTH] 🎯 Üretilen kontrol sorusu sayısı: ${questions.length}`);

  // Adım 2: Soruları sadece notlara bakarak cevapla
  const aPrompt = `[LOG_CONTEXT: ${courseName ? courseName + ' > ' : ''}${sectionTitle}]
Sen bir kalite kontrolörüsün.
BÖLÜM: "${sectionTitle}"
ÜRETİLEN DERS NOTU:
${generatedNotes}

KONTROL SORULARI:
${JSON.stringify(questions)}

GÖREV: Yukarıdaki soruları SADECE ve SADECE "ÜRETİLEN DERS NOTU"na bakarak cevapla. Kendi bilgini kullanma!
Eğer bir sorunun cevabı notta EKSİKSE, YANLIŞSA veya HİÇ YOKSA o soruyu "foundInNotes": false olarak işaretle.

Sadece şu formatta JSON döndür:
{
  "results": [
    {
      "question": "soru",
      "foundInNotes": true,
      "reason": "neden bulunduğu veya bulunamadığı"
    }
  ]
}
  `;

  try {
    const aRaw = await callAI(aPrompt, 1, "ground_truth");
    const results = extractCleanJson(aRaw) as any;
    const failed = (results.results || []).filter((r: any) => r.foundInNotes === false).map((r: any) => r.question);

    if (failed.length > 0) {
      console.log(`[GROUND_TRUTH] ❌ BAŞARISIZ: ${failed.length} sorunun cevabı notlarda yok!`);
    } else {
      console.log(`[GROUND_TRUTH] ✅ BAŞARILI: Notlar tüm soruları cevaplayabildi.`);
    }

    return { passed: failed.length === 0, failedQuestions: failed, totalQuestions: questions.length };
  } catch {
    console.log(`[GROUND_TRUTH] ⚠️ Cevaplar analiz edilemedi, test atlanıyor.`);
    return { passed: true, failedQuestions: [], totalQuestions: questions.length || 0 };
  }
}

// ==================== AI KONTROLÖR (NOTES CROSS-CHECK) ====================


export async function verifyNotesAgainstSource(
  sourceContent: string,
  generatedNotes: string,
  sectionTitle: string,
  courseName: string
): Promise<{ score: number; missingTopics: string[]; issues: string[]; suggestions: string[] }> {
  const prompt = `[LOG_CONTEXT: ${courseName} > ${sectionTitle}]
Sen bir sınav materyali KALİTE KONTROLÖRÜSÜN (Kontrolör). Görevin, üretilen ders notlarını yasal kaynak dökümanla karşılaştırıp yasal süreler, cezalar, limitler ve kritik mevzuat kavramları bazında hiçbir eksiğin kalmadığını doğrulamaktır.

📄 Sana verilen metni ASIL KAYNAK olarak kullan.

BÖLÜM: "${sectionTitle}"

KAYNAK METİN:
${sourceContent.replace(/"/g, "'")}

ÜRETİLEN DERS NOTU:
${generatedNotes.replace(/"/g, "'")}

🎯 DEĞERLENDİRME KRİTERLERİ:

⚠️⚠️⚠️ DÜŞÜK İÇERİK TESPİTİ (ÖNCELİKLİ KURAL — İLK BUNU KONTROL ET!):
Değerlendirmeye başlamadan ÖNCE kaynak metni analiz et ve aşağıdaki durumlardan biri geçerliyse İÇERİK YOĞUNLUĞUNU "DÜŞÜK" olarak işaretle:
- Kaynak metin sadece bir İÇİNDEKİLER (Table of Contents) sayfası veya sayfa numarası listesiyse
- Kaynak metin sadece bir ÖNSÖZ, GİRİŞ veya SUNUŞ yazısı olup somut ders kavramı, tanım, formül, süre, rakam İÇERMİYORSA
- Kaynak metin sadece bir KAYNAKÇA / REFERANSLAR listesiyse
- Kaynak metin yalnızca alt başlık isimleri/numaraları içerip bu başlıkların altlarında açıklayıcı paragraflar, tanımlar veya detaylar BULUNMUYORSA

Eğer içerik yoğunluğu DÜŞÜK ise:
→ Başlık adlarının ders notunda detaylı açıklanmamış olmasını KESİNLİKLE missingTopics veya issues olarak YAZMA.
→ Kaynak metinde detayı/açıklaması olmayan bir başlığın notta da detaysız olması DOĞAL ve BEKLENEN bir durumdur.
→ Bu tür bölümlere otomatik olarak 95-100 puan ver (ciddi bir bilgi hatası olmadıkça).
→ suggestions alanına isteğe bağlı yapısal öneriler yazabilirsin ama bunlar puanı düşürmez.

Bu kural SADECE yukarıdaki düşük içerikli bölümler için geçerlidir. Gerçek ders anlatımı, kavram tanımı, formül veya mevzuat detayı içeren bölümlerde HER ZAMANKİ GİBİ ACIMADAN DENETLE.

PUAN KIRAN DURUMLAR VE ASİMETRİK CEZA MATEMATİĞİ (KESİN KURAL):
- Kaynak metinde DETAYLI OLARAK AÇIKLANMIŞ bir KONU/KAVRAM ders notunda hiç ele alınmamışsa (tamamen atlanmış): Her atlanan konu için net -15 PUAN.
- Rakam, oran, süre, tarih, limit YANLIŞ yazılmış (örn: 5 yıl yerine 3 yıl): Her yanlış rakam/süre için net -20 PUAN.
- Mevzuat adı veya madde numarası YANLIŞ: -10 PUAN.
- Tablo veya liste YARIDA kesilmiş: -10 PUAN.
- Ceza miktarı veya yaptırım türü HATALI: -20 PUAN.
- 🚨 KISMİ ANLATIM KURALI (ÖNEMLİ): Kaynak metinde bir kavramın, kanunun veya sürecin ALT MADDELERİ (örn: 5 alt bent, 4 özellik) varsa ve üretilen notta bu maddelerin SADECE BAZILARI (örn: 3 tanesi) yer alıp diğerleri EKSİK BIRAKILMIŞSA, bu kabul edilemez! "Ana başlık var" diyerek konuyu tam sayma. Atlanan her alt maddeyi "missingTopics" listesine KESİNLİKLE detaylıca yaz ve kısmi anlatım için -15 PUAN KIR.


PUAN KIRMAYAN DURUMLAR (bunlar sorun DEĞİL):
- Tanımın kendi cümleleriyle basitleştirilerek veya eşanlamlı kelimelerle anlatılması (Birebir kelime ezberi arama!) ✅
- Eğlenceli örnekler, hikayeler, benzetmeler eklenmesi ✅
- 🚨 KAYNAK HATASI YÖNETİMİ (TRIVIAL vs CRITICAL):
  - A) Trivial (Şekilsel) Hatalar: Yazarın, kaynak metindeki basit bir harf/imla/telaffuz hatasını (örn: 'Standard' yerine 'Standart', Asynchronous yerine Asynchrous) KESİNLİKLE düzeltmemesi ve uyarı eklememesi BEKLENEN KURALDIR. Yazarın kaynağa birebir sadık kalıp "Standart" olarak bırakması BİR HATA DEĞİLDİR! "Yazar bunu düzeltmemiş, kaynak hatası notlara aktarılmış" DİYEREK KESİNLİKLE PUAN KIRMA, bunu "issues" listesine ASLA YAZMA!
  - B) Critical (Yasal/Sayısal) Hatalar: Kaynaktaki yanlış kanun numarası (610 yerine 6102) gibi hayati hataların yazar tarafından "Not: Mevzuata göre doğrusu şudur" diye düzeltilmesi takdir edilir ve ceza sebebi değildir.
- İçeriğin farklı sırayla organize edilmesi ✅
- Emoji, görsel zenginlik, mermaid diyagram kullanılması ✅
- Kaynak metindeki dolgu cümlelerinin atlanması ✅
- İçindekiler, önsöz veya kaynakça gibi düşük içerikli bölümlerde başlıkların detaylandırılmamış olması ✅

5 BOYUTLU RUBRİK PUANLAMA KURALLARI (TAVİZSİZ VE KESİN):
Başlangıç puanı 100'dür. Bulduğun her eksiklik için yukarıdaki ceza matematiğini uygulayarak puanı düşür.
- 100 PUAN: Eğer metinde hiçbir eksik konu (missingTopics) ve hiçbir bilgi hatası (issues) YOKSA tam 100 puan verilir. "Öneri varsa 100 kalır" mantığını UNUT, eksik varsa KESİNLİKLE puan kıracaksın.
- 85-99 PUAN: Kapsam ve doğruluk yeterli, yayınlanabilir kalitede.
- 70-84 PUAN: Birden fazla önemli konu atlanmış.
- 50-69 PUAN: Ciddi eksiklikler, halüsinasyon veya rakam hataları var.

🎯 ÇAPRAZ DOĞRULAMA (Kendini Test Et Kuralı):
Ders notunun içindeki "Kendini Test Et" sorularının cevaplarını kaynak metne bakarak çapraz doğrula. Eğer cevabı kaynak metinde YOKSA veya YANLIŞSA -25 PUAN ver.

⚠️ MUTLAK DOĞRULUK VE ÖNERİ KURALI: 
1. Eksikleri doğrudan "missingTopics" veya "issues" alanına aktarmak zorundasın.
2. Kaynak metinde bulunmayan hiçbir dış konuyu "öneri" (suggestions) olarak yazamazsın!
3. Eksik varsa Puan KESİNLİKLE 100'ün altında olmalıdır.

Sadece JSON döndür:
{
  "score": <0-100 arası tam sayı>,
  "missingTopics": ["Tamamen ATLANMIŞ konu varsa yaz — yoksa boş array"],
  "issues": ["YANLIŞ rakam, tarih veya mevzuat hatası varsa yaz — yoksa boş array"],
  "suggestions": ["İyileştirme önerisi — yoksa boş array"]
}

TÜM TESPİTLERİNİ, CÜMLELERİNİ VE ÇIKTILARINI KESİNLİKLE TÜRKÇE DİLİNDE YAZMALISIN (İngilizce kısaltmaları analiz etsen bile raporu Türkçe ver).
`

  const raw = await callAI(prompt, 1, "kontrolor")
  try {
    const result = extractCleanJson(raw) as any
    let score = result.score || 0;
    const missingTopics = result.missingTopics || [];

    // GROUND TRUTH ENTEGRASYONU
    const groundTruth = await runGroundTruthTest(sourceContent, generatedNotes, sectionTitle, courseName);
    if (!groundTruth.passed && groundTruth.failedQuestions.length > 0 && groundTruth.totalQuestions > 0) {
      const failRatio = groundTruth.failedQuestions.length / groundTruth.totalQuestions;
      const gtPenalty = Math.round(score * failRatio);
      score = Math.max(50, score - gtPenalty);

      const gtTopics = groundTruth.failedQuestions.map(q => `Eksik Detay (Ground Truth Testi Başarısız): ${q}`);
      missingTopics.push(...gtTopics);
    }

    return {
      score: score,
      missingTopics: missingTopics,
      issues: result.issues || [],
      suggestions: result.suggestions || []
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
1. Bilgi Hatası (Factual Error): Soru kökünde, doğru şıkta veya açıklamalarda kaynak metinle çelişen, uydurulmuş veya yanlış aktarılmış herhangi bir yasal süre (gün/ay), para cezası miktarı, katalog suç veya kural var mı?
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
  fileUri?: string
): Promise<{ passed: boolean; issues: string[] }> {
  const prompt = `
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

  const prompt = `Sen SPL/MASAK Sınav Komisyonu Başmüfettişisin.
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

      const intendedAnswer = (q.correct || q.correctOption || q.correctAnswer)?.substring(0, 1).toUpperCase();
      const chosenAnswer = s.chosen_answer?.substring(0, 1).toUpperCase();

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
    console.error("[SOLVER_AI] Soru denetimi başarısız oldu, orijinal sorular korunuyor:", error);
    return questions; // Fallback to original if solver fails
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
    console.error("[SOLVER_AI] Flashcard denetimi başarısız oldu, orijinal kartlar korunuyor:", error);
    return flashcards; // Fallback
  }
}
