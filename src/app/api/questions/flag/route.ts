import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auditAndRepairQuestion } from "@/lib/ai-service"

export async function POST(req: Request) {
  try {
    const { questionId, reportReason, reportComment } = await req.json()

    if (!questionId || !reportReason) {
      return NextResponse.json({ error: "Eksik parametre" }, { status: 400 })
    }

    // 1. Soruyu ve bağlı olduğu içeriği getir
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { section: true }
    })

    if (!question || !question.section) {
      return NextResponse.json({ error: "Soru veya bölüm bulunamadı" }, { status: 404 })
    }

    // 2. Önce DB'yi güncelle (kullanıcıya hızlı cevap vermek için "pending" yapabiliriz ama otonom yapıyoruz)
    await prisma.question.update({
      where: { id: questionId },
      data: {
        reported: true,
        reportReason,
        reportComment,
        aiAuditStatus: "pending"
      }
    })

    // 3. AI Başmüfettişe Gönder
    const auditResult = await auditAndRepairQuestion(
      question.text,
      question.options,
      question.correct,
      question.explanation || "",
      reportReason,
      reportComment || "",
      question.section.rawContent
    )

    // 4. Sonuca Göre Aksiyon Al
    if (auditResult.status === "auto_fixed" && auditResult.newQuestion) {
      // Soruyu düzeltilmiş haliyle güncelle
      await prisma.question.update({
        where: { id: questionId },
        data: {
          text: auditResult.newQuestion.text,
          options: JSON.stringify(auditResult.newQuestion.options),
          correct: auditResult.newQuestion.correct,
          explanation: auditResult.newQuestion.explanation,
          difficulty: auditResult.newQuestion.difficulty || "medium",
          aiAuditStatus: "auto_fixed",
          reportComment: `[DÜZELTİLDİ]: ${auditResult.aiComment}` // Admin görebilsin diye
        }
      })
    } else {
      // İtiraz reddedildi, soruyu eski halinde bırak ve havuza geri döndür
      await prisma.question.update({
        where: { id: questionId },
        data: {
          reported: false, // GERİ AL — soru havuza dönsün
          aiAuditStatus: "rejected",
          reportComment: `[REDDEDİLDİ]: ${auditResult.aiComment}`
        }
      })
    }

    return NextResponse.json({
      success: true,
      status: auditResult.status,
      message: auditResult.aiComment
    })

  } catch (error) {
    console.error("[FLAG_API] Error:", error)
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 })
  }
}
