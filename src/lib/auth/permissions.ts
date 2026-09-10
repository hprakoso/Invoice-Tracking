/**
 * Pure authorization predicates, kept out of the route files so they can be
 * unit-tested directly — a Next route module is expected to export only its
 * handlers, and these are rules worth testing on their own.
 *
 * No `next/server` and no Prisma import: these decide, callers enforce.
 */

/**
 * Who may relabel or remove a document on an invoice.
 *
 * Staff keep the access they had. VENDOR is new, and deliberately narrow: the
 * confirmation step asks the uploader to check the AI's classification, and
 * until now the uploader was the one role that could not act on it — the review
 * UI rendered the type picker and the remove button for vendors, and every
 * click 403'd.
 *
 * Scoped to a draft so a vendor can never relabel documents on an invoice
 * already in GA or finance review. Ownership is a separate check the caller
 * has already made via requireInvoiceAccess.
 */
export function canMutateDocuments(role: string, isDraft: boolean): boolean {
  return role === 'VENDOR' ? isDraft : true
}
