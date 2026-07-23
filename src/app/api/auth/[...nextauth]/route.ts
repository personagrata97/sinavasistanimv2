import NextAuth, { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "E-posta",
      credentials: {
        email: { label: "E-posta", type: "email", placeholder: "ornek@email.com" },
        password: { label: "Şifre", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Lütfen tüm alanları doldurun.")
        }

        // Server-side validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(credentials.email)) {
          throw new Error("Geçerli bir e-posta adresi girin.")
        }
        if (credentials.password.length < 6) {
          throw new Error("Şifre en az 6 karakter olmalıdır.")
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        // Eğer kullanıcı yoksa, yeni kullanıcı oluştur (Otomatik Kayıt)
        if (!user) {
          const hashedPassword = await bcrypt.hash(credentials.password, 12)
          const newUser = await prisma.user.create({
            data: {
              email: credentials.email,
              password: hashedPassword,
              name: credentials.email.split("@")[0],
              role: "student"
            }
          })
          return { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role }
        }

        // Kullanıcı varsa şifreyi kontrol et
        const isValid = await bcrypt.compare(credentials.password, user.password || "")
        if (!isValid) {
          throw new Error("Hatalı şifre.")
        }

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 Days
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.onboardingCompleted = (user as any).onboardingCompleted
      }
      // On session update or every token refresh, re-read from DB
      if (trigger === "update" || !token.onboardingCompleted) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email! },
            select: { onboardingCompleted: true, role: true }
          })
          if (dbUser) {
            token.onboardingCompleted = dbUser.onboardingCompleted
            token.role = dbUser.role
          }
        } catch {}
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).onboardingCompleted = token.onboardingCompleted;
      }
      return session
    }
  },
  secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
