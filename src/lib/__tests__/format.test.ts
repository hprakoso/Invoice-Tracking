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
    expect(isOverdue(past, 'SUBMITTED')).toBe(true)
    expect(isOverdue(past, 'REVISION')).toBe(true)
    expect(isOverdue(past)).toBe(true) // no status = assume open
  })

  it('is false when due date is in the future', () => {
    expect(isOverdue(future, 'SUBMITTED')).toBe(false)
  })

  it.each(['PAID', 'CANCELLED', 'REJECTED', 'VOID', 'DRAFT'])(
    'is false for terminal status %s even with a past due date',
    (status) => {
      expect(isOverdue(past, status)).toBe(false)
    },
  )
})
