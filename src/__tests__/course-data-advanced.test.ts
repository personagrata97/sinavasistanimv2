import { describe, it, expect } from 'vitest'
import { getCourseBySlug, getCourseByOrder, getExamConfig, getCourseMockExamParams, estimateScaledScore, ALL_COURSES, SPL_LEVEL_3_COURSES, MASAK_COURSES, SPL_BD_COURSES, CIA_COURSES, CISA_COURSES, SMMM_COURSES, MASAK_EXAM_CONFIG, SPL_EXAM_CONFIG, CISA_EXAM_CONFIG } from '@/lib/course-data'

describe('course-data gelişmiş testler', () => {
  describe('veri bütünlüğü', () => {
    it('tüm kursların slug\'ı benzersiz olmalı', () => {
      const slugs = ALL_COURSES.map(c => c.slug)
      const uniqueSlugs = new Set(slugs)
      expect(slugs.length).toBe(uniqueSlugs.size)
    })

    it('tüm kursların geçerli icon adı olmalı', () => {
      ALL_COURSES.forEach(c => {
        expect(c.icon).toBeTruthy()
        expect(typeof c.icon).toBe('string')
        expect(c.icon.length).toBeGreaterThan(0)
      })
    })

    it('tüm kursların geçerli renk gradient olmalı', () => {
      ALL_COURSES.forEach(c => {
        expect(c.color).toContain('from-')
        expect(c.color).toContain('to-')
      })
    })

    it('SPL Level 3 12 ders olmalı', () => {
      expect(SPL_LEVEL_3_COURSES.length).toBe(12)
    })

    it('MASAK 1 ders olmalı', () => {
      expect(MASAK_COURSES.length).toBe(1)
    })

    it('SPL BD 5 ders olmalı', () => {
      expect(SPL_BD_COURSES.length).toBe(5)
    })

    it('ALL_COURSES tüm program kurslarının toplamı olmalı', () => {
      expect(ALL_COURSES.length).toBe(
        SPL_LEVEL_3_COURSES.length + MASAK_COURSES.length + SPL_BD_COURSES.length +
        CIA_COURSES.length + CISA_COURSES.length + SMMM_COURSES.length
      )
    })

    it('her kursun order numarası pozitif olmalı', () => {
      ALL_COURSES.forEach(c => {
        expect(c.order).toBeGreaterThan(0)
      })
    })
  })

  describe('sınav konfigürasyonu', () => {
    it('MASAK sınavı 100 soru olmalı', () => {
      expect(MASAK_EXAM_CONFIG.totalQuestions).toBe(100)
    })

    it('MASAK geçme notu 65 olmalı', () => {
      expect(MASAK_EXAM_CONFIG.passingScore).toBe(65)
    })

    it('SPL sınavı ders başına 25 soru olmalı', () => {
      expect(SPL_EXAM_CONFIG.totalQuestions).toBe(25)
    })

    it('yanlış doğruyu götürmemeli', () => {
      expect(MASAK_EXAM_CONFIG.negativeMarking).toBe(false)
      expect(SPL_EXAM_CONFIG.negativeMarking).toBe(false)
    })

    it('getExamConfig doğru config dönmeli', () => {
      expect(getExamConfig('masak')).toBe(MASAK_EXAM_CONFIG)
      expect(getExamConfig('spl-duzey-3')).toBe(SPL_EXAM_CONFIG)
    })

    it('bilinmeyen program için undefined dönmeli', () => {
      expect(getExamConfig('bilinmeyen')).toBeUndefined()
    })
  })

  describe('getCourseMockExamParams', () => {
    it('SPL dersi 25 soru / 45 dk dönmeli', () => {
      const params = getCourseMockExamParams('spl-duzey-3', 'sermaye-piyasasi-mevzuati')
      expect(params?.questionCount).toBe(25)
      expect(params?.durationMinutes).toBe(45)
      expect(params?.passingScore).toBe(60)
      expect(params?.scoreDisplayMode).toBe('percent')
    })

    it('MASAK modülü 50 soru / min havuz 50 olmalı', () => {
      const params = getCourseMockExamParams('masak', 'masak-uyum-gorevlisi')
      expect(params?.questionCount).toBe(50)
      expect(params?.minQuestionPool).toBe(50)
    })

    it('CISA 150 soru / ölçekli geçme 450 olmalı', () => {
      const params = getCourseMockExamParams('cisa', 'cisa')
      expect(params?.questionCount).toBe(150)
      expect(params?.durationMinutes).toBe(240)
      expect(params?.passingScore).toBe(450)
      expect(params?.scoreDisplayMode).toBe('scaled')
    })

    it('CIA Part 1 = 125 soru / 150 dk olmalı', () => {
      const params = getCourseMockExamParams('cia', 'cia-part-1')
      expect(params?.questionCount).toBe(125)
      expect(params?.durationMinutes).toBe(150)
      expect(params?.passingScore).toBe(600)
    })

    it('BSBD dersi 25 soru / 45 dk olmalı', () => {
      const params = getCourseMockExamParams('spl-bagimsiz-denetim', 'bd-bilgi-sistemleri-guvenligi')
      expect(params?.questionCount).toBe(25)
      expect(params?.durationMinutes).toBe(45)
      expect(params?.passingScore).toBe(60)
    })
  })

  describe('estimateScaledScore', () => {
    it('CISA tam doğru ≈ 800 olmalı', () => {
      expect(estimateScaledScore(150, 150, CISA_EXAM_CONFIG)).toBe(800)
    })

    it('CISA yarı doğru ≈ 500 olmalı', () => {
      expect(estimateScaledScore(75, 150, CISA_EXAM_CONFIG)).toBe(500)
    })
  })

  describe('getCourseByOrder', () => {
    it('geçerli order ile kurs bulmalı', () => {
      const c = getCourseByOrder(1)
      expect(c).toBeTruthy()
      expect(c?.name).toContain('Sermaye Piyasası')
    })

    it('geçersiz order için undefined dönmeli', () => {
      expect(getCourseByOrder(999)).toBeUndefined()
    })
  })
})
