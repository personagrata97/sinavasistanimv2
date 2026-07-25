import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { recordHeartbeat } from "@/lib/process-registry"

/** İşlem sayfası açıkken canlılık sinyali — arka plan işçisi kopukluğu tespit eder. */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const body = await req.json()
    if (!session?.user?.email && body.secretToken !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    const { slug, visible = true } = body
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 })
    }

    recordHeartbeat(slug, Boolean(visible))
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
