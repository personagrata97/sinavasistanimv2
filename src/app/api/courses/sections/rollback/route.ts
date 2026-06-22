import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function POST(req: NextRequest) {
  try {
    // 🔒 AUTH: Sadece admin rollback yapabilir
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 403 });
    }

    const { sectionId, targetPhase } = await req.json();

    if (!sectionId || !targetPhase) {
      return NextResponse.json({ error: "Eksik parametreler" }, { status: 400 });
    }

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });

    if (!section) {
      return NextResponse.json({ error: "Bölüm bulunamadı" }, { status: 404 });
    }

    // Ortak sıfırlamalar — verificationScore da sıfırlanmalı ki Resume mekanizması
    // eski 100 puanı görüp Kontrolörü atlamasın
    const updateData: any = {
      processed: false,
      verificationScore: null,
    };

    let issuesObj: any = {};
    if (section.verificationIssues) {
      try {
        issuesObj = JSON.parse(section.verificationIssues);
      } catch (e) {}
    }
    if (!issuesObj.stages) issuesObj.stages = {};

    if (targetPhase === "flashcards") {
      // Soru/Kartları sil, processed'i false yap
      issuesObj.stages.flashcards = false;
      issuesObj.stages.questions = false;
      issuesObj.stages.published = false;

      await prisma.flashcard.deleteMany({ where: { sectionId } });
      await prisma.question.deleteMany({ where: { sectionId } });

      updateData.verificationIssues = JSON.stringify(issuesObj);
    } else if (targetPhase === "mufettis") {
      // Müfettiş aşamasına dön: Flashcard/soruları sil, Müfettiş bayraklarını temizle
      // verificationScore null olduğu için notlar da baştan denetlenecek
      issuesObj.stages.flashcards = false;
      issuesObj.stages.questions = false;
      issuesObj.stages.published = false;
      issuesObj.stages.mufettis = false;
      issuesObj.stages.cerrahiYama = false;
      issuesObj.stages.kontrolorGroundTruth = false;

      await prisma.flashcard.deleteMany({ where: { sectionId } });
      await prisma.question.deleteMany({ where: { sectionId } });

      // attemptHistory'yi de temizle ki yeni denemeler temiz başlasın
      issuesObj.attemptHistory = [];

      updateData.verificationIssues = JSON.stringify(issuesObj);
    } else {
      return NextResponse.json({ error: "Geçersiz targetPhase" }, { status: 400 });
    }

    const updatedSection = await prisma.section.update({
      where: { id: sectionId },
      data: updateData,
    });

    console.log(`[ROLLBACK API] ✅ Bölüm '${section.title}' → '${targetPhase}' aşamasına geri çekildi (admin: ${session.user?.email})`);

    return NextResponse.json({ success: true, section: updatedSection });
  } catch (error: any) {
    console.error("[ROLLBACK API] Hata:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
