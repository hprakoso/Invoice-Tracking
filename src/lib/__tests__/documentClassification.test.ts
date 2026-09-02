import { describe, it, expect } from 'vitest'
import { normalizeClassification, CLASSIFICATION_CONFIDENCE_FLOOR } from '../services/geminiExtraction'

// The user's requirement for multi-document upload was that misclassification
// is unacceptable. The real guarantee is the manual override in the UI; this
// function is the second line — it refuses to promote a low-confidence or
// unrecognized label into a specific document type.
describe('normalizeClassification', () => {
  it('keeps a confident, known type', () => {
    expect(normalizeClassification('TAX_INVOICE', 95)).toEqual({ type: 'TAX_INVOICE', confidence: 95 })
    expect(normalizeClassification('BAST', CLASSIFICATION_CONFIDENCE_FLOOR)).toEqual({
      type: 'BAST',
      confidence: CLASSIFICATION_CONFIDENCE_FLOOR,
    })
  })

  it('falls back to OTHER below the confidence floor, keeping the score', () => {
    const result = normalizeClassification('TAX_INVOICE', CLASSIFICATION_CONFIDENCE_FLOOR - 1)
    expect(result.type).toBe('OTHER')
    expect(result.confidence).toBe(CLASSIFICATION_CONFIDENCE_FLOOR - 1)
  })

  it('falls back to OTHER for a type the model invented', () => {
    expect(normalizeClassification('PURCHASE_ORDER', 99).type).toBe('OTHER')
    expect(normalizeClassification('invoice', 99).type).toBe('OTHER') // enum is case-sensitive
  })

  it('treats missing/garbage input as OTHER at zero confidence', () => {
    expect(normalizeClassification(null, null)).toEqual({ type: 'OTHER', confidence: 0 })
    expect(normalizeClassification(undefined, undefined)).toEqual({ type: 'OTHER', confidence: 0 })
    expect(normalizeClassification('INVOICE', NaN)).toEqual({ type: 'OTHER', confidence: 0 })
  })

  it('clamps out-of-range confidences instead of trusting them', () => {
    expect(normalizeClassification('INVOICE', 140)).toEqual({ type: 'INVOICE', confidence: 100 })
    expect(normalizeClassification('INVOICE', -20)).toEqual({ type: 'OTHER', confidence: 0 })
  })
})
