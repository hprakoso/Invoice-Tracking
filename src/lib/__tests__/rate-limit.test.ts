import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      data,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}))

import { rateLimit } from '../rate-limit'

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests under the limit', () => {
    const id = `test-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(id, 3, 60_000)).toBeNull()
    }
  })

  it('blocks the request that exceeds the limit with 429 + Retry-After', () => {
    const id = `test-${Math.random()}`
    rateLimit(id, 2, 60_000)
    rateLimit(id, 2, 60_000)
    const blocked = rateLimit(id, 2, 60_000) as unknown as { status: number; headers: Record<string, string> }
    expect(blocked).not.toBeNull()
    expect(blocked.status).toBe(429)
    expect(blocked.headers['Retry-After']).toBeDefined()
  })

  it('resets once the window passes', () => {
    const id = `test-${Math.random()}`
    rateLimit(id, 1, 60_000)
    expect(rateLimit(id, 1, 60_000)).not.toBeNull() // blocked, still in window

    vi.advanceTimersByTime(60_001)

    expect(rateLimit(id, 1, 60_000)).toBeNull() // window reset, allowed again
  })

  it('tracks distinct identifiers independently', () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    rateLimit(a, 1, 60_000)
    expect(rateLimit(a, 1, 60_000)).not.toBeNull() // a is now blocked
    expect(rateLimit(b, 1, 60_000)).toBeNull() // b is unaffected
  })
})
