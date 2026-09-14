import { describe, it, expect } from 'vitest'
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  updateInvoiceStageSchema,
  validateDeliveryDates,
  validateInvoiceDates,
  validateReadyToGoLive,
  isPlaceholderPoNumber,
  DRAFT_PO_PLACEHOLDER,
} from '../validations'

describe('createInvoiceSchema', () => {
  const base = {
    vendorId: '00000000-0000-4000-8000-000000000000',
    invoiceNumber: 'INV-2026-0001',
    totalAmount: 1000000,
  }

  it('requires poNumber', () => {
    expect(createInvoiceSchema.safeParse(base).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...base, poNumber: 'PO-2026-0001' }).success).toBe(true)
  })

  // The document-first wizard creates its row before the document has been
  // read, so it has no PO yet. Only a draft gets that exemption.
  it('exempts a draft from the poNumber requirement', () => {
    expect(createInvoiceSchema.safeParse({ ...base, isDraft: true }).success).toBe(true)
    expect(createInvoiceSchema.safeParse({ ...base, isDraft: false }).success).toBe(false)
  })

  // The business bills in Rupiah only, and nothing converts between currencies
  // — a USD total would be summed into Total Payable as if it were IDR.
  describe('currency is IDR-only for the write paths', () => {
    const live = { ...base, poNumber: 'PO-2026-0001' }

    it('defaults to IDR when the caller omits it', () => {
      const parsed = createInvoiceSchema.safeParse(live)
      expect(parsed.success && parsed.data.currency).toBe('IDR')
    })

    it('accepts an explicit IDR on create and update', () => {
      expect(createInvoiceSchema.safeParse({ ...live, currency: 'IDR' }).success).toBe(true)
      expect(updateInvoiceSchema.safeParse({ currency: 'IDR' }).success).toBe(true)
    })

    it('refuses any other currency on create', () => {
      for (const other of ['USD', 'SGD', 'EUR', 'idr']) {
        expect(createInvoiceSchema.safeParse({ ...live, currency: other }).success).toBe(false)
      }
    })

    it('refuses any other currency on update', () => {
      expect(updateInvoiceSchema.safeParse({ currency: 'USD' }).success).toBe(false)
    })

    // Nothing here rewrites stored data: an edit that does not mention currency
    // stays valid, so a legacy non-IDR row can still be corrected in other ways.
    it('leaves an edit that does not mention currency alone', () => {
      expect(updateInvoiceSchema.safeParse({ notes: 'ok' }).success).toBe(true)
    })
  })
})

describe('validateReadyToGoLive', () => {
  const ready = { poNumber: 'PO-2026-0001', companyId: '00000000-0000-4000-8000-000000000000', documentCount: 1 }

  it('accepts a draft carrying a real PO and a company', () => {
    expect(validateReadyToGoLive(ready).valid).toBe(true)
  })

  it('refuses the placeholder PO the draft row was created with', () => {
    expect(validateReadyToGoLive({ ...ready, poNumber: DRAFT_PO_PLACEHOLDER }).valid).toBe(false)
    expect(validateReadyToGoLive({ ...ready, poNumber: ` ${DRAFT_PO_PLACEHOLDER} ` }).valid).toBe(false)
  })

  it('refuses a blank PO', () => {
    expect(validateReadyToGoLive({ ...ready, poNumber: '' }).valid).toBe(false)
    expect(validateReadyToGoLive({ ...ready, poNumber: '   ' }).valid).toBe(false)
    expect(validateReadyToGoLive({ ...ready, poNumber: null }).valid).toBe(false)
  })

  it('refuses an unresolved company', () => {
    expect(validateReadyToGoLive({ ...ready, companyId: null }).valid).toBe(false)
    expect(validateReadyToGoLive({ ...ready, companyId: undefined }).valid).toBe(false)
  })

  // Unreachable before the document-first flow (a file had to exist before the
  // row was created); reachable now that the review step can delete documents.
  it('refuses an invoice with no documents left attached', () => {
    expect(validateReadyToGoLive({ ...ready, documentCount: 0 }).valid).toBe(false)
    expect(validateReadyToGoLive({ ...ready, documentCount: 3 }).valid).toBe(true)
  })

  // 'N/A' is what migration 20260901000000 backfilled onto real pre-PO rows,
  // so it must stay a legitimate value rather than reading as an unfinished draft.
  it("does not treat the historical 'N/A' backfill as a placeholder", () => {
    expect(isPlaceholderPoNumber('N/A')).toBe(false)
    expect(validateReadyToGoLive({ ...ready, poNumber: 'N/A' }).valid).toBe(true)
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
