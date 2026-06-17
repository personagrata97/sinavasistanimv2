import { describe, it, expect } from 'vitest'
import { getCourseBySlug, getCourseByOrder, getExamConfig, getExamPartCourseSlugs, ALL_COURSES, SPL_LEVEL_3_COURSES, MASAK_COURSES, SPL_BD_COURSES, CIA_COURSES, CISA_COURSES, SMMM_COURSES } from '@/lib/course-data'

describe('course-data', () => {
  describe('SPL_LEVEL_3_COURSES', () => {
    it('12 ders olmalı', () => {
      expect(SPL_LEVEL_3_COURSES).toHaveLength(12)
    })

    it('her dersin gerekli alanları olmalı', () => {
      for (const course of SPL_LEVEL_3_COURSES) {
        expect(course.name).toBeTruthy()
        expect(course.slug).toBeTruthy()
        expect(course.order).toBeGreaterThan(0)
        expect(course.icon).toBeTruthy()
        expect(course.color).toMatch(/^from-/)
      }
    })

    it('slug değerleri benzersiz olmalı', () => {
      const slugs = SPL_LEVEL_3_COURSES.map(c => c.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    })

    it('sıra numaraları 1-12 arasında olmalı', () => {
      const orders = SPL_LEVEL_3_COURSES.map(c => c.order).sort((a, b) => a - b)
      expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    })
  })

  describe('MASAK_COURSES', () => {
    it('en az 1 ders olmalı', () => {
      expect(MASAK_COURSES.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('SPL_BD_COURSES', () => {
    it('5 ders (BSBD resmi yapı) olmalı', () => {
      expect(SPL_BD_COURSES).toHaveLength(5)
      expect(SPL_BD_COURSES.map(c => c.slug)).toEqual([
        'bd-sermaye-piyasasi-mevzuati',
        'bd-bilgi-sistemleri-yonetimi',
        'bd-bilgi-sistemleri-gelistirme',
        'bd-bilgi-sistemleri-isletimi',
        'bd-bilgi-sistemleri-guvenligi',
      ])
    })
  })

  describe('getCourseBySlug', () => {
    it('geçerli slug ile ders bulmalı', () => {
      const course = getCourseBySlug('sermaye-piyasasi-mevzuati')
      expect(course).toBeDefined()
      expect(course?.name).toContain('Sermaye')
    })

    it('geçersiz slug ile undefined dönmeli', () => {
      expect(getCourseBySlug('nonexistent')).toBeUndefined()
    })
  })

  describe('getCourseByOrder', () => {
    it('geçerli sıra ile ders bulmalı', () => {
      const course = getCourseByOrder(1)
      expect(course).toBeDefined()
      expect(course?.order).toBe(1)
    })

    it('geçersiz sıra ile undefined dönmeli', () => {
      expect(getCourseByOrder(999)).toBeUndefined()
    })
  })

  describe('getExamConfig', () => {
    it('SPL sınavı 25 soru / 45 dk olmalı', () => {
      const config = getExamConfig('spl-duzey-3')
      expect(config?.totalQuestions).toBe(25)
      expect(config?.durationMinutes).toBe(45)
      expect(config?.passingScore).toBe(60)
      expect(config?.negativeMarking).toBe(false)
    })

    it('MASAK sınavı 100 soru / 90 dk olmalı', () => {
      const config = getExamConfig('masak')
      expect(config?.totalQuestions).toBe(100)
      expect(config?.durationMinutes).toBe(90)
      expect(config?.passingScore).toBe(65)
      expect(config?.modules).toHaveLength(2)
    })

    it('geçersiz program için undefined dönmeli', () => {
      expect(getExamConfig('nonexistent')).toBeUndefined()
    })
  })

  describe('CIA_COURSES', () => {
    it('3 parça (course) olmalı', () => {
      expect(CIA_COURSES).toHaveLength(3)
    })

    it('slug değerleri cia-part-* desenine uymalı', () => {
      expect(CIA_COURSES.map(c => c.slug)).toEqual(['cia-part-1', 'cia-part-2', 'cia-part-3'])
    })
  })

  describe('CISA_COURSES', () => {
    it('tek oturum (1 course) olmalı', () => {
      expect(CISA_COURSES).toHaveLength(1)
      expect(CISA_COURSES[0].slug).toBe('cisa')
    })
  })

  describe('SMMM_COURSES', () => {
    it('8 ders olmalı', () => {
      expect(SMMM_COURSES).toHaveLength(8)
    })
  })

  describe('getExamConfig — CIA', () => {
    it('CIA sınavı 3 parça / 325 soru / 390 dk olmalı', () => {
      const config = getExamConfig('cia')
      expect(config?.totalQuestions).toBe(325)
      expect(config?.durationMinutes).toBe(390)
      expect(config?.passingScore).toBe(600)
      expect(config?.modules).toHaveLength(3)
      expect(config?.choiceCount).toBe(4)
      expect(config?.negativeMarking).toBe(false)
      expect(config?.sourceMode).toBe('strict')
    })

    it('CIA Part 1 = 125 soru / 150 dk olmalı', () => {
      const config = getExamConfig('cia')
      const part1 = config?.modules.find(m => m.courses.includes('cia-part-1'))
      expect(part1?.questionCount).toBe(125)
      expect(part1?.durationMinutes).toBe(150)
    })
  })

  describe('getExamConfig — CISA', () => {
    it('CISA sınavı 150 soru / 240 dk / geçme 450 olmalı', () => {
      const config = getExamConfig('cisa')
      expect(config?.totalQuestions).toBe(150)
      expect(config?.durationMinutes).toBe(240)
      expect(config?.passingScore).toBe(450)
      expect(config?.choiceCount).toBe(4)
      expect(config?.negativeMarking).toBe(false)
      expect(config?.moduleBarrier).toBe(0)
      expect(config?.sourceMode).toBe('strict')
      expect(config?.modules).toHaveLength(1)
      expect(config?.modules[0].courses).toEqual(['cisa'])
    })
  })

  describe('getExamPartCourseSlugs', () => {
    it('gerçek sınav parçası sayısına göre slug dönmeli', () => {
      expect(getExamPartCourseSlugs('spl-duzey-3')).toHaveLength(12)
      expect(getExamPartCourseSlugs('cia')).toHaveLength(3)
      expect(getExamPartCourseSlugs('cisa')).toEqual(['cisa'])
      expect(getExamPartCourseSlugs('spl-bagimsiz-denetim')).toHaveLength(5)
      expect(getExamPartCourseSlugs('masak')).toHaveLength(1)
      expect(getExamPartCourseSlugs('smmm')).toHaveLength(8)
    })
  })

  describe('getExamConfig — SMMM', () => {
    it('SMMM sınavı 8 ders / geçme 60 / ders barajı 50 olmalı', () => {
      const config = getExamConfig('smmm')
      expect(config?.modules).toHaveLength(8)
      expect(config?.passingScore).toBe(60)
      expect(config?.moduleBarrier).toBe(50)
      expect(config?.choiceCount).toBe(5)
      expect(config?.negativeMarking).toBe(false)
      expect(config?.sourceMode).toBe('enriched')
    })
  })

  describe('sourceMode bayrağı', () => {
    it('SPL/MASAK/BD strict olmalı', () => {
      expect(getExamConfig('spl-duzey-3')?.sourceMode).toBe('strict')
      expect(getExamConfig('masak')?.sourceMode).toBe('strict')
      expect(getExamConfig('spl-bagimsiz-denetim')?.sourceMode).toBe('strict')
    })

    it('CIA/CISA strict, SMMM enriched olmalı', () => {
      expect(getExamConfig('cia')?.sourceMode).toBe('strict')
      expect(getExamConfig('cisa')?.sourceMode).toBe('strict')
      expect(getExamConfig('smmm')?.sourceMode).toBe('enriched')
    })
  })

  describe('ALL_COURSES', () => {
    it('tüm kursları birleştirmeli', () => {
      expect(ALL_COURSES.length).toBe(
        SPL_LEVEL_3_COURSES.length + MASAK_COURSES.length + SPL_BD_COURSES.length +
        CIA_COURSES.length + CISA_COURSES.length + SMMM_COURSES.length
      )
    })

    it('slug değerleri tüm kurslarda benzersiz olmalı', () => {
      const slugs = ALL_COURSES.map(c => c.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    })
  })
})
