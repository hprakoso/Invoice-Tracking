import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth module — controls what session is returned
const mockSession = vi.fn()
vi.mock('@/lib/auth/auth', () => ({
  auth: () => mockSession(),
}))

// Mock NextResponse
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({ data, status: init?.status ?? 200 }),
  },
}))

import { requireAuth, requireRole } from '../helpers'
import type { Role } from '@prisma/client'

function makeSession(role: Role, vendorId: string | null = null) {
  return {
    user: { id: 'user-1', email: 'test@test.com', name: 'Test', role, vendorId },
    expires: '2099-01-01',
  }
}

describe('requireAuth', () => {
  it('returns 401 when no session', async () => {
    mockSession.mockResolvedValue(null)
    const { error, session } = await requireAuth()
    expect(error).toMatchObject({ status: 401 })
    expect(session).toBeNull()
  })

  it('returns session when authenticated', async () => {
    mockSession.mockResolvedValue(makeSession('FINANCE'))
    const { error, session } = await requireAuth()
    expect(error).toBeNull()
    expect(session?.user.role).toBe('FINANCE')
  })
})

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['ADMIN', ['ADMIN'], true],
    ['GA_STAFF', ['GA_STAFF', 'GA_MANAGER', 'FINANCE'], true],
    ['GA_MANAGER', ['GA_MANAGER', 'FINANCE'], true],
    ['FINANCE', ['GA_MANAGER', 'FINANCE'], true],
    ['VENDOR', ['FINANCE', 'ADMIN', 'VENDOR'], true],
    ['VENDOR', ['FINANCE', 'ADMIN'], false],
    ['GA_STAFF', ['GA_MANAGER', 'FINANCE'], false],
    ['VIEWER', ['GA_MANAGER', 'FINANCE', 'GA_STAFF'], false],
  ] as [Role, Role[], boolean][])(
    '%s accessing %s — allowed: %s',
    async (role, allowedRoles, allowed) => {
      mockSession.mockResolvedValue(makeSession(role))
      const { error, session } = await requireRole(allowedRoles)
      if (allowed) {
        expect(error).toBeNull()
        expect(session?.user.role).toBe(role)
      } else {
        expect(error).toMatchObject({ status: 403 })
        expect(session).toBeNull()
      }
    }
  )
})

describe('VENDOR data isolation logic', () => {
  it('VENDOR session includes vendorId in JWT', async () => {
    mockSession.mockResolvedValue(makeSession('VENDOR', 'vendor-abc'))
    const { session } = await requireAuth()
    expect(session?.user.vendorId).toBe('vendor-abc')
  })

  it('non-VENDOR session has null vendorId', async () => {
    mockSession.mockResolvedValue(makeSession('FINANCE', null))
    const { session } = await requireAuth()
    expect(session?.user.vendorId).toBeNull()
  })

  it('VENDOR with no vendorId linked is detectable', async () => {
    mockSession.mockResolvedValue(makeSession('VENDOR', null))
    const { session } = await requireAuth()
    expect(session?.user.role).toBe('VENDOR')
    expect(session?.user.vendorId).toBeNull()
  })
})
