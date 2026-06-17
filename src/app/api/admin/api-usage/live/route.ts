import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { getLiveApiKeyStats } from "@/lib/ai-service"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 })
  }

  return NextResponse.json(getLiveApiKeyStats())
}
