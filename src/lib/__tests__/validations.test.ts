import { describe, it, expect } from 'vitest'
import { isValidStatusTransition, validateDeliveryDates, VALID_TRANSITIONS } from '../validations'

describe('isValidStatusTransition', () => {
  it.each(
    Object.entries(VALID_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => [from, to, true] as const)),
  )('allows %s -> %s', (from, to, expected) => {
    expect(isValidStatusTransition(from, to).valid).toBe(expected)
  })

  it('rejects SUBMITTED -> SUBMITTED (not a real transition)', () => {
    expect(isValidStatusTransition('SUBMITTED', 'SUBMITTED').valid).toBe(false)
  })

  it('rejects transitions out of terminal statuses', () => {
    expect(isValidStatusTransition('CANCELLED', 'SUBMITTED').valid).toBe(false)
    expect(isValidStatusTransition('REJECTED', 'SUBMITTED').valid).toBe(false)
    expect(isValidStatusTransition('VOID', 'SUBMITTED').valid).toBe(false)
  })

  it('rejects an unknown source status', () => {
    const result = isValidStatusTransition('BOGUS', 'SUBMITTED')
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/Unknown status/)
  })
})

describe('validateDeliveryDates', () => {
  it('is valid when either date is missing', () => {
    expect(validateDeliveryDates(null, null).valid).toBe(true)
    expect(validateDeliveryDates('2026-01-01', null).valid).toBe(true)
    expect(validateDeliveryDates(null, '2026-01-01').valid).toBe(true)
  })

  it('is valid when deliveredDate is on or after sendDate', () => {
    expect(validateDeliveryDates('2026-01-01', '2026-01-01').valid).toBe(true)
    expect(validateDeliveryDates('2026-01-01', '2026-01-02').valid).toBe(true)
  })

  it('is invalid when deliveredDate is before sendDate', () => {
    const result = validateDeliveryDates('2026-01-05', '2026-01-01')
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/deliveredDate/)
  })
})
