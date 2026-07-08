// E-32: Gemini File URI yönetimi — DRY helper
// Bu dosya, PDF'lerin Gemini File API'ye yüklenmesi ve URI'lerinin yönetilmesi için
// merkezi bir yardımcı fonksiyon sağlar. Daha önce upload route, process route ve
// refineSectionNotesAction'da aynı kod 3 kez tekrarlanıyordu.

export async function ensureGeminiFileUris(
  pdfPath: string,
  existingUrisJson: string | null,
  courseSlug: string
): Promise<{ uriMap: Record<string, string>; updated: boolean }> {
  const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").split(",").filter(k => k.trim())
  
  let uriMap: Record<string, string> = {}
  if (existingUrisJson) {
    try { uriMap = JSON.parse(existingUrisJson) } catch { /* JSON parse hatası */ }
  }

  let updated = false

  if (!pdfPath || geminiKeys.length === 0) {
    return { uriMap, updated }
  }

  try {
    const { GoogleAIFileManager } = await import("@google/generative-ai/server")

    const tasks = geminiKeys.map(async (key, i) => {
      const trimmedKey = key.trim()
      const fileManager = new GoogleAIFileManager(trimmedKey)
      
      let isStale = false
      if (uriMap[String(i)]) {
        try {
          const fullUri = uriMap[String(i)]
          const filesIndex = fullUri.indexOf("files/")
          if (filesIndex >= 0) {
            const fileId = fullUri.substring(filesIndex)
            await fileManager.getFile(fileId)
            console.log(`[FILE_URI] 📄 Key #${i + 1} için mevcut PDF aktif.`)
          } else {
            isStale = true
          }
        } catch {
          isStale = true
          console.log(`[FILE_URI] ⚠️ Key #${i + 1} için PDF süresi dolmuş/geçersiz, yeniden yüklenecek...`)
        }
      }

      if (!uriMap[String(i)] || isStale) {
        console.log(`[FILE_URI] 📄 Key #${i + 1} için PDF eksik/stale, Gemini'ye yükleniyor...`)
        try {
          const uploadResult = await fileManager.uploadFile(pdfPath, {
            mimeType: "application/pdf",
            displayName: `${courseSlug}-${Date.now()}-key${i + 1}`,
          })
          uriMap[String(i)] = uploadResult.file.uri
          updated = true
          console.log(`[FILE_URI] ✅ Key #${i + 1} için PDF başarıyla yüklendi: ${uploadResult.file.uri}`)
        } catch (err: any) {
          console.error(`[FILE_URI] ❌ Key #${i + 1} için PDF yükleme başarısız: ${err.message}`)
        }
      }
    })

    await Promise.all(tasks)
  } catch (importErr: any) {
    console.error("[FILE_URI] ❌ GoogleAIFileManager yüklenemedi:", importErr.message)
  }

  return { uriMap, updated }
}
