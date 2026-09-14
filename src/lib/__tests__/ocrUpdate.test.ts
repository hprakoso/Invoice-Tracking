import { describe, it, expect } from 'vitest'
import { buildOcrUpdate } from '../services/geminiExtraction'
import type { ExtractionResult } from '../services/geminiExtraction'

// The OCR route wrote Gemini's output straight to Prisma — no zod, bare
// parseFloat, `new Date(model_string)`. buildOcrUpdate is where that write is
// now validated, so these tests are mostly negative paths: what the model can
// return that must NOT reach the database.

const field = (value: string | null, confidence = 90) => ({ value, confidence })

function extraction(over: Partial<Record<string, unknown>> = {}): ExtractionResult {
  return {
    document_type: 'INVOICE',
    classification_confidence: 95,
    vendor_name: field('PT Contoh'),
    company_name: field('PT Nusantara Gemilang Sejahtera'),
    company_npwp: field('31.234.567.8-901.000'),
    invoice_number: field('INV-001'),
    po_number: field('PO-2026-001'),
    invoice_date: field('2026-09-01'),
    due_date: field('2026-09-30'),
    currency: field('IDR'),
    subtotal: field('1000000'),
    tax_amount: field('110000'),
    total_amount: field('1110000'),
    line_items: [],
    overall_confidence: 90,
    ...over,
  } as ExtractionResult
}

const noCurrent = { invoiceDate: null, dueDate: null }

describe('buildOcrUpdate — happy path', () => {
  it('writes every validated field', () => {
    const { data, rejected } = buildOcrUpdate(extraction(), noCurrent)
    expect(rejected).toEqual([])
    expect(data.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(data.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(data.currency).toBe('IDR')
    expect(data.subtotal).toBe(1000000)
    expect(data.taxAmount).toBe(110000)
    expect(data.totalAmount).toBe(1110000)
    expect(data.ocrConfidence).toBe(90)
  })
})

describe('buildOcrUpdate — impossible date pairs', () => {
  // This is the case that started the review: a dashboard counting overdue
  // invoices while no invoice detail showed anything overdue.
  it('rejects a due date earlier than the invoice date', () => {
    const { data, rejected } = buildOcrUpdate(
      extraction({ invoice_date: field('2026-09-30'), due_date: field('2026-09-01') }),
      noCurrent,
    )
    expect(rejected).toContain('due_date')
    expect(data.dueDate).toBeUndefined()
    expect(data.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-09-30')
  })

  it('compares against the stored invoice date when the model misses it', () => {
    const { data, rejected } = buildOcrUpdate(
      extraction({ invoice_date: field(null), due_date: field('2026-01-01') }),
      { invoiceDate: new Date('2026-06-01T00:00:00Z'), dueDate: null },
    )
    expect(rejected).toContain('due_date')
    expect(data.dueDate).toBeUndefined()
  })

  it('accepts a due date equal to the invoice date', () => {
    const { rejected, data } = buildOcrUpdate(
      extraction({ invoice_date: field('2026-09-01'), due_date: field('2026-09-01') }),
      noCurrent,
    )
    expect(rejected).toEqual([])
    expect(data.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('rejects implausible years instead of parking an invoice in the wrong bucket forever', () => {
    expect(buildOcrUpdate(extraction({ due_date: field('2205-09-07') }), noCurrent).rejected).toContain('due_date')
    expect(buildOcrUpdate(extraction({ invoice_date: field('0202-09-07') }), noCurrent).rejected).toContain('invoice_date')
  })

  it('leaves an existing due date alone when extraction returns nothing', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ due_date: field(null) }), {
      invoiceDate: null,
      dueDate: new Date('2026-09-30T00:00:00Z'),
    })
    // Not nulled and not reported — the model simply had nothing to say.
    expect(data.dueDate).toBeUndefined()
    expect(rejected).not.toContain('due_date')
  })

  it('reports an unparseable date rather than silently dropping it', () => {
    expect(buildOcrUpdate(extraction({ due_date: field('tidak terbaca') }), noCurrent).rejected).toContain('due_date')
  })
})

describe('buildOcrUpdate — amounts', () => {
  it('reads Indonesian thousands grouping instead of truncating it', () => {
    const { data } = buildOcrUpdate(extraction({ total_amount: field('12.500.000') }), noCurrent)
    expect(data.totalAmount).toBe(12500000)
  })

  it('rejects negatives', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ total_amount: field('-500000') }), noCurrent)
    expect(rejected).toContain('total_amount')
    expect(data.totalAmount).toBeUndefined()
  })

  it('rejects unparseable amounts without throwing or writing NaN', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ subtotal: field('N/A') }), noCurrent)
    expect(rejected).toContain('subtotal')
    expect(data.subtotal).toBeUndefined()
    expect(data.totalAmount).toBe(1110000) // other fields survive
  })

  it('keeps a genuine zero', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ tax_amount: field('0') }), noCurrent)
    expect(data.taxAmount).toBe(0)
    expect(rejected).not.toContain('tax_amount')
  })
})

// Shares toIsoDateOnly with the confirmation form, so OCR can no longer store
// a day the review step would have refused to show.
describe('buildOcrUpdate — ambiguous dates are refused, not guessed', () => {
  it('rejects a slashed date instead of reinterpreting it', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ invoice_date: field('03/04/2026') }), noCurrent)
    expect(rejected).toContain('invoice_date')
    expect(data.invoiceDate).toBeUndefined()
  })

  it('still accepts the ISO form the prompt asks for', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ invoice_date: field('2026-04-03') }), noCurrent)
    expect(rejected).not.toContain('invoice_date')
    expect(data.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-04-03')
  })
})

describe('buildOcrUpdate — currency', () => {
  it('accepts IDR and normalises case', () => {
    expect(buildOcrUpdate(extraction({ currency: field('idr') }), noCurrent).data.currency).toBe('IDR')
  })

  // The business bills in Rupiah only and nothing converts between currencies,
  // so a well-formed foreign code must not reach the column either.
  it('rejects any other currency, however well-formed', () => {
    for (const other of ['USD', 'SGD', 'EUR']) {
      const { data, rejected } = buildOcrUpdate(extraction({ currency: field(other) }), noCurrent)
      expect(rejected).toContain('currency')
      expect(data.currency).toBeUndefined()
    }
  })

  it('leaves the column alone when the document names no currency', () => {
    const { data, rejected } = buildOcrUpdate(extraction({ currency: field(null) }), noCurrent)
    expect(data.currency).toBeUndefined()
    expect(rejected).not.toContain('currency')
  })

  it('rejects free text the model invents', () => {
    for (const bad of ['US$', 'Rupiah', 'IDR (Indonesian Rupiah)']) {
      const { data, rejected } = buildOcrUpdate(extraction({ currency: field(bad) }), noCurrent)
      expect(rejected).toContain('currency')
      expect(data.currency).toBeUndefined()
    }
  })
})
