import { NextResponse } from 'next/server'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// ponytail: a background setInterval sweep doesn't fire reliably on
// serverless (the process can freeze between invocations), so expired
// entries are instead swept lazily every SWEEP_EVERY calls. Bounds
// memory without depending on a timer that may never run.
const SWEEP_EVERY = 100
let callCount = 0

function sweepExpired(now: number) {
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}

export function rateLimit(
  identifier: string,
  maxRequests: number = 10,
  windowMs: number = 60_000,
): NextResponse<{ error: string }> | null {
  const now = Date.now()

  callCount++
  if (callCount % SWEEP_EVERY === 0) sweepExpired(now)

  const entry = store.get(identifier)

  if (!entry || now > entry.resetAt) {
    store.set(identifier, { count: 1, resetAt: now + windowMs })
    return null
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    )
  }

  entry.count++
  return null
}
