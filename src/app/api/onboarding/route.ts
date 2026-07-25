import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { goal, targetHours } = body

    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        onboardingCompleted: true,
        // goal ve targetHours'ı kaydet (User modelinde bu alanlar varsa)
        ...(goal ? { goal } : {}),
        ...(targetHours ? { targetHours: Number(targetHours) } : {}),
      }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[ONBOARDING_ERROR]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
