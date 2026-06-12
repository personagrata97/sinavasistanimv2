"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search, ChevronDown, Target, BookOpen, Layers, HelpCircle, BarChart3, Clock, Trophy, CalendarDays, Brain } from "lucide-react"

export const COURSE_TABS = [
  { id: "overview", label: "Genel", icon: Target },
  { id: "notes", label: "Ders Notları", icon: BookOpen },
  { id: "flashcards", label: "Flashcard", icon: Layers },
  { id: "questions", label: "Sorular", icon: HelpCircle },
  { id: "coverage", label: "Kapsam", icon: BarChart3 },
  { id: "mock_exam", label: "Deneme", icon: Clock },
  { id: "achievements", label: "Rozet", icon: Trophy },
  { id: "goals", label: "Program", icon: CalendarDays }
]

// ==================== EMPTY STATE ====================
export function EmptyState({ tabId, icon: IconFallback, title, description, action }: { tabId?: string, icon?: any, title: string, description: string, action?: React.ReactNode }) {
  const tab = COURSE_TABS.find(t => t.id === tabId)
  const FinalIcon = tab?.icon || IconFallback || Brain

  return (
    <div className="p-12 rounded-2xl border-2 border-dashed border-white/5 text-center">
      <FinalIcon className="w-12 h-12 text-slate-700 mx-auto mb-4" />
      <h3 className="text-lg font-bold text-slate-400 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 max-w-md mx-auto">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

// ==================== LOADING SKELETON ====================
export function LoadingSkeleton() {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-pulse p-4">
      <div className="h-8 bg-white/5 rounded-lg w-1/3 mb-8"></div>
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
            <div className="flex gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/5 shrink-0"></div>
              <div className="flex-1 space-y-3">
                <div className="h-5 bg-white/5 rounded w-1/4"></div>
                <div className="h-4 bg-white/5 rounded w-3/4"></div>
                <div className="h-4 bg-white/5 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ==================== BADGE ====================
type BadgeProps = { children: React.ReactNode; variant?: "default" | "success" | "warning" | "danger" | "info"; className?: string }
export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variants = {
    default: "bg-slate-800 text-slate-300 border-slate-700",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    danger: "bg-red-500/10 text-red-400 border-red-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}

// ==================== MODAL ====================
type ModalProps = {
  children: React.ReactNode
  onClose: () => void
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl"
  title?: string
  icon?: React.ReactNode
  showClose?: boolean
  zIndex?: number
  className?: string
  overflowVisible?: boolean
}

export function Modal({
  children,
  onClose,
  maxWidth = "md",
  title,
  icon,
  showClose = true,
  zIndex = 50,
  className = "",
  overflowVisible = false
}: ModalProps) {
  const maxWMap = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm no-print"
      style={{ zIndex }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className={`w-full ${maxWMap[maxWidth]} p-6 rounded-3xl bg-[#060912]/80 border border-white/[0.08] shadow-[0_0_50px_rgba(59,130,246,0.15)] relative ${overflowVisible ? '' : 'overflow-hidden'} text-left backdrop-blur-md ${className}`}
      >
        {/* Top Premium Gradient Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500" />

        {/* Optional Title Header */}
        {(title || icon) && (
          <div className="flex items-center gap-3 mb-5 mt-1">
            {icon && (
              <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                {icon}
              </div>
            )}
            <div>
              {title && <h3 className="text-base font-bold text-white line-clamp-1 pr-6">{title}</h3>}
            </div>
          </div>
        )}

        {/* Close Button */}
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white transition-all shadow-sm"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className={`relative z-10 ${overflowVisible ? '' : 'max-h-[70vh] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-white/10'}`}>
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ==================== FORMAT TITLE ====================
export const formatTitle = (title: string, index?: number, notes?: string, moduleName?: string) => {
  const isGeneric = (str: string) => {
    if (!str) return true;
    const lower = str.toLocaleLowerCase('tr-TR');
    return lower.includes('bölüm içeriği') || lower.includes('bu bölüm ne anlatıyor') || lower.includes('kaynak metin');
  }

  const toTitleCase = (str: string) => {
    let lower = str.toLocaleLowerCase('tr-TR');
    let title = lower.replace(/(?:^|[\s\[\(\-])([a-zçğıöşü])/g, (match) => match.toLocaleUpperCase('tr-TR'));
    const conjunctions = ['ve', 'ile', 'veya', 'de', 'da', 'ki'];
    conjunctions.forEach(c => {
      title = title.replace(new RegExp(`\\s${c}\\s`, 'gi'), ` ${c} `);
    });
    const acronyms = ["MASAK", "CMK", "SPK", "AB", "BDDK", "TCMB", "MKK", "AŞ", "PDF", "KVHS", "SPL", "ŞİB", "FATF"];
    acronyms.forEach(ac => {
      const lowerAc = ac.toLocaleLowerCase("tr-TR");
      const titleAc = lowerAc.replace(/^[a-zçğıöşü]/g, m => m.toLocaleUpperCase("tr-TR"));

      const escapedLower = lowerAc.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const escapedTitle = titleAc.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const escapedAc = ac.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

      title = title.replace(new RegExp(`(^|[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ])(${escapedLower}|${escapedTitle}|${escapedAc})([^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]|$)`, 'g'), `$1${ac}$3`);
    });
    return title;
  }

  let formatted = "";

  // 1. If title has custom tag like [Modül 1]
  if (title && title.includes('[') && title.includes(']')) {
    formatted = toTitleCase(title.replace(/^\d+[\.\-\)]\s*/, ''))
  }
  // 2. Prioritize meaningful database section title first
  else if (title && title.length > 3 && title.length < 150 && !isGeneric(title)) {
    // Strip leading numbers like "1. " or "2-" before applying title case
    formatted = toTitleCase(title.replace(/^\d+[\.\-\)]\s*/, ''))
  }
  // 3. Fallback to notes markdown headings if DB title is generic or missing
  else if (notes) {
    let found = false;
    const headings = [...notes.matchAll(/^#+\s+(.+)/gm)]
    for (const match of headings) {
      let heading = match[1].replace(/[📌🔑📊⚖️🏛️💡🔍📋✅❌📝🎯]/gu, '').trim()
      heading = heading.replace(/^\d+[\.\-\)]\s*/, '')
      if (heading.length > 3 && heading.length < 120 && !isGeneric(heading)) {
        formatted = toTitleCase(heading);
        found = true;
        break;
      }
    }
    if (!found) {
      formatted = index !== undefined ? `Ünite ${index + 1}` : "Ders Notu";
    }
  }
  // 4. Fallback to index or default
  else {
    formatted = index !== undefined ? `Ünite ${index + 1}` : "Ders Notu";
  }

  // Sadece MASAK gibi gerçek Modül sistemlerinde parantez içi ekini göster (Bilgi Sistemleri Güvenliği gibi derslerde çirkin mükerrerliği önler)
  if (moduleName && (moduleName === "Modül 1" || moduleName === "Modül 2")) {
    const suffix = moduleName === "Modül 1"
      ? " (Modül 1: Hukuki Çerçeve)"
      : " (Modül 2: Uyum Yönetimi)";
        
    const formattedLower = formatted.toLocaleLowerCase('tr-TR');
    const moduleLower = moduleName.toLocaleLowerCase('tr-TR');
    
    if (!formatted.endsWith(suffix) && !formattedLower.includes(moduleLower) && !moduleLower.includes(formattedLower)) {
      formatted += suffix;
    }
  }

  return formatted;
};
// ==================== CLEAN MARKDOWN ====================
export const cleanMarkdown = (md: string, removeFirstHeader = false) => {
  if (!md) return "";
  let clean = md;

  // 1. Agresif Yapay Zeka Sızıntısı (Preamble) Temizliği
  // Genelde notlar ilk başlıkla (# veya 📌 vb.) başlar. Eğer ilk başlıktan önce anlamsız
  // bir "Aşağıda müfettiş geri bildirimleri..." metni varsa o paragrafı kökünden kes.
  const firstHeadingIdx = clean.search(/^#|^\s*(?:📌|📍|📝|🎯|🚀)\s*(?:#|Bölüm|Konu)/m);
  if (firstHeadingIdx > 0) {
    const preamble = clean.substring(0, firstHeadingIdx);
    if (
      (preamble.toLowerCase().includes("aşağıda") && preamble.toLowerCase().includes("not")) ||
      preamble.toLowerCase().includes("müfettiş") ||
      preamble.toLowerCase().includes("kontrolör") ||
      preamble.toLowerCase().includes("eksiksiz")
    ) {
      clean = clean.substring(firstHeadingIdx).trim();
    }
  }

  // 2. Metnin içinde rastgele yerlerde kalan spesifik halüsinasyonları temizle
  clean = clean.replace(/Aşağıda,?\s*müfettiş geri bildirimleri doğrultusunda.*?ders notu yer almaktadır\.?/gi, "");
  clean = clean.replace(/Aşağıda.*?güncellenmiş.*?ders notu yer almaktadır\.?/gi, "");
  clean = clean.replace(/Müfettiş geri bildirimleri doğrultusunda/gi, "");

  if (removeFirstHeader) {
    // Sadece ilk başlık "Bu Bölüm Ne Anlatıyor" içermiyorsa kaldır (accordion header'da zaten gösteriliyor)
    const firstHeaderMatch = clean.match(/^\s*#{1,6}\s+([^\n]+)/);
    if (firstHeaderMatch) {
      const headerTitle = firstHeaderMatch[1].toLowerCase();
      if (!headerTitle.includes("ne anlatıyor") && !headerTitle.includes("ne anlatiyor")) {
        clean = clean.replace(/^\s*#{1,6}\s+[^\n]+\n?/, "");
      }
    }
  }
  
  // Mükerrer başlık hash işaretlerini temizle (örn: "### #### 1. Yasal" -> "### 1. Yasal")
  clean = clean.replace(/^(#{1,6})\s*#+\s+/gm, "$1 ");

  // "Sözlüğü [Konu Adı]" vb. bozuk bükümleri "Konu Adı Sözlüğü" olarak düzelt
  clean = clean.replace(/(Sözlüğü|Özeti|Notları|Kılavuzu|Rehberi|Analizi)\s*\[(.*?)\]/g, "$2 $1");

  // Kendini Test Et! kısmındaki çoktan seçmeli şıkları (A) B) C) vb.) alt alta düzgünce sırala
  clean = clean.replace(/\s+([A-E]\))/g, '\n\n**$1** ');

  // Sorulardaki I. II. veya 1. 2. gibi öncülleri (maddeleri) markdown alıntı kutusuna dönüştür
  // Böylece PremiumMarkdownRenderer onları şık bir kutu ve çizgi ile gösterir
  clean = clean.replace(/^(I|II|III|IV|V|VI|[1-9])\.\s+(.*?)$/gm, '> **$1.** $2');

  // Soru başlıklarını belirginleştir (Soru 1:, Soru 2: vb.) ve aralarını aç
  // Eğer yapay zeka zaten bold yapmışsa (**Soru 1:**), onu iki kere bold yapmamak için önce yıldızları temizle
  clean = clean.replace(/\*\*(Soru \d+:)\*\*/g, '$1');
  clean = clean.replace(/(Soru \d+:)/g, '\n\n**$1** ');

  return clean.trim();
};

// ==================== COMPLETE TURKISH SENTENCE ====================
export const completeTurkishSentence = (text: string): string => {
  let trimmed = text.trim();
  if (!trimmed) return "";

  // Eğer zaten uygun bir noktalama işaretiyle bitiyorsa dokunma (nokta, ünlem, soru işareti vb.)
  if (/[.?!]$/.test(trimmed)) {
    return trimmed;
  }

  // Sondaki virgülü temizle
  let base = trimmed.replace(/,$/, '').trim();

  const words = base.split(/\s+/);
  const lastWord = words[words.length - 1];
  if (!lastWord) return trimmed;

  const lowerLast = lastWord.toLowerCase();

  const replacements: Record<string, string> = {
    "varlıkları": "varlıklardır",
    "varlığı": "varlığıdır",
    "faaliyetleri": "faaliyetleridir",
    "faaliyeti": "faaliyetidir",
    "işlemleri": "işlemleridir",
    "işlemi": "işlemidir",
    "suçları": "suçlarıdır",
    "suçu": "suçudur",
    "cezası": "cezasıdır",
    "cezaları": "cezalarıdır",
    "yükümlülüğü": "yükümlülüğüdür",
    "yükümlülükleri": "yükümlülükleridir",
    "süreleri": "süreleridir",
    "süresi": "süresidir",
    "limiti": "limitidir",
    "limitleri": "limitleridir",
    "cüzdanı": "cüzdanıdır",
    "cüzdanları": "cüzdanlarıdır",
    "fonu": "fonudur",
    "hizmeti": "hizmetidir",
    "hizmetleri": "hizmetleridir",
    "kurumu": "kurumudur",
    "kurumları": "kurumlarıdır",
    "kuruluşu": "kuruluşudur",
    "kuruluşları": "kuruluşlarıdır",
    "ortaklığı": "ortaklığıdır",
    "ortaklıkları": "ortaklıklarıdır",
    "şirketi": "şirketidir",
    "şirketleri": "şirketleridir",
    "piyasası": "piyasasıdır",
    "piyasaları": "piyasalarıdır",
    "aracı": "aracıdır",
    "araçları": "araçlarıdır",
    "sistemi": "sistemidir",
    "sistemleri": "sistemleridir",
    "süreci": "sürecidir",
    "süreçleri": "süreçleridir",
    "esasları": "esaslarıdır",
    "esası": "esasıdır",
    "tanımı": "tanımıdır",
    "tanımları": "tanımlarıdır",
    "kriterleri": "kriterleridir",
    "kriteri": "kriteridir",
    "değerleri": "değerleridir",
    "değeri": "değeridir"
  };

  let replaced = false;
  for (const [key, replacement] of Object.entries(replacements)) {
    if (lowerLast === key) {
      const isUpper = lastWord === lastWord.toUpperCase();
      words[words.length - 1] = isUpper ? replacement.toUpperCase() : replacement;
      base = words.join(" ") + ".";
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    if (lowerLast.endsWith("ları")) {
      words[words.length - 1] = lastWord + "dır";
      base = words.join(" ") + ".";
      replaced = true;
    } else if (lowerLast.endsWith("leri")) {
      words[words.length - 1] = lastWord + "dir";
      base = words.join(" ") + ".";
      replaced = true;
    }
  }

  if (!replaced && trimmed.endsWith(",")) {
    return base + ".";
  }

  return base;
};

// ==================== CONFETTI ====================
export function ConfettiEffect() {
  const particles = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1.5 + Math.random() * 1,
    color: ['#6366f1', '#8b5cf6', '#a78bfa', '#c084fc', '#e879f9', '#22d3ee', '#34d399', '#fbbf24'][Math.floor(Math.random() * 8)],
    size: 4 + Math.random() * 6,
  }))

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ y: -20, x: `${p.x}vw`, opacity: 1, rotate: 0 }}
          animate={{ y: '100vh', opacity: 0, rotate: 720 }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
          style={{ position: 'absolute', width: p.size, height: p.size, borderRadius: Math.random() > 0.5 ? '50%' : '2px', backgroundColor: p.color }}
        />
      ))}
    </div>
  )
}

export function formatQuestionText(text: string) {
  if (!text) return text;
  let formatted = text
    .replace(/(?<=^|\s)(I|II|III|IV|V|VI)\.\s/g, '\n$1. ')
    .replace(/(?<=^|\s)([1-9])\.\s/g, '\n$1. ')
    .replace(/(?<=^|\s)(Yukarıdakilerden|Buna göre|Aşağıdakilerden|Verilenlerden|Hangisi|Hangileri|Buna)/g, '\n$1');
    
  return formatted.split('\n').filter(line => line.trim().length > 0).map((line, i) => {
    const trimmed = line.trim();
    const isListItem = /^(I|II|III|IV|V|VI|[1-9])\.\s/.test(trimmed);
    
    if (isListItem) {
      const dotIndex = trimmed.indexOf('.');
      const num = trimmed.substring(0, dotIndex + 1);
      const content = trimmed.substring(dotIndex + 1).trim();
      return (
        <div key={i} className="mt-2 ml-2 md:ml-4 py-2 px-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-200/90 text-sm font-medium leading-relaxed">
          <span className="font-bold text-blue-400 mr-2">{num}</span>
          {content}
        </div>
      )
    }
    
    return (
      <div key={i} className={i > 0 ? "mt-4 text-base" : "text-base"}>
        {trimmed}
      </div>
    )
  });
}

export function formatMockExamQuestionText(text: string) {
  if (!text) return text;
  let formatted = text
    .replace(/(?<=^|\s)(I|II|III|IV|V|VI)\.\s/g, '\n$1. ')
    .replace(/(?<=^|\s)([1-9])\.\s/g, '\n$1. ')
    .replace(/(?<=^|\s)(Yukarıdakilerden|Buna göre|Aşağıdakilerden|Verilenlerden|Hangisi|Hangileri|Buna)/g, '\n$1');
    
  return formatted.split('\n').filter(line => line.trim().length > 0).map((line, i) => {
    const trimmed = line.trim();
    const isListItem = /^(I|II|III|IV|V|VI|[1-9])\.\s/.test(trimmed);
    
    if (isListItem) {
      return (
        <div key={i} className="mt-2 ml-4">
          {trimmed}
        </div>
      )
    }
    return <span key={i} className={i > 0 ? "block mt-3" : ""}>{trimmed} </span>;
  })
}

// Helper to remove references to 'kaynak metin' or 'yapay zeka' and format cleanly for students
export function cleanExplanationText(text: string): string {
  if (!text) return text
  return text
    .replace(/kaynak metne/g, "mevzuata")
    .replace(/Kaynak metne/g, "Mevzuata")
    .replace(/ders notlarına/g, "mevzuata")
    .replace(/Ders notlarına/g, "Mevzuata")
    .replace(/Ders Notlarına/g, "Mevzuata")

    .replace(/kaynak metinde/g, "mevzuatta")
    .replace(/Kaynak metinde/g, "Mevzuatta")
    .replace(/ders notlarında/g, "mevzuatta")
    .replace(/Ders notlarında/g, "Mevzuatta")
    .replace(/Ders Notlarında/g, "Mevzuatta")

    .replace(/kaynak metnin/g, "mevzuatın")
    .replace(/Kaynak metnin/g, "Mevzuatın")
    .replace(/ders notlarının/g, "mevzuatın")
    .replace(/Ders notlarının/g, "Mevzuatın")
    .replace(/Ders Notlarının/g, "Mevzuatın")

    .replace(/kaynak metin/g, "mevzuat")
    .replace(/Kaynak metin/g, "Mevzuat")
    .replace(/ders notları/g, "mevzuat")
    .replace(/Ders notları/g, "Mevzuat")
    .replace(/Ders Notları/g, "Mevzuat")

    .replace(/kaynak dökümanın/g, "mevzuatın")
    .replace(/kaynak dokümanın/g, "mevzuatın")
    .replace(/kaynak dökümanda/g, "mevzuatta")
    .replace(/kaynak dokümanda/g, "mevzuatta")
    .replace(/kaynak dökümana/g, "mevzuata")
    .replace(/kaynak dokümana/g, "mevzuata")
    .replace(/kaynak döküman/g, "mevzuat")
    .replace(/kaynak doküman/g, "mevzuat")

    .replace(/yapay zekâ/g, "akıllı asistan")
    .replace(/Yapay zekâ/g, "Akıllı asistan")
    .replace(/yapay zeka/g, "akıllı asistan")
    .replace(/Yapay zeka/g, "Akıllı asistan")
    .replace(/\n+\s*❌/g, "\n\n❌")
    .replace(/\n+\s*💡/g, "\n\n💡")
    .replace(/\[KAYNAK BAŞLIĞI:.*?\]/gi, "")
    .trim()
}

import { PremiumMarkdownRenderer } from "./PremiumMarkdownRenderer"

export function SplitNotesLayout({
  isOpen,
  onClose,
  title,
  notes,
  children,
  autoScrollKeyword
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  notes: string
  children: React.ReactNode
  autoScrollKeyword?: string
}) {
  const [searchTerm, setSearchTerm] = useState("")
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatch, setActiveMatch] = useState(0)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && matchCount > 0) {
       setActiveMatch(prev => (prev + 1) % matchCount)
    }
  }

  // Arama değiştiğinde aktif index'i sıfırla
  useEffect(() => {
    setActiveMatch(0)
  }, [searchTerm])

  // Layout kapandığında arama kutusunu temizle
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm("")
      setMatchCount(0)
      setActiveMatch(0)
    }
  }, [isOpen])

  const renderNotes = () => (
    <PremiumMarkdownRenderer 
      content={notes}
      searchTerm={searchTerm}
      autoScrollKeyword={autoScrollKeyword}
      activeMatchIndex={activeMatch}
      onMatchCountChange={setMatchCount}
    />
  )

  return (
    <>
      {/* Mobile: Standard Modal Fallback */}
      <div className="xl:hidden w-full">
        {children}
        <AnimatePresence>
          {isOpen && notes && (
            <Modal onClose={onClose} title={title} maxWidth="2xl">
              <div className="mb-4 relative">
                 <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                 <input 
                   type="text" 
                   value={searchTerm}
                   onChange={e => setSearchTerm(e.target.value)}
                   onKeyDown={handleKeyDown}
                   placeholder="Notlar içinde ara..."
                   className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-16 text-sm text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                 />
                 {searchTerm && (
                   <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">
                     {matchCount > 0 ? `${activeMatch + 1}/${matchCount}` : "0/0"}
                   </div>
                 )}
              </div>
              {renderNotes()}
            </Modal>
          )}
        </AnimatePresence>
      </div>

      {/* Desktop: Split Screen Animation */}
      <div className="hidden xl:flex items-start transition-all duration-500 w-full relative">
        <motion.div 
          layout
          className={`transition-all duration-500 ${isOpen ? "w-[40%] pr-6" : "w-full"}`}
        >
          <div className={`${isOpen ? "max-w-none" : "max-w-3xl mx-auto"}`}>
            {children}
          </div>
        </motion.div>

        <AnimatePresence>
          {isOpen && notes && (
            <motion.div
              initial={{ opacity: 0, width: 0, scale: 0.95 }}
              animate={{ opacity: 1, width: "60%", scale: 1 }}
              exit={{ opacity: 0, width: 0, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="sticky top-24 shrink-0 border border-white/10 bg-[#060912]/80 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[calc(100vh-8rem)]"
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-indigo-500" />
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-white line-clamp-1">{title}</h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ara..."
                      className="w-48 bg-white/5 border border-white/10 rounded-lg py-1.5 pl-9 pr-14 text-sm text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                    />
                    {searchTerm && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-medium bg-[#060912] px-1 rounded">
                        {matchCount > 0 ? `${activeMatch + 1}/${matchCount}` : "0"}
                      </div>
                    )}
                  </div>
                  <button onClick={onClose} className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 h-full">
                {renderNotes()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

// ==================== CUSTOM SELECT ====================
export function CustomSelect({
  value,
  onChange,
  options,
  label
}: {
  value: string
  onChange: (val: string) => void
  options: { label: string; value: string }[]
  label?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedLabel = options.find(o => o.value === value)?.label || "Seçiniz"

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-sm font-medium text-slate-300 transition-all focus:outline-none"
      >
        <div className="flex items-center gap-2">
          {label && <span className="text-xs font-bold text-slate-500 whitespace-nowrap">{label}</span>}
          <span className="truncate">{selectedLabel}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 min-w-[200px] mt-2 p-1.5 rounded-xl border border-white/[0.08] bg-[#0f172a] shadow-2xl z-50 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10"
            >
              {options.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value)
                    setIsOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all whitespace-nowrap ${
                    value === opt.value
                      ? "bg-blue-500/20 text-blue-400 font-bold"
                      : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
