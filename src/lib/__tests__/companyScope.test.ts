import { describe, it, expect, vi } from 'vitest'

// helpers.ts imports next-auth; canSeeCompany itself is pure.
vi.mock('@/lib/auth/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { buildDashboardFilter } from '../services/dashboardStats'
import { canSeeCompany, companyScopeOf } from '../auth/helpers'
import { scopedFor } from '../services/reminderScheduler'

// GA_STAFF is scoped to the companies an ADMIN assigned it. buildDashboardFilter
// is the single gate behind the invoice list, the dashboard and the Excel
// export, so these assert the business behaviour at that one point: a staffer
// sees its companies' invoices (plus company-less ones) and nothing else, and no query string can widen
// that. Cross-role isolation (ADMIN/GA_MANAGER/VENDOR) is asserted too, because
// the risk of a scoping change is that it leaks sideways into another role.

const COMPANY_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const gaStaff = { user: { role: 'GA_STAFF', vendorId: null } }
const admin = { user: { role: 'ADMIN', vendorId: null } }
const gaManager = { user: { role: 'GA_MANAGER', vendorId: null } }
const vendor = { user: { role: 'VENDOR', vendorId: 'vendor-1' } }

const q = (s = '') => new URLSearchParams(s)

describe('GA_STAFF single-company scope', () => {
  it('restricts the query to the one assigned company', () => {
    const where = buildDashboardFilter(q(), gaStaff, [COMPANY_A])
    expect(where.OR).toEqual([{ companyId: { in: [COMPANY_A] } }, { companyId: null }])
  })

  it('still honours the other filters alongside the scope', () => {
    const where = buildDashboardFilter(q('status=PAID&search=INV-1'), gaStaff, [COMPANY_A])
    expect(where.OR).toEqual([{ companyId: { in: [COMPANY_A] } }, { companyId: null }])
    expect(where.status).toBe('PAID')
    expect(where.invoiceNumber).toEqual({ contains: 'INV-1', mode: 'insensitive' })
  })
})

describe('GA_STAFF multi-company scope', () => {
  it('covers every assigned company', () => {
    const where = buildDashboardFilter(q(), gaStaff, [COMPANY_A, COMPANY_B])
    expect(where.OR).toEqual([{ companyId: { in: [COMPANY_A, COMPANY_B] } }, { companyId: null }])
  })

  it('narrows to one of them when the user filters by it', () => {
    const where = buildDashboardFilter(q(`companyId=${COMPANY_B}`), gaStaff, [COMPANY_A, COMPANY_B])
    expect(where.companyId).toBe(COMPANY_B)
  })
})

describe('cross-company access is denied, not widened', () => {
  // The dangerous shape: a staffer scoped to A asks for B's invoices. The scope
  // must win, and it must resolve to "nothing" rather than silently dropping
  // the clause (which would return every invoice).
  it('returns an impossible filter when asked for a company outside the scope', () => {
    const where = buildDashboardFilter(q(`companyId=${COMPANY_B}`), gaStaff, [COMPANY_A])
    expect(where.companyId).toEqual({ in: [] })
    expect(where.companyId).not.toBe(COMPANY_B)
  })

  it('a staffer assigned nothing sees only company-less invoices, not everything', () => {
    const where = buildDashboardFilter(q(), gaStaff, [])
    expect(where.OR).toEqual([{ companyId: { in: [] } }, { companyId: null }])
  })

  it('never drops the company clause for a scoped caller', () => {
    for (const search of ['', 'status=PAID', `companyId=${COMPANY_B}`, 'vendorId=x']) {
      const where = buildDashboardFilter(q(search), gaStaff, [COMPANY_A])
      expect(where.companyId ?? where.OR).toBeDefined()
    }
  })
})

describe('other roles are unaffected by company scoping', () => {
  it('ADMIN stays organisation-wide', () => {
    expect(buildDashboardFilter(q(), admin, null).companyId).toBeUndefined()
  })

  it('GA_MANAGER stays organisation-wide', () => {
    expect(buildDashboardFilter(q(), gaManager, null).companyId).toBeUndefined()
  })

  it('ADMIN can still filter to a single company by choice', () => {
    expect(buildDashboardFilter(q(`companyId=${COMPANY_A}`), admin, null).companyId).toBe(COMPANY_A)
  })

  // VENDOR scoping is by vendorId and must not be touched by this work.
  it('VENDOR is still scoped by vendor, with no company restriction', () => {
    const where = buildDashboardFilter(q(), vendor, null)
    expect(where.vendorId).toBe('vendor-1')
    expect(where.companyId).toBeUndefined()
  })

  it('VENDOR cannot escape its vendor scope via the query string', () => {
    const where = buildDashboardFilter(q('vendorId=someone-else'), vendor, null)
    expect(where.vendorId).toBe('vendor-1')
  })
})

describe('drafts stay excluded regardless of scope', () => {
  it('keeps isDraft:false for a scoped GA_STAFF', () => {
    expect(buildDashboardFilter(q(), gaStaff, [COMPANY_A]).isDraft).toBe(false)
  })
})

describe('"All companies" GA_STAFF', () => {
  // gaStaffCompanyScope returns null for handlesAllCompanies, the same value
  // ADMIN/GA_MANAGER get — so the filter is identical to theirs.
  it('sees exactly what ADMIN sees', () => {
    expect(buildDashboardFilter(q(), gaStaff, null)).toEqual(buildDashboardFilter(q(), admin, null))
  })
})

describe('canSeeCompany (single-invoice routes and notifications)', () => {
  it('unrestricted scope sees every company', () => {
    expect(canSeeCompany(null, COMPANY_B)).toBe(true)
  })
  it('scoped staffer sees its own company only', () => {
    expect(canSeeCompany([COMPANY_A], COMPANY_A)).toBe(true)
    expect(canSeeCompany([COMPANY_A], COMPANY_B)).toBe(false)
  })
  it('an invoice with no company is visible to every GA_STAFF', () => {
    expect(canSeeCompany([COMPANY_A], null)).toBe(true)
    expect(canSeeCompany([], null)).toBe(true)
  })
})

describe('companyScopeOf (loaded user row -> scope)', () => {
  const row = (role: string, handlesAllCompanies: boolean, ids: string[] = []) =>
    ({ role, handlesAllCompanies, scopedCompanies: ids.map((id) => ({ id })) })

  it('GA_STAFF with "All" is unrestricted', () => {
    expect(companyScopeOf(row('GA_STAFF', true, [COMPANY_A]))).toBeNull()
  })
  it('GA_STAFF without "All" is limited to its companies', () => {
    expect(companyScopeOf(row('GA_STAFF', false, [COMPANY_A]))).toEqual([COMPANY_A])
  })
  it('other roles are never company-restricted', () => {
    expect(companyScopeOf(row('GA_MANAGER', false, [COMPANY_A]))).toBeNull()
    expect(companyScopeOf(row('ADMIN', false))).toBeNull()
  })
})

describe('reminder notifications follow the company scope', () => {
  const invoices = [
    { id: 'a', vendorId: 'vendor-1', companyId: COMPANY_A },
    { id: 'b', vendorId: 'vendor-2', companyId: COMPANY_B },
    { id: 'n', vendorId: 'vendor-2', companyId: null },
  ]
  const recipient = (role: 'GA_STAFF' | 'GA_MANAGER' | 'VENDOR', companyScope: string[] | null, vendorId: string | null = null) =>
    ({ id: 'u', email: 'u@x', role, vendorId, companyScope })

  it('scoped GA_STAFF hears about its company and company-less invoices only', () => {
    expect(scopedFor(recipient('GA_STAFF', [COMPANY_A]), invoices).map((i) => i.id)).toEqual(['a', 'n'])
  })
  it('"All" GA_STAFF and GA_MANAGER hear about everything', () => {
    expect(scopedFor(recipient('GA_STAFF', null), invoices)).toHaveLength(3)
    expect(scopedFor(recipient('GA_MANAGER', null), invoices)).toHaveLength(3)
  })
  it('VENDOR stays scoped to its own vendor', () => {
    expect(scopedFor(recipient('VENDOR', null, 'vendor-2'), invoices).map((i) => i.id)).toEqual(['b', 'n'])
  })
})
