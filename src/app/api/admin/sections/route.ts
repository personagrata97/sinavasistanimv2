import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { isAdminSession } from "@/lib/quota-guard"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!isAdminSession(session?.user)) {
      return NextResponse.json({ error: "Yetkisiz erişim — sadece yöneticiler müdahale edebilir." }, { status: 403 })
    }

    const body = await req.json()
    const { sectionId, action, rawContent, isStudyUnit } = body

    if (!sectionId) {
      return NextResponse.json({ error: "sectionId zorunludur." }, { status: 400 })
    }

    const section = await prisma.section.findUnique({ where: { id: sectionId } })
    if (!section) {
      return NextResponse.json({ error: "Bölüm bulunamadı." }, { status: 404 })
    }

    if (action === "re-ocr") {
      // 1. Kaynağı yeniden OCR'la: rawContent'i boşalt ki bir sonraki denemede OCR yeniden tetiklensin
      await prisma.section.update({
        where: { id: sectionId },
        data: {
          rawContent: "",
          notes: null,
          processed: false,
          verificationScore: 0,
          verificationIssues: JSON.stringify({ message: "Bölüm yönetici tarafından yeniden OCR için sıfırlandı." }),
        },
      })
      return NextResponse.json({ success: true, message: "Bölüm yeniden OCR yapılmak üzere sıfırlandı." })
    }

    if (action === "update-raw") {
      // 2. Kaynak metni elle düzelt
      if (typeof rawContent !== "string") {
        return NextResponse.json({ error: "rawContent metin olmalıdır." }, { status: 400 })
      }

      await prisma.section.update({
        where: { id: sectionId },
        data: {
          rawContent: rawContent,
        },
      })
      return NextResponse.json({ success: true, message: "Kaynak metin başarıyla güncellendi." })
    }

    if (action === "toggle-exclude") {
      // 3. Bölümü kapsam dışı bırak / aktif et
      const newStudyUnit = typeof isStudyUnit === "boolean" ? isStudyUnit : !section.isStudyUnit
      await prisma.section.update({
        where: { id: sectionId },
        data: {
          isStudyUnit: newStudyUnit,
          processed: !newStudyUnit ? true : section.processed, // Kapsam dışı bırakılan bölüm onaylı sayılır ki dersi engellemesin
        },
      })
      return NextResponse.json({
        success: true,
        message: newStudyUnit ? "Bölüm müfredata yeniden dahil edildi." : "Bölüm kapsam dışı bırakıldı (müfredattan çıkarıldı).",
        isStudyUnit: newStudyUnit,
      })
    }

    return NextResponse.json({ error: "Geçersiz işlem türü." }, { status: 400 })
  } catch (error: any) {
    console.error("[ADMIN_SECTION_ACTION_ERROR]", error)
    return NextResponse.json({ error: error.message || "İşlem sırasında hata oluştu." }, { status: 500 })
  }
}
