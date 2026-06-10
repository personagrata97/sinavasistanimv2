import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit"
import { chatRequestSchema } from "@/lib/validations"
import { logger } from "@/lib/logger"

const MAX_MESSAGE_LENGTH = 10000
const MAX_MESSAGES = 50

export async function POST(req: NextRequest) {
  try {
    // Auth kontrolü
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Yetkilendirme gerekli" }, { status: 401 })
    }

    // Rate limiting (IP + user bazlı)
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown"
    const rateLimitKey = `chat:${session.user.email}:${ip}`
    const limit = rateLimit(rateLimitKey, 20, 60_000)
    if (!limit.success) {
      logger.warn("Rate limit aşıldı", "chat", { email: session.user.email, ip })
      return NextResponse.json(
        { error: "Çok fazla istek gönderdiniz. Lütfen 1 dakika bekleyin." },
        { status: 429, headers: getRateLimitHeaders(limit.remaining, limit.resetIn, 20) }
      )
    }

    const body = await req.json()

    // Zod validation
    const validation = chatRequestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues.map(i => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { courseId, messages } = validation.data
    logger.info("Chat isteği", "chat", { courseId, messageCount: messages.length, user: session.user.email })
    
    // Check for API keys
    const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!geminiKey) {
      return NextResponse.json({ error: "Gemini API anahtarı yapılandırılmamış." }, { status: 500 })
    }

    // E-23: Akıllı bağlam seçimi — kullanıcının sorusuyla en alakalı bölümleri bul
    const allSections = await prisma.section.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: { title: true, summary: true, notes: true }
    })

    if (allSections.length === 0) {
      return NextResponse.json({ 
        reply: "Bu dersin içerikleri henüz hazır değil. Önce PDF yükleyip işlenmesini beklemeniz gerekiyor. İçerikler hazır olduğunda benimle sohbet edebilirsiniz!" 
      })
    }

    // Kullanıcının son mesajındaki anahtar kelimeleri çıkar
    const userMsg = messages[messages.length - 1].content.toLowerCase()
    const userWords = userMsg.split(/\s+/).filter(w => w.length > 2)

    // Her bölümü kullanıcı sorusuyla eşleştir (basit keyword matching — RAG benzeri)
    const scoredSections = allSections.map(s => {
      const searchText = `${s.title} ${s.summary || ''}`.toLowerCase()
      const matchCount = userWords.filter(w => searchText.includes(w)).length
      return { ...s, matchScore: matchCount }
    })
    .sort((a, b) => b.matchScore - a.matchScore)

    // İlk 3 en alakalı bölüm + ilk 2 bölüm (genel bağlam) — toplam max 5
    const topMatches = scoredSections.filter(s => s.matchScore > 0).slice(0, 3)
    const fallbacks = allSections.slice(0, Math.max(2, 5 - topMatches.length))
    const selectedSections = [...new Map([...topMatches, ...fallbacks].map(s => [s.title, s])).values()].slice(0, 5)

    const contextText = selectedSections.map(s => `BÖLÜM: ${s.title}\nÖZET: ${s.summary || ''}\nNOTLAR: ${(s.notes || '').substring(0, 5000)}`).join("\n\n")
    const truncatedContext = contextText.substring(0, 25000)

    // 2. System prompt
    const systemPrompt = `Sen bu dersin "Çalışma Arkadaşım" adlı yapay zeka asistanısın.
Öğrencinin çalıştığı derse ait notlar aşağıda verilmiştir. Öğrencinin sorularına SADECE bu notlara dayanarak, samimi, cesaretlendirici ve eğitici bir dille cevap ver.
Cevaplarını Markdown formatında yaz. Önemli kavramları **kalın** yap. Gerekirse madde listesi kullan.
Eğer sorunun cevabı notlarda yoksa "Bu konu şu anki ders notlarında yer almıyor, fakat genel olarak..." diyerek kısaca yanıtla.

[DERS İÇERİĞİ]
${truncatedContext}`

    // 3. Gemini Streaming (Self-healing Chain)
    const chatModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash-8b"]
    for (const modelId of chatModels) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey)
        const model = genAI.getGenerativeModel({ 
          model: modelId,
          systemInstruction: systemPrompt 
        })

        const history = messages.slice(0, -1).map((m: any) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }]
        }))

        const chat = model.startChat({ history })
        const userMsg = messages[messages.length - 1].content
        const result = await chat.sendMessageStream(userMsg)

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of result.stream) {
                const chunkText = chunk.text()
                if (chunkText) {
                  controller.enqueue(encoder.encode(chunkText))
                }
              }
            } catch (streamError) {
              console.error("[STREAM_ERROR]", streamError)
              controller.enqueue(encoder.encode("\n\n⚠️ *Bağlantı kesildi, lütfen tekrar sor.*"))
            } finally {
              controller.close()
            }
          }
        })

        console.log(`[CHAT] ✅ Streaming with ${modelId}`)
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
      } catch (geminiError: any) {
        console.warn(`[CHAT] ${modelId} failed:`, geminiError.message?.substring(0, 100))
      }
    }

    // 4. Groq Fallback (non-streaming ama çalışır)
    const groqKey = process.env.GROQ_API_KEY
    if (groqKey) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: systemPrompt },
              ...messages.map((m: any) => ({ role: m.role === "model" ? "assistant" : m.role, content: m.content }))
            ],
            temperature: 0.3,
            max_tokens: 4096,
          })
        })
        const data = await response.json()
        const reply = data.choices?.[0]?.message?.content || ""
        if (reply) {
          console.log("[CHAT] ✅ Groq fallback succeeded")
          return NextResponse.json({ reply })
        }
      } catch (groqError: any) {
        console.warn("[CHAT] Groq fallback failed:", groqError.message?.substring(0, 100))
      }
    }

    return NextResponse.json({ 
      error: "Yapay zeka servisleri şu an meşgul. Lütfen birkaç saniye sonra tekrar deneyin." 
    }, { status: 503 })

  } catch (error: any) {
    console.error("[CHAT_ERROR]", error)
    return NextResponse.json({ 
      error: error.message || "Bilinmeyen bir hata oluştu. Lütfen tekrar deneyin." 
    }, { status: 500 })
  }
}
