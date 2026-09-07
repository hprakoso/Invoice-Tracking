// Pure InvoiceStatus constants — no server-only imports, so both API routes
// and client components can import this directly. src/lib/validations.ts
// re-exports these for existing importers; new client-side code should
// import from here to avoid pulling in next/server via validations.ts.

// The linear happy path, in workflow order.
export const MAIN_FLOW_STATUSES = [
  'RECEIVED', 'REGISTERED', 'DOC_VERIFICATION', 'FINANCE_VERIFICATION', 'READY_FOR_PAYMENT',
  'TREASURY_PROCESS', 'PAYMENT_SCHEDULED', 'PAID', 'CLOSED',
] as const

// Off-ramps from the main flow. Kept as its own list because the dashboard's
// pipeline strip renders the two groups differently — it used to re-declare
// both locally and silently dropped every status it didn't know about.
export const EXCEPTION_STATUSES = [
  'DOC_INCOMPLETE', 'RETURNED_TO_VENDOR', 'WAITING_USER_CONFIRMATION', 'WAITING_APPROVAL',
  'WAITING_TAX_DOCUMENT', 'REJECTED', 'PAYMENT_HOLD', 'VENDOR_BANK_ISSUE',
] as const

export const INVOICE_STATUSES = [...MAIN_FLOW_STATUSES, ...EXCEPTION_STATUSES] as const

export type InvoiceStatusName = (typeof INVOICE_STATUSES)[number]

// Terminal statuses — no outbound transitions except PAID -> CLOSED.
export const TERMINAL_STATUSES = ['CLOSED', 'REJECTED'] as const

/**
 * Settled/dead statuses — excluded from every "open" metric (Total Payable,
 * Overdue, Open Count, Aging) and from the overdue tag on the invoice list. A
 * REJECTED invoice isn't payable any more than a PAID/CLOSED one is.
 *
 * This is the single definition. It used to exist twice (a private Set in
 * format.ts driving the list UI, an exported array in dashboardStats.ts driving
 * the KPIs and reminders), which is exactly how the dashboard and the list came
 * to disagree about what "overdue" means.
 */
export const NON_OPEN_STATUSES = ['PAID', 'CLOSED', 'REJECTED'] as const

/** Everything still in play — the complement of NON_OPEN_STATUSES. */
export const OPEN_STATUSES: InvoiceStatusName[] = INVOICE_STATUSES.filter(
  (s) => !(NON_OPEN_STATUSES as readonly string[]).includes(s),
)

/**
 * Statuses where a VENDOR may still edit its own invoice's data (amounts,
 * dates, invoice number). The cutoff is "the ball is still in the vendor's
 * court": once GA starts verifying the document, the submitted figures are
 * what the internal workflow is reviewing, so changing them underneath would
 * let an approved amount diverge from the stored one.
 *
 * The old rule was merely "not CLOSED/REJECTED", which left a vendor able to
 * rewrite totalAmount on an invoice that finance had already verified and
 * treasury had scheduled for payment — or one already marked PAID.
 */
export const VENDOR_EDITABLE_STATUSES = [
  'RECEIVED', 'REGISTERED', 'DOC_INCOMPLETE', 'RETURNED_TO_VENDOR', 'WAITING_TAX_DOCUMENT',
] as const

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
