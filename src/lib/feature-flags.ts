/** Merkezi özellik bayrakları — varsayılan açık; "false" veya "0" ile kapatılır */

export function isFeatureEnabled(flag: string, defaultEnabled = true): boolean {
  const val = process.env[flag]
  if (val === undefined || val === "") return defaultEnabled
  return val !== "false" && val !== "0"
}

export const SECTION_UNIFIED_ZIRH = () => isFeatureEnabled("SECTION_UNIFIED_ZIRH", true)
export const CHAR_SLICE_RESOLUTION = () => isFeatureEnabled("CHAR_SLICE_RESOLUTION", true)
export const STRICT_READY_GATE = () => isFeatureEnabled("STRICT_READY_GATE", true)

export const QUALITY_CONTRACT_ENABLED = () => isFeatureEnabled("QUALITY_CONTRACT_ENABLED", true)
export const KONTROLOR_ENSEMBLE = () => isFeatureEnabled("KONTROLOR_ENSEMBLE", true)
export const OCR_POST_PROCESS = () => isFeatureEnabled("OCR_POST_PROCESS", true)
export const CONTENT_DEDUP = () => isFeatureEnabled("CONTENT_DEDUP", true)
export const ADVERSARIAL_QUESTIONS = () => isFeatureEnabled("ADVERSARIAL_QUESTIONS", true)
export const CHAR_SLICE_V2 = () => isFeatureEnabled("CHAR_SLICE_V2", true)
