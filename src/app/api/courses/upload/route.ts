import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getPdfPageCount } from "@/lib/pdf-engine"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { getStudyNotFoundMessage } from "@/lib/program-catalog"
import { createHash } from "crypto"
import { runStageWithContract, emptyQualityChain } from "@/lib/quality-contract"

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const userRole = (session.user as { role?: string }).role
    if (userRole !== "admin") {
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { role: true },
      })
      if (dbUser?.role !== "admin") {
        return NextResponse.json({ error: "PDF yükleme için admin yetkisi gereklidir." }, { status: 403 })
      }
    }

    const formData = await req.formData()
    const file = formData.get("file") as File
    const slug = formData.get("slug") as string

    if (!file || !slug) {
      return NextResponse.json({ error: "Dosya ve ders slug'ı gerekli." }, { status: 400 })
    }

    // E-14: Slug format validasyonu (path traversal koruması)
    if (!/^[a-z0-9-]+$/.test(slug) || slug.length > 100) {
      return NextResponse.json({ error: "Geçersiz ders tanımlayıcısı." }, { status: 400 })
    }

    // Güvenlik: Dosya tipi kontrolü
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Sadece PDF dosyaları kabul edilir." }, { status: 400 })
    }

    // Güvenlik: Dosya boyutu kontrolü (maks 50MB - Sadece Admin)
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Dosya boyutu çok büyük. Maksimum ${MAX_FILE_SIZE / 1024 / 1024}MB desteklenmektedir.` }, { status: 400 })
    }

    // Dersi bul
    const course = await prisma.course.findUnique({
      where: { slug },
      include: { program: { select: { slug: true } } },
    })
    if (!course) {
      return NextResponse.json(
        { error: `${getStudyNotFoundMessage(slug.startsWith("zeliha-") ? "zeliha-mevzuat" : "")}.` },
        { status: 404 },
      )
    }

    // PDF'i kaydet
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const pdfHash = createHash("sha256").update(buffer).digest("hex")

    // Magic Bytes Kontrolü
    if (buffer.length < 4 || buffer.toString("utf8", 0, 4) !== "%PDF") {
      return NextResponse.json({ error: "Geçersiz PDF formatı (Magic Bytes eşleşmiyor)." }, { status: 400 })
    }

    const uploadsDir = path.join(process.cwd(), "uploads")
    await mkdir(uploadsDir, { recursive: true })

    // Eski PDF dosyasını temizle (duplicate birikimini engelle)
    if (course.pdfPath) {
      try {
        const { unlink } = await import("fs/promises")
        await unlink(course.pdfPath)
        console.log(`[UPLOAD] Eski PDF silindi: ${course.pdfPath}`)
      } catch {
        // Dosya zaten silinmiş olabilir, hata yok sayılır
      }
    }

    const fileName = `${slug}-${Date.now()}.pdf`
    const filePath = path.join(uploadsDir, fileName)
    await writeFile(filePath, buffer)

    // Sayfa sayısını al
    const totalPages = await getPdfPageCount(buffer)

    // Eski verileri temizle (kullanıcı yeniden PDF yüklediğinde sıfırdan başlasın)
    await prisma.$transaction([
      prisma.section.deleteMany({ where: { courseId: course.id } }),
      prisma.flashcard.deleteMany({ where: { courseId: course.id } }),
      prisma.question.deleteMany({ where: { courseId: course.id } }),
      prisma.studyPlan.deleteMany({ where: { courseId: course.id } })
    ])

    const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").split(",").filter(k => k.trim())

    // Gemini'ye yükle — merkezi helper ile (DRY — daha önce 3 yerde tekrarlanan kod)
    let geminiFileUri = null
    const geminiFileUris: Record<string, string> = {}
    try {
      const { ensureGeminiFileUris } = await import("@/lib/gemini-file-helper")
      const { uriMap } = await ensureGeminiFileUris(filePath, null, slug)
      Object.assign(geminiFileUris, uriMap)
      geminiFileUri = uriMap["0"] || null
      console.log(`[UPLOAD] 📊 ${Object.keys(uriMap).length} key'e başarıyla yüklendi`)

      if (geminiKeys.length > 0 && Object.keys(uriMap).length === 0) {
        throw new Error(`Hiçbir API anahtarına dosya yüklenemedi. (0/${geminiKeys.length})`)
      }
    } catch (gErr: any) {
      console.error("[UPLOAD] ❌ Gemini File API yükleme/parite hatası:", gErr.message)
      throw new Error(`Gemini File API yükleme hatası: ${gErr.message}`)
    }

    // Dersi güncelle
    await prisma.course.update({
      where: { slug },
      data: {
        pdfPath: filePath,
        pdfHash,
        geminiFileUri,
        geminiFileUris: Object.keys(geminiFileUris).length > 0 ? JSON.stringify(geminiFileUris) : null,
        totalPages,
        processedPages: 0,
        status: "uploaded",
      }
    })

    return NextResponse.json({
      success: true,
      totalPages,
      filePath,
    })
  } catch (error: any) {
    console.error("[UPLOAD_ERROR]", error)
    return NextResponse.json({ error: error.message || "Dosya yüklenirken bir hata oluştu." }, { status: 500 })
  }
}
