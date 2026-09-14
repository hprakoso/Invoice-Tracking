import { describe, it, expect } from 'vitest'
import { applyKpiScope, parseKpiScope, NON_OPEN_STATUSES } from '../services/dashboardStats'

// The KPI cards double as the dashboard's filter. Each card is identified by
// the business predicate behind its figure — status codes and a due-date
// comparison — never by the card's UI label, so these assert the predicate.

const NOW = new Date('2026-09-14T03:00:00Z')

describe('parseKpiScope', () => {
  it('accepts the three card scopes', () => {
    for (const kpi of ['payable', 'overdue', 'open']) {
      expect(parseKpiScope(new URLSearchParams(`kpi=${kpi}`))).toBe(kpi)
    }
  })

  it('treats absent, unknown or label-shaped values as no card filter', () => {
    expect(parseKpiScope(new URLSearchParams())).toBeNull()
    expect(parseKpiScope(new URLSearchParams('kpi=Total%20Invoice'))).toBeNull()
    expect(parseKpiScope(new URLSearchParams('kpi=Jatuh%20Tempo'))).toBeNull()
    expect(parseKpiScope(new URLSearchParams('kpi='))).toBeNull()
  })
})

describe('applyKpiScope', () => {
  const base = { isDraft: false, vendorId: 'v1' }

  it('returns the filter untouched with no card selected — the reset path', () => {
    expect(applyKpiScope(base, null, NOW)).toEqual(base)
  })

  it('narrows to open invoices for the payable and open cards', () => {
    for (const kpi of ['payable', 'open'] as const) {
      expect(applyKpiScope(base, kpi, NOW)).toEqual({
        AND: [base, { status: { notIn: NON_OPEN_STATUSES } }],
      })
    }
  })

  it('adds a past-due predicate for the overdue card', () => {
    expect(applyKpiScope(base, 'overdue', NOW)).toEqual({
      AND: [
        base,
        { status: { notIn: NON_OPEN_STATUSES } },
        { dueDate: { lt: new Date('2026-09-14T00:00:00Z') } },
      ],
    })
  })

  // The card scope must never be able to widen the query. buildDashboardFilter
  // puts the VENDOR's own id in `where`; AND-composition keeps it intact
  // instead of letting a card overwrite the key.
  it('cannot drop vendor scoping — the base filter stays inside the AND', () => {
    const scoped = applyKpiScope({ isDraft: false, vendorId: 'vendor-a' }, 'overdue', NOW)
    expect(scoped.AND).toBeDefined()
    expect((scoped.AND as unknown[])[0]).toEqual({ isDraft: false, vendorId: 'vendor-a' })
    expect(scoped.vendorId).toBeUndefined()
  })

  // The aging aggregates spread the scoped filter and set their own bucket
  // `dueDate` on top. Because the card's predicate lives in AND, the spread
  // cannot clobber it and both conditions apply.
  it('survives a spread that sets its own dueDate on top', () => {
    const scoped = applyKpiScope(base, 'overdue', NOW)
    const bucket = { ...scoped, dueDate: { gte: NOW } }
    expect(bucket.AND).toEqual(scoped.AND)
    expect(bucket.dueDate).toEqual({ gte: NOW })
  })

  it("keeps the user's own status choice rather than replacing it", () => {
    const scoped = applyKpiScope({ isDraft: false, status: 'REGISTERED' }, 'open', NOW)
    expect((scoped.AND as unknown[])[0]).toEqual({ isDraft: false, status: 'REGISTERED' })
  })

  it('does not mutate the filter it is given', () => {
    const where = { isDraft: false, status: 'REGISTERED' as const }
    applyKpiScope(where, 'overdue', NOW)
    expect(where).toEqual({ isDraft: false, status: 'REGISTERED' })
  })
})
