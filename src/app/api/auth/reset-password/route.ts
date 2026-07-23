import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { logger } from "@/lib/logger"

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json()

    if (!token || !password) {
      return NextResponse.json({ error: "Eksik bilgi" }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Şifre en az 6 karakter olmalıdır" }, { status: 400 })
    }

    // Gelen token'ı hash'le, çünkü veritabanında hashlenmiş hali duruyor
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex")

    // Token eşleşiyor mu ve süresi geçmemiş mi kontrol et
    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetTokenExpiry: {
          gt: new Date(), // Şu andan daha ileri bir tarih olmalı (Süresi dolmamış)
        },
      },
    })

    if (!user) {
      logger.warn("Geçersiz veya süresi dolmuş şifre sıfırlama tokeni kullanıldı.")
      return NextResponse.json({ error: "Geçersiz veya süresi dolmuş bağlantı." }, { status: 400 })
    }

    // Yeni şifreyi hash'le
    const hashedPassword = await bcrypt.hash(password, 12)

    // Kullanıcının şifresini güncelle ve tokenları temizle
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    })

    logger.info(`Kullanıcı şifresini sıfırladı: ${user.email}`)

    return NextResponse.json({ success: true, message: "Şifreniz başarıyla güncellendi." })
  } catch (error: any) {
    logger.error("Şifre sıfırlama işlemi sırasında hata", error)
    return NextResponse.json({ error: "İşlem sırasında bir hata oluştu" }, { status: 500 })
  }
}
