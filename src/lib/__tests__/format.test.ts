import { describe, it, expect } from 'vitest'
import { isOverdue, jakartaDayStart } from '../format'

describe('isOverdue', () => {
  const past = new Date(Date.now() - 86400_000).toISOString()
  const future = new Date(Date.now() + 86400_000).toISOString()

  it('is false with no due date', () => {
    expect(isOverdue(null, 'RECEIVED')).toBe(false)
    expect(isOverdue(undefined, 'RECEIVED')).toBe(false)
  })

  it('is true when due date passed and status is open', () => {
    expect(isOverdue(past, 'RECEIVED')).toBe(true)
    expect(isOverdue(past, 'DOC_VERIFICATION')).toBe(true)
    expect(isOverdue(past, 'TREASURY_PROCESS')).toBe(true)
  })

  it('is false when due date is in the future', () => {
    expect(isOverdue(future, 'RECEIVED')).toBe(false)
  })

  it('is false for settled statuses (PAID, CLOSED, REJECTED) even with a past due date', () => {
    expect(isOverdue(past, 'PAID')).toBe(false)
    expect(isOverdue(past, 'CLOSED')).toBe(false)
    expect(isOverdue(past, 'REJECTED')).toBe(false)
  })
})

describe('jakartaDayStart', () => {
  it('rolls the day over at 00:00 WIB, not 00:00 UTC', () => {
    // 2026-09-06T23:59Z is already 06:59 WIB on 7 Sep
    expect(jakartaDayStart(new Date('2026-09-06T23:59:00Z')).toISOString()).toBe('2026-09-07T00:00:00.000Z')
    // 2026-09-06T09:59Z is 16:59 WIB on 6 Sep — still the 6th
    expect(jakartaDayStart(new Date('2026-09-06T09:59:00Z')).toISOString()).toBe('2026-09-06T00:00:00.000Z')
  })

  it('returns UTC midnight, matching how due dates are stored', () => {
    const start = jakartaDayStart(new Date('2026-09-07T08:30:00Z'))
    expect(start.getUTCHours()).toBe(0)
    expect(start.getUTCMinutes()).toBe(0)
  })
})

// The bug this guards: due dates are calendar dates stored at UTC midnight, so
// comparing them against `new Date()` made an invoice overdue from 07:00 WIB on
// its own due day — the dashboard counted it, the list painted it red, and the
// cron emailed "sudah melewati jatuh tempo", all on the day it was still due.
describe('isOverdue — due-day boundary in Jakarta', () => {
  const dueToday = '2026-09-07T00:00:00.000Z'

  it('is NOT overdue during its own due day', () => {
    // 09:00 WIB on the due date
    expect(isOverdue(dueToday, 'RECEIVED', new Date('2026-09-07T02:00:00Z'))).toBe(false)
    // 23:59 WIB on the due date — last minute before it is genuinely late
    expect(isOverdue(dueToday, 'RECEIVED', new Date('2026-09-07T16:59:00Z'))).toBe(false)
  })

  it('becomes overdue at 00:00 WIB the following day', () => {
    // 00:01 WIB on 8 Sep
    expect(isOverdue(dueToday, 'RECEIVED', new Date('2026-09-07T17:01:00Z'))).toBe(true)
  })

  it('stays not-overdue for a settled invoice past its due day', () => {
    expect(isOverdue(dueToday, 'PAID', new Date('2026-09-30T00:00:00Z'))).toBe(false)
  })
})
