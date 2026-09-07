import { describe, it, expect } from 'vitest'
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  updateInvoiceStageSchema,
  validateDeliveryDates,
  validateInvoiceDates,
} from '../validations'

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

// Nothing anywhere enforced dueDate >= invoiceDate — not zod, not the routes,
// not the database. That is how invoices reached the dashboard's overdue count
// with a due date preceding their own invoice date.
describe('validateInvoiceDates', () => {
  it('rejects a due date before the invoice date', () => {
    expect(validateInvoiceDates('2026-09-30', '2026-09-01').valid).toBe(false)
  })

  it('accepts equal dates and normal ordering', () => {
    expect(validateInvoiceDates('2026-09-01', '2026-09-01').valid).toBe(true)
    expect(validateInvoiceDates('2026-09-01', '2026-09-30').valid).toBe(true)
  })

  it('passes when either date is missing — the pair is only checkable together', () => {
    expect(validateInvoiceDates(null, '2026-09-01').valid).toBe(true)
    expect(validateInvoiceDates('2026-09-01', undefined).valid).toBe(true)
  })
})

describe('invoice schemas — date rules', () => {
  const base = {
    vendorId: '00000000-0000-4000-8000-000000000000',
    invoiceNumber: 'INV-2026-0001',
    poNumber: 'PO-2026-0001',
    totalAmount: 1000000,
  }

  it('refuses a create whose due date precedes its invoice date', () => {
    const bad = createInvoiceSchema.safeParse({ ...base, invoiceDate: '2026-09-30', dueDate: '2026-09-01' })
    expect(bad.success).toBe(false)
  })

  it('refuses the same pair on update', () => {
    expect(updateInvoiceSchema.safeParse({ invoiceDate: '2026-09-30', dueDate: '2026-09-01' }).success).toBe(false)
  })

  it('normalises a timestamp to a calendar date so range filters can match it', () => {
    const parsed = updateInvoiceSchema.safeParse({ dueDate: '2026-09-07T10:00:00+07:00' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.dueDate).toBe('2026-09-07')
  })

  it('rejects implausible years an OCR misread can produce', () => {
    expect(updateInvoiceSchema.safeParse({ dueDate: '0202-09-07' }).success).toBe(false)
    expect(updateInvoiceSchema.safeParse({ dueDate: '2205-09-07' }).success).toBe(false)
  })

  it('trims invoice numbers so a padded copy cannot coexist with the original', () => {
    const parsed = createInvoiceSchema.safeParse({ ...base, invoiceNumber: '  INV-2026-0001  ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.invoiceNumber).toBe('INV-2026-0001')
  })

  it('requires total to equal subtotal + tax on create', () => {
    expect(createInvoiceSchema.safeParse({ ...base, subtotal: 900000, taxAmount: 99000 }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...base, subtotal: 900901, taxAmount: 99099 }).success).toBe(true)
  })
})
