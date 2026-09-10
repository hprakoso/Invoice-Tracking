/**
 * Resolves the bill-to block an invoice carries into one of our own Company
 * rows, for the document-first upload flow where the user no longer picks the
 * company before uploading.
 *
 * Deliberately conservative — no fuzzy matching, no substring matching. A
 * wrong match bills the invoice to the wrong PT, which is a financial error,
 * not a display bug, and `Company.name` carries no unique constraint so two
 * rows may legitimately share a name. Anything short of a single unambiguous
 * hit resolves to null and the confirmation page asks the user.
 *
 * Substring matching was specifically rejected: the seeded data already
 * collides on it ('PT Nusantara Gemilang Sejahtera' vs 'UD Karya Gemilang').
 */

// Indonesian legal-form prefixes. Letterheads write 'PT.', 'PT', or drop it
// entirely, and the stored Company.name may differ from the printed one on
// exactly that token, so it is not part of a company's identity here.
const LEGAL_FORM_PREFIXES = new Set([
  'PT', 'CV', 'UD', 'PD', 'FA', 'NV', 'PERSERO', 'PERUM', 'KOPERASI', 'YAYASAN', 'TBK',
])

/**
 * Uppercase, drop punctuation, collapse whitespace, and strip leading
 * legal-form tokens — so 'PT. Nusantara Gemilang Sejahtera' and
 * 'NUSANTARA GEMILANG SEJAHTERA' compare equal. Everything after the leading
 * tokens is preserved verbatim, so two genuinely different companies never
 * collapse into one.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return ''
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  const tokens = cleaned.split(' ')
  // `tokens.length > 1` guards a company literally named 'PT' from becoming ''.
  while (tokens.length > 1 && LEGAL_FORM_PREFIXES.has(tokens[0])) tokens.shift()
  return tokens.join(' ')
}

// NPWP is printed as 01.234.567.8-901.000 but stored however it was typed, so
// both sides compare as digits only. The length floor rejects a partial read
// ('01.234') that would otherwise match nothing meaningful anyway, and keeps a
// truncated OCR string from being treated as a real identifier: 15 digits is
// the classic NPWP, 16 the NIK-based one.
const NPWP_MIN_DIGITS = 15

export function normalizeNpwp(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length >= NPWP_MIN_DIGITS ? digits : ''
}

export type CompanyMatchStatus = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS'

export interface CompanyCandidate {
  id: string
  name: string
  npwp?: string | null
}

export interface CompanyMatchResult {
  companyId: string | null
  status: CompanyMatchStatus
  /** Which identifier produced the hit — surfaced so the UI can say why. */
  matchedOn: 'npwp' | 'name' | null
}

/**
 * NPWP first, name second. NPWP is the stronger identifier (it survives
 * letterhead spelling changes and separates same-named companies), but it is
 * nullable and non-unique on our side, so it only narrows — it never widens.
 *
 * Two or more hits on either key is AMBIGUOUS, never a pick: with no unique
 * constraint on name, choosing one is choosing at random.
 *
 * Callers are expected to pass active companies only — an invoice must not be
 * auto-routed to a PT an admin has deactivated.
 */
export function matchCompany(
  extracted: { name?: string | null; npwp?: string | null },
  companies: CompanyCandidate[],
): CompanyMatchResult {
  const npwp = normalizeNpwp(extracted.npwp)
  if (npwp) {
    const hits = companies.filter((c) => normalizeNpwp(c.npwp) === npwp)
    if (hits.length === 1) return { companyId: hits[0].id, status: 'MATCHED', matchedOn: 'npwp' }
    if (hits.length > 1) return { companyId: null, status: 'AMBIGUOUS', matchedOn: 'npwp' }
    // No NPWP hit falls through to the name below rather than failing: the
    // bill-to NPWP may simply not be recorded on our Company row yet.
  }

  const name = normalizeCompanyName(extracted.name)
  if (!name) return { companyId: null, status: 'UNMATCHED', matchedOn: null }

  const hits = companies.filter((c) => normalizeCompanyName(c.name) === name)
  if (hits.length === 1) return { companyId: hits[0].id, status: 'MATCHED', matchedOn: 'name' }
  if (hits.length > 1) return { companyId: null, status: 'AMBIGUOUS', matchedOn: 'name' }
  return { companyId: null, status: 'UNMATCHED', matchedOn: null }
}
