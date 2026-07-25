import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    })

    if (!user) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 })
    }

    // KVKK m.11 Kapsamında Kişisel Veri ve Hesap Silme
    await prisma.user.delete({
      where: { id: user.id }
    })

    return NextResponse.json({
      success: true,
      message: "Kullanıcı hesabınız ve tüm verileriniz KVKK hükümleri gereğince başarıyla silinmiştir."
    })
  } catch (error) {
    console.error("[DELETE_ACCOUNT_API] Error:", error)
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 })
  }
}
