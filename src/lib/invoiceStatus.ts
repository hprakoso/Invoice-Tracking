// Pure InvoiceStatus constants — no server-only imports, so both API routes
// and client components can import this directly. src/lib/validations.ts
// re-exports these for existing importers; new client-side code should
// import from here to avoid pulling in next/server via validations.ts.

export const INVOICE_STATUSES = [
  // Main flow (linear)
  'RECEIVED', 'REGISTERED', 'DOC_VERIFICATION', 'FINANCE_VERIFICATION', 'READY_FOR_PAYMENT',
  'TREASURY_PROCESS', 'PAYMENT_SCHEDULED', 'PAID', 'CLOSED',
  // Exception states
  'DOC_INCOMPLETE', 'RETURNED_TO_VENDOR', 'WAITING_USER_CONFIRMATION', 'WAITING_APPROVAL',
  'WAITING_TAX_DOCUMENT', 'REJECTED', 'PAYMENT_HOLD', 'VENDOR_BANK_ISSUE',
] as const

// Terminal statuses — no outbound transitions except PAID -> CLOSED.
export const TERMINAL_STATUSES = ['CLOSED', 'REJECTED'] as const

// Each exception state has exactly one fixed entry point and one fixed
// resolution target (not "return to whatever it was before") — keeps this
// table deterministic without a `preExceptionStatus` column. See the
// approved plan (2026-09-01) for the full rationale per branch.
export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  RECEIVED: ['REGISTERED'],
  REGISTERED: ['DOC_VERIFICATION', 'REJECTED'],
  DOC_VERIFICATION: ['FINANCE_VERIFICATION', 'DOC_INCOMPLETE', 'RETURNED_TO_VENDOR', 'WAITING_TAX_DOCUMENT', 'REJECTED'],
  DOC_INCOMPLETE: ['DOC_VERIFICATION', 'REJECTED'],
  RETURNED_TO_VENDOR: ['REGISTERED', 'REJECTED'],
  WAITING_TAX_DOCUMENT: ['DOC_VERIFICATION', 'REJECTED'],
  FINANCE_VERIFICATION: ['READY_FOR_PAYMENT', 'WAITING_USER_CONFIRMATION', 'REJECTED'],
  WAITING_USER_CONFIRMATION: ['FINANCE_VERIFICATION', 'REJECTED'],
  READY_FOR_PAYMENT: ['TREASURY_PROCESS', 'WAITING_APPROVAL', 'REJECTED'],
  WAITING_APPROVAL: ['READY_FOR_PAYMENT', 'REJECTED'],
  TREASURY_PROCESS: ['PAYMENT_SCHEDULED', 'PAYMENT_HOLD', 'VENDOR_BANK_ISSUE'],
  PAYMENT_SCHEDULED: ['PAID', 'PAYMENT_HOLD', 'VENDOR_BANK_ISSUE'],
  PAYMENT_HOLD: ['TREASURY_PROCESS'],
  VENDOR_BANK_ISSUE: ['TREASURY_PROCESS'],
  PAID: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
}

export function isValidStatusTransition(from: string, to: string): boolean {
  if (from === to) return true
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}
