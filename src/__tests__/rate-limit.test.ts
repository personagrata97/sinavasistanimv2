import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => {
    // Her test öncesi temiz başla
  })

  it('ilk istek başarılı olmalı', async () => {
    const result = await rateLimit('test-1', 5, 60000)
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('limit aşıldığında başarısız olmalı', async () => {
    const key = 'test-limit-' + Date.now()
    for (let i = 0; i < 3; i++) {
      await rateLimit(key, 3, 60000)
    }
    const result = await rateLimit(key, 3, 60000)
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('remaining doğru azalmalı', async () => {
    const key = 'test-remaining-' + Date.now()
    const r1 = await rateLimit(key, 5, 60000)
    expect(r1.remaining).toBe(4)
    const r2 = await rateLimit(key, 5, 60000)
    expect(r2.remaining).toBe(3)
  })

  it('farklı key\'ler bağımsız olmalı', async () => {
    const key1 = 'user-a-' + Date.now()
    const key2 = 'user-b-' + Date.now()
    for (let i = 0; i < 3; i++) await rateLimit(key1, 3, 60000)
    const r1 = await rateLimit(key1, 3, 60000)
    const r2 = await rateLimit(key2, 3, 60000)
    expect(r1.success).toBe(false)
    expect(r2.success).toBe(true)
  })

  describe('getRateLimitHeaders', () => {
    it('doğru header değerleri dönmeli', () => {
      const headers = getRateLimitHeaders(25, 30000, 30)
      expect(headers['X-RateLimit-Limit']).toBe('30')
      expect(headers['X-RateLimit-Remaining']).toBe('25')
      expect(headers['X-RateLimit-Reset']).toBe('30')
    })
  })
})
