import { describe, it, expect } from 'vitest'
import { isOverdue } from '../format'

describe('isOverdue', () => {
  const past = new Date(Date.now() - 86400_000).toISOString()
  const future = new Date(Date.now() + 86400_000).toISOString()

  it('is false with no due date', () => {
    expect(isOverdue(null)).toBe(false)
    expect(isOverdue(undefined)).toBe(false)
  })

  it('is true when due date passed and status is open', () => {
    expect(isOverdue(past, 'RECEIVED')).toBe(true)
    expect(isOverdue(past, 'DOC_VERIFICATION')).toBe(true)
    expect(isOverdue(past, 'TREASURY_PROCESS')).toBe(true)
    expect(isOverdue(past)).toBe(true) // no status = assume open
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
