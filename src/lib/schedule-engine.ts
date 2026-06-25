// Çalışma Programı Oluşturma Motoru
// Sınav tarihine ve seviyeye göre dinamik program

import { addDays, differenceInDays, format, startOfDay } from "date-fns"

export interface ScheduleItem {
  date: Date
  task: string
  type: "reading" | "questions" | "flashcards" | "review" | "mock_exam"
  duration: number // dakika
  sectionIds: string[]
}

interface ScheduleConfig {
  examDate: Date
  userLevel: "beginner" | "intermediate" | "advanced"
  totalSections: number
  sectionTitles: string[]
  sectionIds: string[]
  weakSectionIds?: string[] // E-25: Zayıf bölümler adaptif planlama için
  targetHours?: number // Kullanıcının günlük hedef süresi (Örn: 0.5, 2 vb.)
}

// Seviyeye göre süre dağılımı (yüzde)
const LEVEL_DISTRIBUTION = {
  beginner: { reading: 0.60, questions: 0.20, flashcards: 0.10, review: 0.05, mock_exam: 0.05 },
  intermediate: { reading: 0.40, questions: 0.30, flashcards: 0.10, review: 0.10, mock_exam: 0.10 },
  advanced: { reading: 0.25, questions: 0.30, flashcards: 0.10, review: 0.15, mock_exam: 0.20 },
}

export function generateStudySchedule(config: ScheduleConfig): ScheduleItem[] {
  const today = startOfDay(new Date())
  const examDay = startOfDay(config.examDate)
  const totalDays = differenceInDays(examDay, today)

  if (totalDays <= 0) {
    return [{
      date: today,
      task: "Sınav tarihi geçmiş veya bugün. Lütfen tarihi güncelleyin.",
      type: "review",
      duration: 0,
      sectionIds: [],
    }]
  }

  let dist = { ...LEVEL_DISTRIBUTION[config.userLevel] }

  // Sınava kalan süreye göre ağırlıkları dinamik olarak kaydır/ayarla
  if (totalDays <= 7) {
    // Sınava son 7 gün kala: Okuma fazını çok düşük tut, pratik ve denemelere odaklan
    dist = {
      reading: Math.max(0.05, dist.reading * 0.2), // Okumayı minimal yap
      questions: dist.questions * 1.2,
      flashcards: dist.flashcards * 0.8,
      review: dist.review + (dist.reading * 0.4),
      mock_exam: dist.mock_exam + (dist.reading * 0.4),
    }
  } else if (totalDays <= 14) {
    // Sınava son 14 gün kala: Okuma fazını azalt, deneme ve pratik ağırlığını artır
    dist = {
      reading: Math.max(0.15, dist.reading * 0.5),
      questions: dist.questions * 1.1,
      flashcards: dist.flashcards,
      review: dist.review + (dist.reading * 0.25),
      mock_exam: dist.mock_exam + (dist.reading * 0.25),
    }
  }

  // Dağılımın toplamını 1.0 yapmak için normalize edelim
  const sum = dist.reading + dist.questions + dist.flashcards + dist.review + dist.mock_exam
  if (sum > 0) {
    dist.reading /= sum
    dist.questions /= sum
    dist.flashcards /= sum
    dist.review /= sum
    dist.mock_exam /= sum
  }

  const schedule: ScheduleItem[] = []

  // Günlük maksimum süre (dk)
  const dailyTargetMinutes = (config.targetHours || 2) * 60

  // Faz süreleri (gün sayısı olarak)
  const readingDays = Math.max(1, Math.floor(totalDays * dist.reading))
  const questionDays = Math.max(1, Math.floor(totalDays * dist.questions))
  const flashcardDays = Math.max(1, Math.floor(totalDays * dist.flashcards))
  const reviewDays = Math.max(1, Math.floor(totalDays * dist.review))
  const mockDays = Math.max(1, totalDays - readingDays - questionDays - flashcardDays - reviewDays)

  let currentDay = 0

  // === FAZ 1: OKUMA ===
  const sectionsPerDay = Math.max(1, Math.ceil(config.totalSections / readingDays))
  for (let d = 0; d < readingDays && currentDay < totalDays; d++) {
    const startIdx = d * sectionsPerDay
    const endIdx = Math.min(startIdx + sectionsPerDay, config.totalSections)
    const todaySections = config.sectionTitles.slice(startIdx, endIdx)
    const todaySectionIds = config.sectionIds.slice(startIdx, endIdx)

    if (todaySections.length === 0) break

    const hasWeakSection = config.weakSectionIds?.some(wid => todaySectionIds.includes(wid))
    
    // Süre, kullanıcının seçtiği günlük süreyi geçmemeli ama en az 15dk olmalı
    let duration = hasWeakSection ? dailyTargetMinutes : Math.floor(dailyTargetMinutes * 0.8)
    duration = Math.max(15, Math.min(duration, dailyTargetMinutes))

    schedule.push({
      date: addDays(today, currentDay),
      task: `Okuma: ${todaySections.length} Bölüm (${todaySections[0].substring(0, 20)}...)${hasWeakSection ? " ⚠️ Zayıf Konu" : ""}`,
      type: "reading",
      duration,
      sectionIds: todaySectionIds,
    })
    currentDay++
  }

  // === FAZ 2: SORU ÇÖZME ===
  const orderedSectionIds = [...(config.weakSectionIds || []), ...config.sectionIds.filter(id => !config.weakSectionIds?.includes(id))]
  const orderedTitles = orderedSectionIds.map(id => {
    const idx = config.sectionIds.indexOf(id)
    return idx >= 0 ? config.sectionTitles[idx] : "Karma Sorular"
  })

  for (let d = 0; d < questionDays && currentDay < totalDays; d++) {
    const sectionIdx = d % orderedSectionIds.length
    const isWeak = config.weakSectionIds?.includes(orderedSectionIds[sectionIdx])
    
    let duration = isWeak ? dailyTargetMinutes : Math.floor(dailyTargetMinutes * 0.7)
    duration = Math.max(15, Math.min(duration, dailyTargetMinutes))

    schedule.push({
      date: addDays(today, currentDay),
      task: `Soru Çözme: ${orderedTitles[sectionIdx] || "Karma Sorular"} (Soru Egzersizi)${isWeak ? " 🎯 Telafi" : ""}`,
      type: "questions",
      duration,
      sectionIds: orderedSectionIds[sectionIdx] ? [orderedSectionIds[sectionIdx]] : [],
    })
    currentDay++
  }

  // === FAZ 3: FLASHCARD ===
  for (let d = 0; d < flashcardDays && currentDay < totalDays; d++) {
    let duration = Math.floor(dailyTargetMinutes * 0.5)
    duration = Math.max(10, Math.min(duration, dailyTargetMinutes))

    schedule.push({
      date: addDays(today, currentDay),
      task: `Flashcard Tekrarı: Tüm konular`,
      type: "flashcards",
      duration,
      sectionIds: [],
    })
    currentDay++
  }

  // === FAZ 4: TEKRAR ===
  for (let d = 0; d < reviewDays && currentDay < totalDays; d++) {
    let duration = dailyTargetMinutes
    duration = Math.max(20, Math.min(duration, dailyTargetMinutes))

    schedule.push({
      date: addDays(today, currentDay),
      task: `Genel Tekrar: Zayıf konulara odaklanma`,
      type: "review",
      duration,
      sectionIds: config.weakSectionIds || [],
    })
    currentDay++
  }

  // === FAZ 5: DENEME SINAVI ===
  for (let d = 0; d < mockDays && currentDay < totalDays; d++) {
    let duration = dailyTargetMinutes > 60 ? 90 : dailyTargetMinutes // Deneme sınavı en azından gerçekçi olmalı, ama limite yakın olmalı

    schedule.push({
      date: addDays(today, currentDay),
      task: `Deneme Sınavı #${d + 1}`,
      type: "mock_exam",
      duration,
      sectionIds: [],
    })
    currentDay++
  }

  return schedule
}

export function getDaysUntilExam(examDate: Date | null): number {
  if (!examDate) return -1
  return differenceInDays(startOfDay(examDate), startOfDay(new Date()))
}

export function getUrgencyLevel(daysLeft: number): { label: string; color: string; icon: string } {
  if (daysLeft < 0) return { label: "Sınav Geçti", color: "text-slate-500", icon: "Clock" }
  if (daysLeft <= 7) return { label: "Kritik!", color: "text-red-500", icon: "AlertTriangle" }
  if (daysLeft <= 14) return { label: "Acil", color: "text-orange-500", icon: "Zap" }
  if (daysLeft <= 30) return { label: "Hızlan", color: "text-amber-500", icon: "Timer" }
  if (daysLeft <= 60) return { label: "İyi Tempo", color: "text-emerald-500", icon: "CheckCircle" }
  return { label: "Rahat", color: "text-blue-500", icon: "Coffee" }
}
