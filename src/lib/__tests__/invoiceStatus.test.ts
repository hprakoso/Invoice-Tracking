import { describe, it, expect } from 'vitest'
import {
  INVOICE_STATUSES,
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  isValidStatusTransition,
  canVendorEdit,
  MAIN_FLOW_STATUSES,
  EXCEPTION_STATUSES,
  OPEN_STATUSES,
  NON_OPEN_STATUSES,
} from '../invoiceStatus'

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

// The vendor edit-lock used to be "not CLOSED/REJECTED", which left a vendor
// able to rewrite totalAmount, dueDate and invoiceNumber on an invoice finance
// had verified, treasury had scheduled, or that was already PAID.
describe('canVendorEdit', () => {
  it('allows edits while the invoice is still with the vendor', () => {
    for (const s of ['RECEIVED', 'REGISTERED', 'DOC_INCOMPLETE', 'RETURNED_TO_VENDOR', 'WAITING_TAX_DOCUMENT']) {
      expect(canVendorEdit(s)).toBe(true)
    }
  })

  it('locks edits once verification has started or payment is in motion', () => {
    for (const s of [
      'DOC_VERIFICATION', 'FINANCE_VERIFICATION', 'READY_FOR_PAYMENT', 'TREASURY_PROCESS',
      'PAYMENT_SCHEDULED', 'PAID', 'CLOSED', 'REJECTED', 'PAYMENT_HOLD', 'WAITING_APPROVAL',
    ]) {
      expect(canVendorEdit(s)).toBe(false)
    }
  })
})

describe('status set composition', () => {
  it('splits every status into exactly one of main-flow or exception', () => {
    expect([...MAIN_FLOW_STATUSES, ...EXCEPTION_STATUSES].sort()).toEqual([...INVOICE_STATUSES].sort())
    for (const s of MAIN_FLOW_STATUSES) {
      expect((EXCEPTION_STATUSES as readonly string[]).includes(s)).toBe(false)
    }
  })

  it('treats open and settled as complements — nothing counted twice or missed', () => {
    expect([...OPEN_STATUSES, ...NON_OPEN_STATUSES].sort()).toEqual([...INVOICE_STATUSES].sort())
    expect(OPEN_STATUSES).not.toContain('PAID')
    expect(OPEN_STATUSES).toContain('PAYMENT_HOLD') // exception states are still open
  })
})
