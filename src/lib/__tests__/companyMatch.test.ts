import { describe, it, expect } from 'vitest'
import { matchCompany, normalizeCompanyName, normalizeNpwp } from '../companyMatch'

// The upload wizard no longer asks which company an invoice is for — it comes
// from the bill-to block the OCR reads. Billing the wrong PT is a financial
// error, so these are mostly negative paths: what must NOT auto-resolve.

// Mirrors the seeded companies, which already contain a substring collision
// ('Gemilang' appears in two names) — the reason this matcher is exact-only.
const COMPANIES = [
  { id: 'c1', name: 'PT Nusantara Gemilang Sejahtera', npwp: '31.234.567.8-901.000' },
  { id: 'c2', name: 'PT Delta Prima Energi', npwp: '32.345.678.9-012.000' },
  { id: 'c3', name: 'UD Karya Gemilang', npwp: null },
]

describe('normalizeCompanyName', () => {
  it('ignores case, punctuation, spacing and the legal-form prefix', () => {
    const expected = 'DELTA PRIMA ENERGI'
    expect(normalizeCompanyName('PT Delta Prima Energi')).toBe(expected)
    expect(normalizeCompanyName('pt. delta prima energi')).toBe(expected)
    expect(normalizeCompanyName('  PT.   DELTA  PRIMA   ENERGI  ')).toBe(expected)
    expect(normalizeCompanyName('Delta Prima Energi')).toBe(expected)
  })

  it('strips stacked legal-form tokens but never the whole name', () => {
    expect(normalizeCompanyName('PT Persero Angkasa')).toBe('ANGKASA')
    expect(normalizeCompanyName('PT')).toBe('PT')
  })

  it('keeps genuinely different names distinct', () => {
    expect(normalizeCompanyName('PT Nusantara Gemilang Sejahtera')).not.toBe(
      normalizeCompanyName('UD Karya Gemilang'),
    )
  })

  it('treats missing input as empty', () => {
    expect(normalizeCompanyName(null)).toBe('')
    expect(normalizeCompanyName(undefined)).toBe('')
    expect(normalizeCompanyName('   ')).toBe('')
    expect(normalizeCompanyName('...')).toBe('')
  })
})

describe('normalizeNpwp', () => {
  it('compares digits only', () => {
    expect(normalizeNpwp('31.234.567.8-901.000')).toBe('312345678901000')
    expect(normalizeNpwp('312345678901000')).toBe('312345678901000')
  })

  it('rejects a partial read rather than treating it as an identifier', () => {
    expect(normalizeNpwp('31.234')).toBe('')
    expect(normalizeNpwp(null)).toBe('')
  })
})

describe('matchCompany', () => {
  it('matches on a normalized name', () => {
    expect(matchCompany({ name: 'pt. delta prima energi' }, COMPANIES)).toEqual({
      companyId: 'c2',
      status: 'MATCHED',
      matchedOn: 'name',
    })
  })

  it('prefers NPWP, which survives a name the letterhead spells differently', () => {
    expect(
      matchCompany({ name: 'NUSANTARA GEMILANG', npwp: '31.234.567.8-901.000' }, COMPANIES),
    ).toEqual({ companyId: 'c1', status: 'MATCHED', matchedOn: 'npwp' })
  })

  it('falls back to the name when the NPWP is not on file', () => {
    // c3 has no npwp stored, so the npwp key cannot hit — the name still must.
    expect(matchCompany({ name: 'UD Karya Gemilang', npwp: '99.999.999.9-999.000' }, COMPANIES))
      .toEqual({ companyId: 'c3', status: 'MATCHED', matchedOn: 'name' })
  })

  it('never substring-matches — the seeded collision must stay unresolved', () => {
    expect(matchCompany({ name: 'Gemilang' }, COMPANIES).status).toBe('UNMATCHED')
    expect(matchCompany({ name: 'PT Nusantara Gemilang' }, COMPANIES).status).toBe('UNMATCHED')
  })

  it('reports AMBIGUOUS instead of picking one of several same-named rows', () => {
    const duplicates = [
      { id: 'a', name: 'PT Sama Saja', npwp: null },
      { id: 'b', name: 'pt sama saja', npwp: null },
    ]
    expect(matchCompany({ name: 'PT Sama Saja' }, duplicates)).toEqual({
      companyId: null,
      status: 'AMBIGUOUS',
      matchedOn: 'name',
    })
  })

  it('reports AMBIGUOUS on a shared NPWP too', () => {
    const duplicates = [
      { id: 'a', name: 'PT Satu', npwp: '31.234.567.8-901.000' },
      { id: 'b', name: 'PT Dua', npwp: '312345678901000' },
    ]
    expect(matchCompany({ npwp: '31.234.567.8-901.000' }, duplicates)).toEqual({
      companyId: null,
      status: 'AMBIGUOUS',
      matchedOn: 'npwp',
    })
  })

  it('is UNMATCHED when OCR found no bill-to at all', () => {
    expect(matchCompany({ name: null, npwp: null }, COMPANIES)).toEqual({
      companyId: null,
      status: 'UNMATCHED',
      matchedOn: null,
    })
  })

  it('is UNMATCHED against an empty candidate list (e.g. all companies inactive)', () => {
    expect(matchCompany({ name: 'PT Delta Prima Energi' }, []).status).toBe('UNMATCHED')
  })
})
