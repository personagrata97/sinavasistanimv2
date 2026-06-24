import { isGlossarySectionTitle } from "@/lib/glossary-utils"

export type GlossaryEntry = {
  term: string
  definition: string
  source: "notes" | "raw"
}

export type GlossaryExtractionResult = {
  entries: GlossaryEntry[]
  dict: Record<string, string>
  crossCheck: {
    inBoth: string[]
    onlyNotes: string[]
    onlyRaw: string[]
    mismatch: Array<{ term: string; notesDef: string; rawDef: string }>
  }
}

const LINE_PATTERNS = [
  /^(?:\*\s+)?\*\*([^:*]+):\*\*\s*(.+)$/,
  /^-\s+\*\*([^*\-—]+)\*\*\s*[—\-:]\s*(.+)$/,
  /^\*\s+([A-ZÇĞİÖŞÜ0-9][^:*]{1,40})\s*:\s*(.+)$/,
  /^####\s+([^\(]+)(?:\([^\)]*\))?\s*$/,
  /^###\s+(?:\s*)?([^\(]+?)(?:\s*\([^\)]*\))?\s*$/,
]

function extractFromNotes(notes: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []
  const lines = notes.split("\n")
  for (const line of lines) {
    const clean = line.trim()
    if (!clean) continue
    for (const pat of LINE_PATTERNS) {
      const m = clean.match(pat)
      if (m && m[1] && m[2]) {
        const term = m[1].trim()
        const definition = m[2].trim()
        if (term.length >= 2 && definition.length >= 3) {
          entries.push({ term, definition, source: "notes" })
        }
        break
      }
    }
  }
  return entries
}

function extractFromRawAbbrevSection(rawContent: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []
  const upper = rawContent.toLocaleUpperCase("tr-TR")
  
  let idx = upper.indexOf("KISALTMALAR")
  if (idx === -1) idx = upper.indexOf("ABBREVIATIONS")
  if (idx === -1) idx = upper.indexOf("KISALTMALAR VE TANIMLAR")
  if (idx === -1) idx = upper.indexOf("TANIMLAR VE TERİMLER")
  if (idx === -1) return entries

  const slice = rawContent.slice(idx, idx + 15000)
  const lines = slice.split("\n")
  for (const line of lines) {
    const m = line.trim().match(/^([A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9a-zçğıöşü.\-]{1,25})\s*[:\-—]\s*(.+)$/)
    if (m) {
      entries.push({ term: m[1].trim(), definition: m[2].trim(), source: "raw" })
    }
  }
  return entries
}

/** Yapılandırılmış sözlük çıkarımı + ham KISALTMALAR çapraz kontrolü */
export function extractStructuredGlossary(
  notes: string,
  rawContent?: string,
  sectionTitle?: string,
): GlossaryExtractionResult {
  const isGlossary = sectionTitle ? isGlossarySectionTitle(sectionTitle) : true
  const notesEntries = isGlossary ? extractFromNotes(notes) : []
  const rawEntries = rawContent ? extractFromRawAbbrevSection(rawContent) : []

  const dict: Record<string, string> = {}
  for (const e of notesEntries) {
    dict[e.term] = e.definition
  }

  const notesTerms = new Set(notesEntries.map((e) => e.term.toLocaleUpperCase("tr-TR")))
  const rawTerms = new Set(rawEntries.map((e) => e.term.toLocaleUpperCase("tr-TR")))
  const rawMap = new Map(rawEntries.map((e) => [e.term.toLocaleUpperCase("tr-TR"), e.definition]))

  const inBoth: string[] = []
  const onlyNotes: string[] = []
  const onlyRaw: string[] = []
  const mismatch: Array<{ term: string; notesDef: string; rawDef: string }> = []

  for (const term of notesTerms) {
    if (rawTerms.has(term)) {
      inBoth.push(term)
      const nDef = notesEntries.find((e) => e.term.toLocaleUpperCase("tr-TR") === term)?.definition ?? ""
      const rDef = rawMap.get(term) ?? ""
      if (nDef && rDef && normalizeDef(nDef) !== normalizeDef(rDef)) {
        mismatch.push({ term, notesDef: nDef, rawDef: rDef })
      }
    } else onlyNotes.push(term)
  }
  for (const term of rawTerms) {
    if (!notesTerms.has(term)) onlyRaw.push(term)
  }

  return {
    entries: notesEntries,
    dict,
    crossCheck: { inBoth, onlyNotes, onlyRaw, mismatch },
  }
}

function normalizeDef(s: string): string {
  return s.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim()
}
