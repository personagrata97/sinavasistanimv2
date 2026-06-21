"use client"

import { useState } from "react"
import { BookOpen, HelpCircle, Layers, Settings2, Play, X } from "lucide-react"

interface GenerationOptionsModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (options: {
    generateNotes: boolean
    generateQuestions: boolean
    generateFlashcards: boolean
  }) => void
  courseName: string
}

export function GenerationOptionsModal({
  isOpen,
  onClose,
  onConfirm,
  courseName
}: GenerationOptionsModalProps) {
  const [options, setOptions] = useState({
    generateNotes: true,
    generateQuestions: true,
    generateFlashcards: true,
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <Settings2 className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">İsteğe Bağlı Üretim</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-1">
            <p className="text-sm text-slate-400 font-medium">Hedef Lisans / Modül</p>
            <p className="text-slate-200">{courseName}</p>
          </div>

          <p className="text-sm text-slate-400 leading-relaxed">
            Zeliha Mevzuat programı için üretilecek içerikleri seçin. İhtiyacınız olmayan materyalleri kapatarak API limitlerinden ve işlem süresinden tasarruf edebilirsiniz.
          </p>

          <div className="space-y-3">
            <OptionToggle
              icon={<BookOpen className="w-4 h-4" />}
              label="Ders Notu Üretimi"
              description="Uzun ders notları oluşturur. (Kapatılırsa PDF metni kullanılır)"
              checked={options.generateNotes}
              onChange={(v) => setOptions(prev => ({ ...prev, generateNotes: v }))}
            />
            <OptionToggle
              icon={<Layers className="w-4 h-4" />}
              label="Bilgi Kartı (Flashcard) Üretimi"
              description="Konu tekrarları için flaşkartlar üretir."
              checked={options.generateFlashcards}
              onChange={(v) => setOptions(prev => ({ ...prev, generateFlashcards: v }))}
            />
            <OptionToggle
              icon={<HelpCircle className="w-4 h-4" />}
              label="Soru Havuzu Üretimi"
              description="Bölüm sonu testleri için çoktan seçmeli sorular üretir."
              checked={options.generateQuestions}
              onChange={(v) => setOptions(prev => ({ ...prev, generateQuestions: v }))}
            />
          </div>
        </div>

        <div className="p-5 border-t border-slate-800 bg-slate-900/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            İptal
          </button>
          <button
            onClick={() => onConfirm(options)}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors"
          >
            <Play className="w-4 h-4" />
            İşleme Başla
          </button>
        </div>
      </div>
    </div>
  )
}

function OptionToggle({
  icon,
  label,
  description,
  checked,
  onChange
}: {
  icon: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-4 p-4 rounded-xl border border-slate-700/50 bg-slate-800/30 cursor-pointer hover:bg-slate-800/50 transition-colors">
      <div className="flex items-center h-5">
        <input
          type="checkbox"
          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 text-slate-200 font-medium">
          <span className="text-slate-400">{icon}</span>
          {label}
        </div>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
    </label>
  )
}
