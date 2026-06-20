// SPL Düzey 3 - 12 Ders Sabit Verileri

export interface CourseInfo {
  name: string
  slug: string
  order: number
  description: string
  icon: string // emoji
  color: string // tailwind gradient
  estimatedPages: string
  /** PDF yükleme rehberi — önerilen dosya adı */
  uploadFileName?: string
  /** PDF içeriğinde olması gerecek mevzuat listesi */
  uploadGuide?: string
  /** Program gridinde grup başlığı (ör. KVKK alt bölümü) */
  gridGroup?: string
  /** Kart rozeti: dış / iç mevzuat ayrımı */
  sourceKindLabel?: string
  /** İşleme profili: prosedür, politika, dış mevzuat vb. */
  sourceKind?: "internal-procedure" | "internal-policy" | "external-law" | "external-regulation"
  /** Ana program gridinde gizlenir; grup alt sayfasında gösterilir */
  hiddenFromProgramGrid?: boolean
  /** Üst grup kartı slug'ı (ör. zeliha-kvkk) */
  parentSlug?: string
  /** Sanal grup kartı — veritabanında ders kaydı yok */
  isGroupLanding?: boolean
  /** Grup alt sayfası yolu (ör. kvkk) */
  groupPath?: string
}

export const SPL_LEVEL_3_COURSES: CourseInfo[] = [
  {
    name: "Geniş Kapsamlı Sermaye Piyasası Mevzuatı ve Meslek Kuralları",
    slug: "sermaye-piyasasi-mevzuati",
    order: 1,
    description: "SPK mevzuatı, meslek kuralları, düzenleyici kurumlar ve yaptırımlar. Sermaye piyasasının temel hukuki çerçevesi.",
    icon: "Scale",
    color: "from-blue-600 to-indigo-700",
    estimatedPages: "300-500",
  },
  {
    name: "Sermaye Piyasası Araçları 1",
    slug: "sermaye-piyasasi-araclari-1",
    order: 2,
    description: "Pay (hisse) senetleri, yatırım fonları, varantlar ve yapılandırılmış ürünler.",
    icon: "BarChart3",
    color: "from-emerald-600 to-teal-700",
    estimatedPages: "200-350",
  },
  {
    name: "Sermaye Piyasası Araçları 2",
    slug: "sermaye-piyasasi-araclari-2",
    order: 3,
    description: "Borçlanma araçları (tahvil, bono), türev ürünler (vadeli işlem, opsiyon), repo ve ters repo.",
    icon: "TrendingUp",
    color: "from-cyan-600 to-blue-700",
    estimatedPages: "200-350",
  },
  {
    name: "Yatırım Kuruluşları",
    slug: "yatirim-kuruluslari",
    order: 4,
    description: "Aracı kurumlar, portföy yönetim şirketleri, yatırım ortaklıkları ve faaliyetleri.",
    icon: "Landmark",
    color: "from-violet-600 to-purple-700",
    estimatedPages: "150-250",
  },
  {
    name: "Finansal Piyasalar",
    slug: "finansal-piyasalar",
    order: 5,
    description: "Para ve sermaye piyasaları, borsa yapıları, piyasa mikroyapısı ve işlem mekanizmaları.",
    icon: "Globe",
    color: "from-sky-600 to-blue-700",
    estimatedPages: "150-250",
  },
  {
    name: "Takas, Saklama ve Operasyon İşlemleri",
    slug: "takas-saklama-operasyon",
    order: 6,
    description: "Takasbank, MKK, saklama hizmetleri, takas süreçleri ve operasyonel risk yönetimi.",
    icon: "RefreshCw",
    color: "from-amber-600 to-orange-700",
    estimatedPages: "150-250",
  },
  {
    name: "Finansal Yönetim ve Mali Analiz",
    slug: "finansal-yonetim-mali-analiz",
    order: 7,
    description: "Finansal tablolar analizi, oran analizi, nakit akışı, sermaye bütçelemesi ve değerleme.",
    icon: "CircleDollarSign",
    color: "from-green-600 to-emerald-700",
    estimatedPages: "200-350",
  },
  {
    name: "Ticaret Hukuku",
    slug: "ticaret-hukuku",
    order: 8,
    description: "Ticari işletme, şirketler hukuku, kıymetli evrak, iflas ve konkordato.",
    icon: "ScrollText",
    color: "from-rose-600 to-red-700",
    estimatedPages: "200-300",
  },
  {
    name: "Muhasebe ve Finansal Raporlama",
    slug: "muhasebe-finansal-raporlama",
    order: 9,
    description: "Genel muhasebe, dönen/duran varlıklar, gelir tablosu, bilanço ve UFRS standartları.",
    icon: "ClipboardList",
    color: "from-indigo-600 to-violet-700",
    estimatedPages: "250-400",
  },
  {
    name: "Genel Ekonomi",
    slug: "genel-ekonomi",
    order: 10,
    description: "Mikro ve makro ekonomi, para politikası, enflasyon, büyüme ve dış ticaret.",
    icon: "Globe2",
    color: "from-teal-600 to-cyan-700",
    estimatedPages: "150-250",
  },
  {
    name: "Temel Finans Matematiği ve Değerleme Yöntemleri",
    slug: "finans-matematigi-degerleme",
    order: 11,
    description: "Paranın zaman değeri, bugünkü değer, gelecek değer, tahvil değerleme ve portföy teorisi.",
    icon: "Calculator",
    color: "from-purple-600 to-fuchsia-700",
    estimatedPages: "150-250",
  },
  {
    name: "Kurumlarda ve Sermaye Piyasasında Vergilendirme",
    slug: "vergilendirme",
    order: 12,
    description: "Gelir vergisi, kurumlar vergisi, KDV, sermaye kazançları vergisi ve vergi muafiyetleri.",
    icon: "Receipt",
    color: "from-orange-600 to-red-700",
    estimatedPages: "150-250",
  },
]

// ==================== MASAK UYUM GÖREVLİSİ SINAVI ====================
// Resmi Kaynak: SPL (spl.com.tr) ve MASAK Tebliğ No:30
// Sınav: 2 Modül, toplam 100 soru (50+50), 5 şıklı çoktan seçmeli
// Süre: Modül başına 45 dakika (toplam 90 dk)
// Geçme: Her modülden en az 50 puan + genel ortalama en az 65 puan (çifte baraj)
// Yanlış doğruyu götürmez.

export const MASAK_COURSES: CourseInfo[] = [
  {
    name: "MASAK Uyum Görevlisi Yetkilendirme Sınavı",
    slug: "masak-uyum-gorevlisi",
    order: 1,
    description: "Modül 1 (Hukuki Çerçeve) ve Modül 2 (Uyum Yönetimi) tüm konuları kapsar. Sınavda bu modüllerin hepsi çıkmaktadır.",
    icon: "ShieldCheck",
    color: "from-blue-600 to-indigo-700",
    estimatedPages: "150-250",
  }
]

// SPL Bilgi Sistemleri Bağımsız Denetim Lisansı — resmi yapı: 5 ayrı ders (VII-128.7 md.9-ğ).
// Her dersten 25 soru / 45 dk; her dersten min 50, ortalama min 60.
// Kaynak: spl.com.tr/sinav-konulari-ve-alt-konu-basliklari/
export const SPL_BD_COURSES: CourseInfo[] = [
  {
    name: "Dar Kapsamlı Sermaye Piyasası Mevzuatı ve Meslek Kuralları",
    slug: "bd-sermaye-piyasasi-mevzuati",
    order: 1,
    description: "SPK mevzuatı, meslek kuralları ve etik ilkeler. BSBD lisansının 1. dersi — 25 soru, 45 dakika.",
    icon: "Scale",
    color: "from-blue-600 to-indigo-700",
    estimatedPages: "80-150",
  },
  {
    name: "Bilgi Sistemleri Yönetimi ve Denetimi",
    slug: "bd-bilgi-sistemleri-yonetimi",
    order: 2,
    description: "BS yönetimi, BS denetimi ve ilgili mevzuat. BSBD lisansının 2. dersi — 25 soru, 45 dakika.",
    icon: "ClipboardList",
    color: "from-violet-600 to-purple-700",
    estimatedPages: "80-150",
  },
  {
    name: "Bilgi Sistemleri Geliştirilmesi ve Uygulanması",
    slug: "bd-bilgi-sistemleri-gelistirme",
    order: 3,
    description: "Proje yönetimi ve sistem geliştirme yaşam döngüsü. BSBD lisansının 3. dersi — 25 soru, 45 dakika.",
    icon: "TrendingUp",
    color: "from-cyan-600 to-blue-700",
    estimatedPages: "60-120",
  },
  {
    name: "Bilgi Sistemleri İşletimi",
    slug: "bd-bilgi-sistemleri-isletimi",
    order: 4,
    description: "BS altyapısı, operasyonlar ve iş sürekliliği. BSBD lisansının 4. dersi — 25 soru, 45 dakika.",
    icon: "RefreshCw",
    color: "from-amber-600 to-orange-700",
    estimatedPages: "60-120",
  },
  {
    name: "Bilgi Sistemleri Güvenliği",
    slug: "bd-bilgi-sistemleri-guvenligi",
    order: 5,
    description: "Bilgi güvenliği yönetimi, varlık/ağ/erişim güvenliği ve iz kayıtları. BSBD lisansının 5. dersi — 25 soru, 45 dakika.",
    icon: "ShieldCheck",
    color: "from-emerald-600 to-teal-700",
    estimatedPages: "150-300",
  },
]

/** Eski yanlış domain bölünmesi — program grid'inde gösterilmez; veritabanı kayıtları korunur */
export const LEGACY_PROGRAM_COURSE_SLUGS = [
  "cisa-domain-1",
  "cisa-domain-2",
  "cisa-domain-3",
  "cisa-domain-4",
  "cisa-domain-5",
] as const

// ==================== SINAV YAPISI BİLGİLERİ ====================

export interface ExamConfig {
  totalQuestions: number
  durationMinutes: number
  passingScore: number
  moduleBarrier: number
  modules: { name: string; questionCount: number; durationMinutes: number; courses: string[] }[]
  negativeMarking: boolean
  choiceCount: number
  examType: string
  // Opsiyonel kaynak modu: "strict" = sınav SADECE yüklenen kaynaktan çıkar (SPL/MASAK).
  // "enriched" = sınav dış/otoriter kaynaklardan da zenginleştirilebilir (CIA/CISA/SMMM).
  // Yalnızca geleceğe yönelik bir kancadır; mevcut hiçbir davranışı değiştirmez.
  sourceMode?: "strict" | "enriched"
}

export const MASAK_EXAM_CONFIG: ExamConfig = {
  totalQuestions: 100,
  durationMinutes: 90,     // 2 × 45dk
  passingScore: 65,        // Genel ortalama en az 65
  moduleBarrier: 50,       // Her modülden en az 50 puan
  modules: [
    {
      name: "Modül 1 — Hukuki Çerçeve",
      questionCount: 50,
      durationMinutes: 45,
      courses: ["masak-uyum-gorevlisi"]
    },
    {
      name: "Modül 2 — Uyum Yönetimi",
      questionCount: 50,
      durationMinutes: 45,
      courses: ["masak-uyum-gorevlisi"]
    }
  ],
  negativeMarking: false,
  choiceCount: 5,
  examType: "e-sınav",
  sourceMode: "strict"
}

export const SPL_EXAM_CONFIG: ExamConfig = {
  totalQuestions: 25,       // Ders başına 25 soru (resmi)
  durationMinutes: 45,      // Ders başına 45 dakika (resmi)
  passingScore: 60,         // Genel ortalama en az 60
  moduleBarrier: 50,        // Her dersten en az 50 puan
  modules: [
    {
      name: "SPL Düzey 3",
      questionCount: 25,
      durationMinutes: 45,
      courses: SPL_LEVEL_3_COURSES.map(c => c.slug)
    }
  ],
  negativeMarking: false,
  choiceCount: 5,
  examType: "e-sınav",
  sourceMode: "strict"
}

// ==================== CIA — CERTIFIED INTERNAL AUDITOR (IIA) ====================
// Resmi kaynak: The Institute of Internal Auditors (IIA) — theiia.org
//   • CIA Brochure: https://www.theiia.org/globalassets/site/certifications/certified-internal-auditor/cia-brochure.pdf
//   • Revize sınav (2025 müfredatı, Global Internal Audit Standards uyumlu) yapısı:
//     https://www.theiia.org/globalassets/site/certifications/certified-internal-auditor/cia-exam-why-how-and-what-is-changing/cia-exam-why-and-how-it-is-changing2.pdf
//   • IIA Singapore (soru sayısı/süre teyidi): https://iia.org.sg/Certifications/Get-Certified/Certified-Internal-Auditor
// Sınav 3 ayrı parçadan oluşur, tamamı çoktan seçmeli (4 şıklı).
// Bölüm ağırlıkları 2025 revize müfredatından alınmıştır.
export const CIA_COURSES: CourseInfo[] = [
  {
    name: "CIA Part 1 — İç Denetim Temelleri (Internal Audit Fundamentals)",
    slug: "cia-part-1",
    order: 1,
    // Bölümler: A. İç Denetimin Temelleri %35, B. Etik ve Profesyonellik %20,
    // C. Yönetişim, Risk Yönetimi ve Kontrol %30, D. Hile (Fraud) Riskleri %15
    description: "İç denetimin temelleri, bağımsızlık ve objektiflik, etik ve profesyonellik, yönetişim/risk/kontrol ve hile riskleri. 125 soru / 150 dakika.",
    icon: "ShieldCheck",
    color: "from-blue-600 to-indigo-700",
    estimatedPages: "200-350",
  },
  {
    name: "CIA Part 2 — İç Denetim Görevi (Internal Audit Engagement)",
    slug: "cia-part-2",
    order: 2,
    // Bölümler: A. Görev Planlaması %50, B. Bilgi Toplama, Analiz ve Değerlendirme %40,
    // C. Görev Gözetimi ve İletişim %10
    description: "Denetim görevinin planlanması, bilgi toplama-analiz-değerlendirme, görev gözetimi ve sonuçların iletişimi. 100 soru / 120 dakika.",
    icon: "ClipboardList",
    color: "from-emerald-600 to-teal-700",
    estimatedPages: "150-250",
  },
  {
    name: "CIA Part 3 — İç Denetim Fonksiyonu (Internal Audit Function)",
    slug: "cia-part-3",
    order: 3,
    // Bölümler: A. İç Denetim Operasyonları %25, B. İç Denetim Planı %15,
    // C. İç Denetim Fonksiyonunun Kalitesi %15, D. Görev Sonuçları ve İzleme %45
    description: "İç denetim operasyonları, denetim planı, kalite güvence ve iyileştirme programı, görev sonuçları ve izleme. 100 soru / 120 dakika.",
    icon: "Landmark",
    color: "from-violet-600 to-purple-700",
    estimatedPages: "150-250",
  },
]

// ==================== CISA — CERTIFIED INFORMATION SYSTEMS AUDITOR (ISACA) ====================
// Resmi kaynak: ISACA — isaca.org
//   • Exam Content Outline (1 Ağustos 2024'ten itibaren geçerli, 5 domain ağırlıkları):
//     https://www.isaca.org/credentialing/cisa/cisa-exam-content-outline
//   • ISACA Certification Exam Candidate Guide (150 soru / 4 saat / 4 şık / ölçekli puan 200-800, geçme 450):
//     https://www.isaca.org/en/credentialing/-/media/fa494652c5f149289af38cef18328650.ashx
//   • 2024 güncelleme basın bülteni: https://www.isaca.org/about-us/newsroom/press-releases/2024/isacas-cisa-exam-updated-to-reflect-innovations-and-evolving-technologies-impacting-it-audit
// Tek oturumda 150 çoktan seçmeli (4 şıklı) soru; domain bazlı baraj YOKTUR (domain skorları yalnız bilgi amaçlı).
export const CISA_COURSES: CourseInfo[] = [
  {
    name: "CISA — Bilgi Sistemleri Denetçisi Sertifikası",
    slug: "cisa",
    order: 1,
    description: "ISACA CISA sınavı. Tek oturum: 150 soru, 240 dakika. Müfredat 5 bilgi alanında organize edilir; sınav tek seferde yapılır.",
    icon: "Award",
    color: "from-sky-600 to-blue-700",
    estimatedPages: "800-1200",
  },
]

/** CISA müfredat bilgi alanları — sınav parçası DEĞİL; bölümleme/etiketleme referansı */
export const CISA_KNOWLEDGE_DOMAINS = [
  { order: 1, name: "Bilgi Sistemleri Denetim Süreci", weight: "18%" },
  { order: 2, name: "BT Yönetişimi ve Yönetimi", weight: "18%" },
  { order: 3, name: "BS Edinimi, Geliştirme ve Uygulama", weight: "12%" },
  { order: 4, name: "BS Operasyonları ve İş Sürekliliği", weight: "26%" },
  { order: 5, name: "Bilgi Varlıklarının Korunması", weight: "26%" },
] as const

// ==================== SMMM YETERLİLİK SINAVI (TÜRMOB / TESMER) ====================
// Modellenen sınav: "Serbest Muhasebeci Mali Müşavirlik (SMMM) Sınavı" (3 yıllık staj sonrası yeterlilik sınavı).
// Resmi kaynak: TÜRMOB / TESMER — turmob.org.tr / tesmer.org.tr
//   • YMM-SMMM Sınav Yönetmeliği (24.02.2025): http://www.tesmer.org.tr/wp-content/uploads/2025/02/YMM_SMMM_Sinav_Yonetmeligi_24_02_2025.pdf
//   • 2026/1 ve 2026/2 dönem resmi duyuruları (Yön. md. 5/1-c uyarınca: tüm konular için TEST yöntemi,
//     her konu ayrı ayrı 5 SEÇENEKLİ çoktan seçmeli, 2 oturum):
//     https://www.esmmmo.org/2026-1-donem-smmm-ve-ymm-sinav-duyurusu
//     https://www.bdturkey.com/ymm-ve-smmm-sinavlarina-iliskin-duyuru-20262-donemi
//   • 8 ders listesi (resmi): https://www.ksmmmo.org.tr/Duyuru/DuyuruDetay/31886
//   • Geçme kuralı: her dersten en az 50, ders ortalaması en az 60; yanlış doğruyu götürmez.
export const SMMM_COURSES: CourseInfo[] = [
  {
    name: "Finansal Muhasebe",
    slug: "smmm-finansal-muhasebe",
    order: 1,
    description: "Genel muhasebe, tek düzen hesap planı, dönem sonu işlemleri ve mali tabloların hazırlanması.",
    icon: "ClipboardList",
    color: "from-indigo-600 to-violet-700",
    estimatedPages: "250-400",
  },
  {
    name: "Maliyet Muhasebesi",
    slug: "smmm-maliyet-muhasebesi",
    order: 2,
    description: "Maliyet kavramları, sipariş ve safha maliyetleme, standart maliyet ve maliyet-hacim-kâr analizi.",
    icon: "Calculator",
    color: "from-purple-600 to-fuchsia-700",
    estimatedPages: "200-300",
  },
  {
    name: "Finansal Tablolar ve Analizi",
    slug: "smmm-finansal-tablolar-analizi",
    order: 3,
    description: "Oran analizi, dikey-yatay analiz, trend analizi ve fon/nakit akış tablolarının yorumlanması.",
    icon: "BarChart3",
    color: "from-green-600 to-emerald-700",
    estimatedPages: "150-250",
  },
  {
    name: "Muhasebe Denetimi",
    slug: "smmm-muhasebe-denetimi",
    order: 4,
    description: "Denetim standartları, denetim kanıtı ve teknikleri, iç kontrol ve denetim raporlaması.",
    icon: "ShieldCheck",
    color: "from-blue-600 to-indigo-700",
    estimatedPages: "150-250",
  },
  {
    name: "Vergi Mevzuatı ve Uygulaması",
    slug: "smmm-vergi-mevzuati",
    order: 5,
    description: "VUK, GVK, KVK, KDV, ÖTV ve diğer vergiler ile vergilendirme süreçleri ve uygulamaları.",
    icon: "Receipt",
    color: "from-orange-600 to-red-700",
    estimatedPages: "250-400",
  },
  {
    name: "Hukuk (Ticaret, Borçlar, İş, SGK ve Bağ-Kur, İdari Yargılama)",
    slug: "smmm-hukuk",
    order: 6,
    description: "Ticaret hukuku, borçlar hukuku, iş hukuku, SGK/Bağ-Kur mevzuatı ve idari yargılama hukuku.",
    icon: "Scale",
    color: "from-rose-600 to-red-700",
    estimatedPages: "200-350",
  },
  {
    name: "Sermaye Piyasası Mevzuatı",
    slug: "smmm-sermaye-piyasasi-mevzuati",
    order: 7,
    description: "Sermaye Piyasası Kanunu, ilgili düzenlemeler, sermaye piyasası kurumları ve araçları.",
    icon: "TrendingUp",
    color: "from-cyan-600 to-blue-700",
    estimatedPages: "120-200",
  },
  {
    name: "Muhasebecilik ve Mali Müşavirlik Meslek Hukuku",
    slug: "smmm-meslek-hukuku",
    order: 8,
    description: "3568 sayılı Kanun, meslek ahlak kuralları, çalışma usul ve esasları ile disiplin hükümleri.",
    icon: "ScrollText",
    color: "from-amber-600 to-orange-700",
    estimatedPages: "100-200",
  },
]

/** Zeliha KVKK grup kartı — ana gridde tek kart, alt sayfada 8 modül */
export const ZELIHA_KVKK_GROUP_SLUG = "zeliha-kvkk"

export const ZELIHA_KVKK_UMBRELLA: CourseInfo = {
  name: "Kişisel Verilerin Korunması (KVKK)",
  slug: ZELIHA_KVKK_GROUP_SLUG,
  order: 7,
  description:
    "6698 sayılı Kanun, yönetmelik ve tebliğler (dış mevzuat) ile kurum prosedürü ve politikası (iç mevzuat). Toplam 8 alt modül.",
  icon: "ShieldCheck",
  color: "from-fuchsia-600 to-rose-700",
  estimatedPages: "150-250",
  isGroupLanding: true,
  groupPath: "kvkk",
}

/** Zeliha — kurumsal mevzuat gelişim alanı (Haziran 2026 güncel kaynak rehberi) */
export const ZELIHA_COURSES: CourseInfo[] = [
  {
    name: "Bankacılık Kanunu ve Temel Düzenlemeler",
    slug: "zeliha-bankacilik-kanunu",
    order: 1,
    description: "5411 sayılı Kanun, usul-esas yönetmeliği ve bankacılık düzenlemeleri.",
    icon: "Landmark",
    color: "from-rose-600 to-pink-700",
    estimatedPages: "150-250",
    uploadFileName: "01-Bankacilik-Kanunu-5411.pdf",
    uploadGuide:
      "5411 sayılı Bankacılık Kanunu (güncel RG metni), Bankacılık Kanununa İlişkin Usul ve Esaslar Hakkında Yönetmelik (RG 1/11/2006-26333 ve güncellemeleri), Zorunlu Karşılıklar Hakkında 2013/15 Sayılı Tebliğ, Zorunlu Karşılıklar Uygulama Talimatı (TCMB — güncel metinler, mevzuat.gov.tr).",
  },
  {
    name: "Kambiyo Mevzuatı",
    slug: "zeliha-kambiyo",
    order: 2,
    description: "1567 sayılı Kambiyo Kanunu, 32 sayılı Karar ve kambiyo tebliğleri.",
    icon: "Scale",
    color: "from-amber-600 to-orange-700",
    estimatedPages: "100-180",
    uploadFileName: "02-Kambiyo-1567-Karar32.pdf",
    uploadGuide:
      "1567 sayılı Kambiyo Kanunu, 32 sayılı Karar (Kambiyo Kararı), TCMB ve Hazine ve Maliye Bakanlığı kambiyo tebliğleri (2026 güncel metinler — mevzuat.gov.tr).",
  },
  {
    name: "İthalat Rejimi",
    slug: "zeliha-ithalat-rejimi",
    order: 3,
    description: "2026 yılı İthalat Rejimi Kararı ve ithalat usul-esasları.",
    icon: "Globe",
    color: "from-sky-600 to-blue-700",
    estimatedPages: "80-150",
    uploadFileName: "03-Ithalat-Rejimi-Karari-2026.pdf",
    uploadGuide:
      "2026 yılı İthalat Rejimi Kararı (Ticaret Bakanlığı — yürürlükteki yıl kararı), İthalat Usul ve Esasları Hakkında Yönetmelik, ilgili ek listeler ve istisna tebliğleri.",
  },
  {
    name: "İhracat Rejimi",
    slug: "zeliha-ihracat-rejimi",
    order: 4,
    description: "2026 yılı İhracat Rejimi Kararı ve ihracat yönetmelikleri.",
    icon: "TrendingUp",
    color: "from-emerald-600 to-teal-700",
    estimatedPages: "80-150",
    uploadFileName: "04-Ihracat-Rejimi-Karari-2026.pdf",
    uploadGuide:
      "2026 yılı İhracat Rejimi Kararı, İhracat Yönetmeliği, ihracat/alıcı kredisi ve ihracat destekleri mevzuatıyla kesişen hükümler (varsa aynı PDF'e ekleyin).",
  },
  {
    name: "Gümrük Kanunu ve Dış Ticaret Temeli",
    slug: "zeliha-gumruk",
    order: 5,
    description: "4458 sayılı Gümrük Kanunu ve dış ticaret kanuni çerçevesi.",
    icon: "ScrollText",
    color: "from-violet-600 to-purple-700",
    estimatedPages: "120-200",
    uploadFileName: "05-Gumruk-Kanunu-4458.pdf",
    uploadGuide:
      "4458 sayılı Gümrük Kanunu (güncel), Gümrük Yönetmeliği'nden sık kullanılan bölümler, 1567/Dış Ticaret Kanunu referans hükümleri.",
  },
  {
    name: "Dış Ticaret İzleme (DİR, Birim Kıymet, Transfer Fiyatı)",
    slug: "zeliha-dis-ticaret-izleme",
    order: 6,
    description: "DİR, birim kıymet, transfer fiyatlandırması ve idari yaptırımlar.",
    icon: "BarChart3",
    color: "from-cyan-600 to-indigo-700",
    estimatedPages: "100-180",
    uploadFileName: "06-Dis-Ticaret-Izleme-DIR-Transfer-Fiyat.pdf",
    uploadGuide:
      "Dış Ticarette İzleme Rejimi (DİR) mevzuatı, birim kıymet/IBKB tebliğleri, transfer fiyatlandırması (GVK md. 13, BKK ve tebliğler), kambiyo ihlali idari yaptırımları.",
  },
  {
    name: "Kişisel Verilerin Korunması Kanunu",
    slug: "zeliha-kvkk-kanun",
    order: 7,
    description: "Kişisel Verilerin Korunması Kanunu (6698 sayılı) — dış mevzuat (Resmi Gazete / mevzuat.gov.tr).",
    icon: "ShieldCheck",
    color: "from-fuchsia-600 to-rose-700",
    estimatedPages: "40-80",
    uploadFileName: "07-KVKK-Kanun-6698.pdf",
    uploadGuide:
      "6698 sayılı Kişisel Verilerin Korunması Kanunu (güncel metin). Kaynak: kvkk.gov.tr / mevzuat.gov.tr. İndirilenler: kvkk kanun.pdf",
    gridGroup: "KVKK — Dış mevzuat",
    sourceKindLabel: "Dış mevzuat",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik",
    slug: "zeliha-kvkk-silinme-yonetmelik",
    order: 8,
    description: "Veri saklama süresi dolunca silme, yok etme ve anonimleştirme kuralları (28.10.2017).",
    icon: "ScrollText",
    color: "from-fuchsia-600 to-rose-700",
    estimatedPages: "15-30",
    uploadFileName: "08-KVKK-Silinme-Yonetmelik.pdf",
    uploadGuide:
      "Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik (RG 28.10.2017). Kaynak: kvkk.gov.tr / mevzuat.gov.tr.",
    sourceKindLabel: "Dış mevzuat",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Veri Sorumluları Sicili Hakkında Yönetmelik",
    slug: "zeliha-kvkk-verbis-yonetmelik",
    order: 9,
    description: "Veri sorumluları siciline (VERBİS) kayıt yükümlülüğü, beyan ve güncelleme usulleri (28.04.2019).",
    icon: "ClipboardList",
    color: "from-pink-600 to-fuchsia-700",
    estimatedPages: "20-40",
    uploadFileName: "09-KVKK-VERBIS-Yonetmelik.pdf",
    uploadGuide:
      "Veri Sorumluları Sicili Hakkında Yönetmelik (RG 28.04.2019). Veri sorumluları sicili (VERBİS) kayıt ve beyan yükümlülükleri bu yönetmelikte düzenlenir. Kaynak: kvkk.gov.tr / mevzuat.gov.tr.",
    sourceKindLabel: "Dış mevzuat",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Kişisel Verilerin Yurt Dışına Aktarılmasına İlişkin Usul ve Esaslar Hakkında Yönetmelik",
    slug: "zeliha-kvkk-yurt-disi-aktarim-yonetmelik",
    order: 10,
    description: "Yurt dışına veri aktarımı, yeterlilik kararı ve taahhütname usulleri (10.07.2024).",
    icon: "Globe",
    color: "from-rose-600 to-pink-700",
    estimatedPages: "25-45",
    uploadFileName: "10-KVKK-Yurt-Disi-Aktarim-Yonetmelik.pdf",
    uploadGuide:
      "Kişisel Verilerin Yurt Dışına Aktarılmasına İlişkin Usul ve Esaslar Hakkında Yönetmelik (RG 10.07.2024). Kaynak: kvkk.gov.tr / mevzuat.gov.tr.",
    sourceKindLabel: "Dış mevzuat",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ",
    slug: "zeliha-kvkk-aydinlatma-teblig",
    order: 11,
    description: "Veri sahibine bilgilendirme metni, içerik ve iletim kuralları (10.03.2018).",
    icon: "ScrollText",
    color: "from-fuchsia-600 to-rose-700",
    estimatedPages: "10-20",
    uploadFileName: "11-KVKK-Aydinlatma-Teblig.pdf",
    uploadGuide:
      "Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ (RG 10.03.2018). Kaynak: kvkk.gov.tr / mevzuat.gov.tr.",
    sourceKindLabel: "Dış mevzuat",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ",
    slug: "zeliha-kvkk-basvuru-teblig",
    order: 12,
    description: "Veri sahibi başvuru yolları, süreler ve cevaplama kuralları (10.03.2018).",
    icon: "ScrollText",
    color: "from-pink-600 to-fuchsia-700",
    estimatedPages: "10-20",
    uploadFileName: "12-KVKK-Basvuru-Teblig.pdf",
    uploadGuide:
      "Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ (RG 10.03.2018). Kaynak: kvkk.gov.tr / mevzuat.gov.tr.",
    sourceKindLabel: "Dış mevzuat",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Kişisel Verilerin Korunması Prosedürü",
    slug: "zeliha-kvkk-prosedur",
    order: 13,
    description: "Kurum içi prosedür — veri işleme, saklama ve başvuru süreçleri.",
    icon: "ClipboardList",
    color: "from-pink-600 to-fuchsia-700",
    estimatedPages: "30-60",
    uploadFileName: "13-KVKK-Prosedur.pdf",
    uploadGuide:
      "Şirket Kişisel Verilerin Korunması Prosedürü (güncel onaylı metin). İndirilenler: kişisel verilerin korunması prosedürü.pdf",
    gridGroup: "KVKK — İç mevzuat",
    sourceKindLabel: "İç mevzuat",
    sourceKind: "internal-procedure",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
  {
    name: "Kişisel Verilerin Korunması Politikası",
    slug: "zeliha-kvkk-politika",
    order: 14,
    description: "Kurum içi politika — veri sorumlusu taahhütleri ve ilkeler.",
    icon: "ScrollText",
    color: "from-rose-600 to-pink-700",
    estimatedPages: "20-40",
    uploadFileName: "14-KVKK-Politika.pdf",
    uploadGuide:
      "Şirket Kişisel Verilerin Korunması Politikası (güncel onaylı metin). İndirilenler: kişisel verilerin korunması politikası.pdf",
    sourceKindLabel: "İç mevzuat",
    sourceKind: "internal-policy",
    parentSlug: ZELIHA_KVKK_GROUP_SLUG,
    hiddenFromProgramGrid: true,
  },
]

/** Zeliha ana program gridinde görünen modüller (6 mevzuat + 1 KVKK grup kartı) */
export function getZelihaProgramGridSlugs(): string[] {
  const visible = ZELIHA_COURSES.filter(c => !c.hiddenFromProgramGrid).map(c => c.slug)
  return [...visible, ZELIHA_KVKK_GROUP_SLUG]
}

/** KVKK alt sayfasındaki 8 modül */
export function getZelihaKvkkChildCourses(): CourseInfo[] {
  return ZELIHA_COURSES.filter(c => c.parentSlug === ZELIHA_KVKK_GROUP_SLUG)
}

export const ALL_COURSES = [
  ...SPL_LEVEL_3_COURSES,
  ...MASAK_COURSES,
  ...SPL_BD_COURSES,
  ...CIA_COURSES,
  ...CISA_COURSES,
  ...SMMM_COURSES,
  ...ZELIHA_COURSES,
]

export function getCourseBySlug(slug: string): CourseInfo | undefined {
  return ALL_COURSES.find(c => c.slug === slug)
}

export function getCourseByOrder(order: number): CourseInfo | undefined {
  // Not: Sadece SPL_LEVEL_3 için geriye dönük uyumluluk
  return SPL_LEVEL_3_COURSES.find(c => c.order === order)
}

export function getExamConfig(programSlug: string): ExamConfig | undefined {
  if (programSlug === "spl-duzey-3") return SPL_EXAM_CONFIG
  if (programSlug === "masak") return MASAK_EXAM_CONFIG
  if (programSlug === "spl-bagimsiz-denetim") return SPL_BD_EXAM_CONFIG
  if (programSlug === "cia") return CIA_EXAM_CONFIG
  if (programSlug === "cisa") return CISA_EXAM_CONFIG
  if (programSlug === "smmm") return SMMM_EXAM_CONFIG
  return undefined
}

/** Program sayfasında gösterilecek kartlar — gerçek sınav parçası / ders / oturum sayısı kadar */
export function getExamPartCourseSlugs(programSlug: string): string[] {
  switch (programSlug) {
    case "spl-duzey-3":
      return SPL_LEVEL_3_COURSES.map(c => c.slug)
    case "masak":
      return MASAK_COURSES.map(c => c.slug)
    case "spl-bagimsiz-denetim":
      return SPL_BD_COURSES.map(c => c.slug)
    case "cia":
      return CIA_COURSES.map(c => c.slug)
    case "cisa":
      return CISA_COURSES.map(c => c.slug)
    case "smmm":
      return SMMM_COURSES.map(c => c.slug)
    case "zeliha-mevzuat":
      return getZelihaProgramGridSlugs()
    default:
      return []
  }
}

export const SPL_BD_EXAM_CONFIG: ExamConfig = {
  totalQuestions: 25,       // Ders başına 25 soru (resmi)
  durationMinutes: 45,      // Ders başına 45 dakika (resmi e-LS)
  passingScore: 60,         // Tüm derslerin ortalaması en az 60
  moduleBarrier: 50,        // Her dersten en az 50 puan
  modules: SPL_BD_COURSES.map(c => ({
    name: c.name,
    questionCount: 25,
    durationMinutes: 45,
    courses: [c.slug],
  })),
  negativeMarking: false,
  choiceCount: 5,
  examType: "e-sınav",
  sourceMode: "strict"
}

// ==================== CIA SINAV YAPISI (IIA) ====================
// Kaynak: theiia.org CIA Brochure + revize 2025 müfredat dokümanı (bkz. CIA_COURSES yorumları).
//   • 3 parça, tamamı çoktan seçmeli, 4 şıklı (Gleim/IIA: "four single-statement answer choices").
//   • Part 1: 125 soru / 150 dk | Part 2: 100 soru / 120 dk | Part 3: 100 soru / 120 dk
//   • Puanlama ÖLÇEKLİ (scaled): 250-750 aralığı, her parçada geçme = 600. (passingScore/moduleBarrier yüzde DEĞİL, ölçekli puandır.)
//   • Yanlış cevap cezası YOK (no penalty for incorrect answers).
export const CIA_EXAM_CONFIG: ExamConfig = {
  totalQuestions: 325,        // 125 + 100 + 100
  durationMinutes: 390,       // 150 + 120 + 120
  passingScore: 600,          // Ölçekli puan (250-750), her parça için ayrı ayrı 600
  moduleBarrier: 600,         // Her parçadan ayrı ayrı en az 600 ölçekli puan
  modules: [
    {
      name: "Part 1 — Internal Audit Fundamentals",
      questionCount: 125,
      durationMinutes: 150,
      courses: ["cia-part-1"]
    },
    {
      name: "Part 2 — Internal Audit Engagement",
      questionCount: 100,
      durationMinutes: 120,
      courses: ["cia-part-2"]
    },
    {
      name: "Part 3 — Internal Audit Function",
      questionCount: 100,
      durationMinutes: 120,
      courses: ["cia-part-3"]
    }
  ],
  negativeMarking: false,
  choiceCount: 4,
  examType: "Bilgisayarlı sınav (CBT) — çoktan seçmeli",
  sourceMode: "strict"
}

// ==================== CISA SINAV YAPISI (ISACA) ====================
// Kaynak: ISACA Exam Content Outline + Candidate Guide (bkz. CISA_COURSES yorumları).
//   • Tek oturum: 150 soru / 240 dk (4 saat), 4 şıklı çoktan seçmeli.
//   • Puanlama ÖLÇEKLİ (scaled): 200-800 aralığı, geçme = 450. (passingScore yüzde DEĞİL, ölçekli puandır.)
//   • Yanlış cevap cezası YOK. Domain/alan bazlı baraj YOKTUR; domain skorları yalnız bilgi amaçlıdır → moduleBarrier 0.
//   • 5 domain ağırlığı: D1 %18, D2 %18, D3 %12, D4 %26, D5 %26 (1 Ağustos 2024 içerik özeti).
//     Resmi olarak domain başına SABİT soru sayısı açıklanmadığından (pretest sorular dahil) tek oturum olarak modellendi.
export const CISA_EXAM_CONFIG: ExamConfig = {
  totalQuestions: 150,
  durationMinutes: 240,
  passingScore: 450,          // Ölçekli puan (200-800)
  moduleBarrier: 0,           // CISA'da domain bazlı baraj yok
  modules: [
    {
      name: "CISA — Tek Oturum (5 domain karışık)",
      questionCount: 150,
      durationMinutes: 240,
      courses: ["cisa"]
    }
  ],
  negativeMarking: false,
  choiceCount: 4,
  examType: "Bilgisayarlı sınav (CBT) — çoktan seçmeli",
  sourceMode: "strict"
}

// ==================== SMMM YETERLİLİK SINAV YAPISI (TÜRMOB / TESMER) ====================
// Kaynak: TÜRMOB/TESMER Sınav Yönetmeliği + resmi dönem duyuruları (bkz. SMMM_COURSES yorumları).
//   • 8 ders, her ders ayrı ayrı TEST usulü, 5 şıklı çoktan seçmeli, 2 oturum.
//   • Geçme: her dersten en az 50, ders ortalaması en az 60. Yanlış doğruyu götürmez.
//   • ⚠️ TEYİT GEREKİYOR: TÜRMOB resmi duyuruları ders BAŞINA SORU SAYISINI açıklamamaktadır → questionCount 0 bırakıldı.
//   • Ders süreleri 2025/1 resmi TESMER sınav programındaki oturum saatlerinden türetilmiştir
//     (https://www.tesmer.org.tr/?p=6156) ANCAK süreler dönemden döneme değişebilir → kesin standart değildir.
export const SMMM_EXAM_CONFIG: ExamConfig = {
  totalQuestions: 0,          // TODO: TEYİT GEREKİYOR — ders başına soru sayısı resmi kaynakta yok
  durationMinutes: 870,       // 2025/1 programındaki oturum sürelerinin toplamı (dönemsel değişebilir)
  passingScore: 60,           // Ders ortalaması en az 60
  moduleBarrier: 50,          // Her dersten en az 50
  modules: [
    // durationMinutes değerleri 2025/1 resmi programındaki oturum saatlerinden; dönemsel değişebilir.
    // questionCount değerleri resmi kaynakta YOK → 0 (TODO: TEYİT GEREKİYOR).
    { name: "Finansal Muhasebe", questionCount: 0, durationMinutes: 180, courses: ["smmm-finansal-muhasebe"] },
    { name: "Maliyet Muhasebesi", questionCount: 0, durationMinutes: 90, courses: ["smmm-maliyet-muhasebesi"] },
    { name: "Finansal Tablolar ve Analizi", questionCount: 0, durationMinutes: 90, courses: ["smmm-finansal-tablolar-analizi"] },
    { name: "Muhasebe Denetimi", questionCount: 0, durationMinutes: 90, courses: ["smmm-muhasebe-denetimi"] },
    { name: "Vergi Mevzuatı ve Uygulaması", questionCount: 0, durationMinutes: 90, courses: ["smmm-vergi-mevzuati"] },
    { name: "Hukuk", questionCount: 0, durationMinutes: 90, courses: ["smmm-hukuk"] },
    { name: "Sermaye Piyasası Mevzuatı", questionCount: 0, durationMinutes: 60, courses: ["smmm-sermaye-piyasasi-mevzuati"] },
    { name: "Muhasebecilik ve Mali Müşavirlik Meslek Hukuku", questionCount: 0, durationMinutes: 90, courses: ["smmm-meslek-hukuku"] }
  ],
  negativeMarking: false,
  choiceCount: 5,
  examType: "test (çoktan seçmeli) — 2 oturum",
  sourceMode: "enriched"
}

// ==================== DENEME SINAVI YARDIMCILARI ====================

export type ScoreDisplayMode = "percent" | "scaled"

export function getScoreDisplayMode(config: ExamConfig): ScoreDisplayMode {
  return config.passingScore > 100 ? "scaled" : "percent"
}

export function getScaledScoreRange(config: ExamConfig): { min: number; max: number } | null {
  if (config.passingScore >= 600) return { min: 250, max: 750 }
  if (config.passingScore >= 450) return { min: 200, max: 800 }
  return null
}

/** Doğru cevap oranından tahmini ölçekli puan (CISA/CIA denemeleri için) */
export function estimateScaledScore(correct: number, total: number, config: ExamConfig): number {
  if (total === 0) return 0
  const ratio = correct / total
  const range = getScaledScoreRange(config)
  if (!range) return Math.round(ratio * 100)
  return Math.round(range.min + ratio * (range.max - range.min))
}

export interface CourseMockExamParams {
  questionCount: number
  durationMinutes: number
  passingScore: number
  moduleBarrier: number
  choiceCount: number
  negativeMarking: boolean
  examType: string
  scoreDisplayMode: ScoreDisplayMode
  minQuestionPool: number
}

/** Belirli bir ders kartı için deneme sınavı parametreleri */
export function getCourseMockExamParams(programSlug: string, courseSlug: string): CourseMockExamParams | undefined {
  const config = getExamConfig(programSlug)
  if (!config) return undefined

  const module = config.modules.find(m => m.courses.includes(courseSlug))
  const rawQuestionCount = module?.questionCount || config.totalQuestions || 25
  const questionCount = rawQuestionCount > 0 ? rawQuestionCount : 25

  return {
    questionCount,
    durationMinutes: module?.durationMinutes ?? config.durationMinutes,
    passingScore: config.passingScore,
    moduleBarrier: config.moduleBarrier,
    choiceCount: config.choiceCount,
    negativeMarking: config.negativeMarking,
    examType: config.examType,
    scoreDisplayMode: getScoreDisplayMode(config),
    minQuestionPool: programSlug === "masak" ? questionCount : 5,
  }
}

