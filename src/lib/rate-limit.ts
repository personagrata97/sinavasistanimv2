import { isRedisEnabled, redis } from "./redis"

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Periyodik temizlik (memory leak önleme) — 30 saniyede bir expired entry'leri temizle
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key)
      cleaned++
    }
  }
  if (cleaned > 0) console.log(`[RATE_LIMIT] 🧹 ${cleaned} expired entry temizlendi (aktif: ${store.size})`)
}, 30_000)

// Node.js process'in shutdown'da interval'ı temizle
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => clearInterval(cleanupInterval))
}

export async function rateLimit(
  key: string,
  limit: number = 30,
  windowMs: number = 60_000
): Promise<{ success: boolean; remaining: number; resetIn: number }> {
  
  if (isRedisEnabled() && redis) {
    try {
      const redisKey = `ratelimit:${key}`
      const count = await redis.incr(redisKey)
      
      if (count === 1) {
        await redis.pexpire(redisKey, windowMs)
      }
      
      const ttl = await redis.pttl(redisKey)
      const resetIn = ttl > 0 ? ttl : windowMs
      
      if (count > limit) {
        return { success: false, remaining: 0, resetIn }
      }
      
      return { success: true, remaining: limit - count, resetIn }
    } catch (e) {
      console.warn("[RATE_LIMIT] Redis hızı sınırlayıcı başarısız oldu, Memory fallback devrede:", e)
    }
  }

  // İn-memory yedek mekanizma
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: limit - 1, resetIn: windowMs }
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, resetIn: entry.resetAt - now }
  }

  entry.count++
  return { success: true, remaining: limit - entry.count, resetIn: entry.resetAt - now }
}

export function getRateLimitHeaders(remaining: number, resetIn: number, limit: number = 30) {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(resetIn / 1000)),
  }
}
