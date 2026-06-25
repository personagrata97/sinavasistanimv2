import { describe, it, expect } from 'vitest'
import { getDaysUntilExam, getUrgencyLevel, generateStudySchedule } from '@/lib/schedule-engine'

describe('schedule-engine', () => {
  describe('getDaysUntilExam', () => {
    it('bugün için 0 gün dönmeli', () => {
      const today = new Date()
      expect(getDaysUntilExam(today)).toBe(0)
    })

    it('yarın için 1 gün dönmeli', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(getDaysUntilExam(tomorrow)).toBe(1)
    })

    it('geçmiş tarih için negatif dönmeli', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      expect(getDaysUntilExam(yesterday)).toBeLessThan(0)
    })
  })

  describe('getUrgencyLevel', () => {
    it('0 gün için kritik seviye dönmeli', () => {
      const urgency = getUrgencyLevel(0)
      expect(urgency).toBeDefined()
      expect(urgency.label).toBeTruthy()
      expect(urgency.color).toBeTruthy()
    })

    it('30+ gün için rahat seviye dönmeli', () => {
      const urgency = getUrgencyLevel(60)
      expect(urgency).toBeDefined()
    })

    it('7 gün için orta-yüksek aciliyet dönmeli', () => {
      const urgency = getUrgencyLevel(7)
      expect(urgency).toBeDefined()
    })
  })

  describe('generateStudySchedule', () => {
    it('sınava az süre kaldığında (örneğin 5 gün) okuma gün sayısı oranını azaltmalı', () => {
      const farExamDate = new Date()
      farExamDate.setDate(farExamDate.getDate() + 30) // 30 gün sonra

      const nearExamDate = new Date()
      nearExamDate.setDate(nearExamDate.getDate() + 5) // 5 gün sonra

      const configFar = {
        examDate: farExamDate,
        userLevel: 'beginner' as const,
        totalSections: 10,
        sectionTitles: Array(10).fill('Bölüm'),
        sectionIds: Array(10).fill('id'),
        targetHours: 2,
      }

      const configNear = {
        examDate: nearExamDate,
        userLevel: 'beginner' as const,
        totalSections: 10,
        sectionTitles: Array(10).fill('Bölüm'),
        sectionIds: Array(10).fill('id'),
        targetHours: 2,
      }

      const scheduleFar = generateStudySchedule(configFar)
      const scheduleNear = generateStudySchedule(configNear)

      const readingFar = scheduleFar.filter(item => item.type === 'reading').length
      const readingNear = scheduleNear.filter(item => item.type === 'reading').length

      expect(readingNear).toBeLessThanOrEqual(readingFar)
    })
  })
})
