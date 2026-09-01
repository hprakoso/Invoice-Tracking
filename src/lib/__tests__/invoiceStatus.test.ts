import { describe, it, expect } from 'vitest'
import { INVOICE_STATUSES, TERMINAL_STATUSES, VALID_TRANSITIONS, isValidStatusTransition } from '../invoiceStatus'

describe('isValidStatusTransition', () => {
  it('allows the main-flow linear progression', () => {
    expect(isValidStatusTransition('RECEIVED', 'REGISTERED')).toBe(true)
    expect(isValidStatusTransition('REGISTERED', 'DOC_VERIFICATION')).toBe(true)
    expect(isValidStatusTransition('PAYMENT_SCHEDULED', 'PAID')).toBe(true)
    expect(isValidStatusTransition('PAID', 'CLOSED')).toBe(true)
  })

  it('rejects skipping ahead in the main flow', () => {
    expect(isValidStatusTransition('RECEIVED', 'PAID')).toBe(false)
    expect(isValidStatusTransition('DOC_VERIFICATION', 'TREASURY_PROCESS')).toBe(false)
  })

  it('allows entering and resolving an exception state', () => {
    expect(isValidStatusTransition('DOC_VERIFICATION', 'DOC_INCOMPLETE')).toBe(true)
    expect(isValidStatusTransition('DOC_INCOMPLETE', 'DOC_VERIFICATION')).toBe(true)
  })

  it('treats terminal statuses as having no outbound transitions except PAID -> CLOSED', () => {
    expect(VALID_TRANSITIONS.CLOSED).toEqual([])
    expect(VALID_TRANSITIONS.REJECTED).toEqual([])
    expect(isValidStatusTransition('CLOSED', 'RECEIVED')).toBe(false)
    expect(isValidStatusTransition('REJECTED', 'RECEIVED')).toBe(false)
  })

  it('treats same-status as a no-op valid transition', () => {
    expect(isValidStatusTransition('DOC_VERIFICATION', 'DOC_VERIFICATION')).toBe(true)
  })

  it('every status in INVOICE_STATUSES has a transition table entry', () => {
    for (const status of INVOICE_STATUSES) {
      expect(VALID_TRANSITIONS[status]).toBeDefined()
    }
  })

  it('TERMINAL_STATUSES matches the statuses with empty outbound transitions except PAID', () => {
    // PAID is not in TERMINAL_STATUSES (it can still move to CLOSED) but has
    // exactly one outbound edge; CLOSED/REJECTED are the true dead ends.
    for (const status of TERMINAL_STATUSES) {
      expect(VALID_TRANSITIONS[status]).toEqual([])
    }
  })
})
