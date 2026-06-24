/** OCR damgalarını kaldırarak ham metni döndürür */
export function stripOcrPrefixes(rawContent: string): string {
  return rawContent
    .replace(/^\[MARKDOWN_OCR_SUCCESS\][^\n]*\n?/m, "")
    .replace(/^\[VISUAL_OCR_COMPLETE\][^\n]*\n?/m, "")
    .replace(/^\n+/, "")
}

export type RawContentSlice = {
  rawContent: string
  charStart?: number | null
  charEnd?: number | null
  sliceKind?: string | null
}

/**
 * Bölümün AI'a gidecek etkin kaynak metni.
 * char_range dilimlerinde rawContent zaten kesilmiş metindir.
 * page_range üst bölümlerde charStart/charEnd null ise tam metin kullanılır.
 */
export function getEffectiveRawContent(section: RawContentSlice): string {
  if (section.sliceKind === "char_range") {
    return stripOcrPrefixes(section.rawContent)
  }

  const full = stripOcrPrefixes(section.rawContent)
  const start = section.charStart
  const end = section.charEnd
  if (start != null && end != null && end > start && start >= 0) {
    const bodyStart = section.rawContent.length - full.length
    const sliceStart = bodyStart + start
    const sliceEnd = bodyStart + end
    return section.rawContent.slice(sliceStart, sliceEnd)
  }
  return full
}
