import { describe, it, expect } from 'vitest'
import { createInvoiceSchema, updateInvoiceStageSchema, validateDeliveryDates } from '../validations'

describe('createInvoiceSchema', () => {
  it('requires poNumber', () => {
    const base = {
      vendorId: '00000000-0000-4000-8000-000000000000',
      invoiceNumber: 'INV-2026-0001',
      totalAmount: 1000000,
    }
    expect(createInvoiceSchema.safeParse(base).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...base, poNumber: 'PO-2026-0001' }).success).toBe(true)
  })
})

describe('updateInvoiceStageSchema', () => {
  it('accepts every PIC stage', () => {
    for (const stage of ['GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY']) {
      expect(updateInvoiceStageSchema.safeParse({ stage }).success).toBe(true)
    }
  })

  it('rejects an unknown stage', () => {
    expect(updateInvoiceStageSchema.safeParse({ stage: 'BOGUS' }).success).toBe(false)
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
