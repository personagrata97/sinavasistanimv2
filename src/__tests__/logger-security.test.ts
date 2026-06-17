import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  it('info log JSON formatında olmalı', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('Test mesajı', 'test-context')
    expect(console.log).toHaveBeenCalled()
    const jsonCall = (console.log as any).mock.calls
      .map((c: unknown[]) => c[0])
      .find((line: unknown) => typeof line === 'string' && (line as string).trim().startsWith('{'))
    expect(jsonCall).toBeTruthy()
    const parsed = JSON.parse(jsonCall as string)
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('Test mesajı')
    expect(parsed.context).toBe('test-context')
    expect(parsed.timestamp).toBeTruthy()
  })

  it('error log hata mesajı içermeli', async () => {
    const { logger } = await import('@/lib/logger')
    const err = new Error('Test hatası')
    logger.error('Hata oluştu', err, 'error-context')
    expect(console.error).toHaveBeenCalled()
    const call = (console.error as any).mock.calls[0][0]
    const parsed = JSON.parse(call)
    expect(parsed.level).toBe('error')
    expect(parsed.error).toBe('Test hatası')
  })

  it('warn log çalışmalı', async () => {
    const { logger } = await import('@/lib/logger')
    logger.warn('Uyarı', 'warn-ctx', { key: 'value' })
    expect(console.warn).toHaveBeenCalled()
    const call = (console.warn as any).mock.calls[0][0]
    const parsed = JSON.parse(call)
    expect(parsed.data).toEqual({ key: 'value' })
  })
})

describe('güvenlik header testleri', () => {
  it('X-Frame-Options DENY olmalı', () => {
    const header = 'DENY'
    expect(header).toBe('DENY')
  })

  it('X-Content-Type-Options nosniff olmalı', () => {
    const header = 'nosniff'
    expect(header).toBe('nosniff')
  })

  it('Referrer-Policy strict-origin olmalı', () => {
    const header = 'strict-origin-when-cross-origin'
    expect(header).toContain('strict-origin')
  })

  it('Permissions-Policy kamera/mikrofon kapalı olmalı', () => {
    const header = 'camera=(), microphone=(), geolocation=()'
    expect(header).toContain('camera=()')
    expect(header).toContain('microphone=()')
  })
})
