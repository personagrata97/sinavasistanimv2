"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, X, Send, Loader2, Bot, Lightbulb, Target, ClipboardList } from "lucide-react"
import ReactMarkdown from "react-markdown"

import { getStudyBuddyIntro } from "@/lib/program-catalog"

export default function StudyBuddy({ courseId, isProfessional }: { courseId: string, isProfessional?: boolean }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<{role: "user"|"model", content: string}[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput("")
    setMessages(prev => [...prev, { role: "user", content: userMsg }])
    setLoading(true)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 45000)

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          messages: [...messages, { role: "user", content: userMsg }]
        }),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        setMessages(prev => [...prev, { role: "model", content: `⚠️ **Üzgünüm bir hata oluştu:** ${errorData.error || "Bilinmeyen hata"}` }])
        setLoading(false)
        return
      }

      const contentType = res.headers.get("content-type") || ""

      // Groq fallback → JSON yanıt
      if (contentType.includes("application/json")) {
        const data = await res.json()
        if (data.reply) {
          setMessages(prev => [...prev, { role: "model", content: data.reply }])
        } else if (data.error) {
          setMessages(prev => [...prev, { role: "model", content: `⚠️ ${data.error}` }])
        }
        setLoading(false)
        return
      }

      // Gemini → Streaming yanıt (daktilo efekti)
      setMessages(prev => [...prev, { role: "model", content: "" }])
      setLoading(false)

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      
      if (reader) {
        let done = false
        while (!done) {
          const { value, done: readerDone } = await reader.read()
          done = readerDone
          if (value) {
            const chunk = decoder.decode(value, { stream: true })
            setMessages(prev => {
              const newMsgs = [...prev]
              newMsgs[newMsgs.length - 1].content += chunk
              return newMsgs
            })
          }
        }
      }
    } catch (e: any) {
      console.error(e)
      setLoading(false)
      if (e.name === "AbortError") {
        setMessages(prev => [...prev, { role: "model", content: "⚠️ **Yapay zeka yanıt vermesi çok uzun sürdü.** Lütfen tekrar dene." }])
      } else {
        setMessages(prev => [...prev, { role: "model", content: "⚠️ **Bağlantı kesildi.**" }])
      }
    }
  }

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 p-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl hover:scale-110 transition-all z-40"
      >
        <MessageSquare className="w-6 h-6" />
      </button>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 w-80 md:w-96 h-[500px] bg-[#0f172a] border border-slate-700 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-[#1e293b]">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-white">Çalışma Arkadaşım</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-slate-400 mt-6 px-4">
                  <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center mx-auto mb-4 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                    <Bot className="w-8 h-8 text-indigo-400" />
                  </div>
                  <p className="font-bold text-white mb-2 text-lg">Nasıl Yardımcı Olabilirim?</p>
                  <p className="text-xs mb-6 text-slate-400">{getStudyBuddyIntro(!!isProfessional)}</p>
                  <div className="text-left space-y-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                    <div className="flex gap-3 text-xs items-start">
                      <Lightbulb className="w-4 h-4 text-amber-400 mt-0.5" />
                      <span className="mt-0.5 text-slate-300">Anlamadığın karmaşık bir konuyu basitçe özetlememi isteyebilirsin.</span>
                    </div>
                    <div className="flex gap-3 text-xs items-start">
                      <Target className="w-4 h-4 text-sky-400 mt-0.5" />
                      <span className="mt-0.5 text-slate-300">"Bana bu üniteden zor bir soru sor" diyerek pratik yapabilirsin.</span>
                    </div>
                    <div className="flex gap-3 text-xs items-start">
                      <ClipboardList className="w-4 h-4 text-emerald-400 mt-0.5" />
                      <span className="mt-0.5 text-slate-300">Birbirine karışan iki kavram arasındaki farkı sorabilirsin.</span>
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${m.role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-slate-700 text-white rounded-bl-sm"}`}>
                    {m.role === "model" ? (
                      <div className="prose prose-invert prose-sm max-w-none [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_ol]:mb-1.5 [&_strong]:text-amber-300">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    ) : m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-700 p-3 rounded-2xl rounded-bl-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-slate-700 bg-[#1e293b] flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Bir soru sor..."
                className="flex-1 bg-slate-800 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
