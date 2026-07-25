import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!dbUser || dbUser.role !== "admin") {
      return NextResponse.json({ error: "Bu işlem için sistem yöneticisi (admin) yetkisi gereklidir." }, { status: 403 });
    }

    const body = await req.json();
    const { sectionId, action } = body;

    if (!sectionId || !action) {
      return NextResponse.json({ error: "Eksik parametreler" }, { status: 400 });
    }

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { course: true }
    });

    if (!section) {
      return NextResponse.json({ error: "Bölüm bulunamadı" }, { status: 404 });
    }

    if (action === "accept") {
      // Kabul et: needsUserAction bayrağını kaldır, processed = true yap
      let issues: any = {};
      try { issues = JSON.parse(section.verificationIssues || "{}"); } catch (e) {}
      
      issues.needsUserAction = false;
      
      await prisma.section.update({
        where: { id: sectionId },
        data: {
          processed: true, // Artık bu bölüm bitti kabul edilecek
          verificationIssues: JSON.stringify(issues)
        }
      });
      
    } else if (action === "restart") {
      // Baştan Başlat: Tüm veriyi sıfırla, processed = false yap
      await prisma.section.update({
        where: { id: sectionId },
        data: {
          notes: null,
          processed: false,
          verificationScore: null,
          verificationIssues: null
        }
      });

      // Eski soru ve flashcard'ları temizle
      await prisma.question.deleteMany({ where: { sectionId } });
      await prisma.flashcard.deleteMany({ where: { sectionId } });

    } else {
      return NextResponse.json({ error: "Geçersiz aksiyon" }, { status: 400 });
    }

    // Her iki durumda da course status error/paused ise processing yap
    if (section.course.status === "error" || section.course.status === "paused" || section.course.status === "ready") {
      await prisma.course.update({
        where: { id: section.courseId },
        data: { status: "processing" }
      });
    }

    // Arka plan sürecini tetikle (Güvenli URL)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3001";

    fetch(`${baseUrl}/api/courses/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: section.course.slug, userInitiated: true, source: "admin_resolve" })
    }).catch(e => console.error("Auto trigger failed", e));

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[RESOLVE_ACTION_ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
