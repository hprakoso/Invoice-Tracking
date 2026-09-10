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

/**
 * Whether a user may change their own password.
 *
 * A vendor account is created by an admin with an initial password and gets
 * exactly one self-service change: the forced one at first login. After that
 * the vendor cannot rotate its own credential — an admin issues a new
 * temporary password instead, which re-arms `mustChangePassword` and hands the
 * vendor another single forced change. So every vendor password change is
 * admin-initiated, and no admin ever holds a vendor's live password.
 *
 * `mustChangePassword` is exactly this permit: true means "still on the
 * password an admin issued". Every other role keeps unrestricted self-service.
 */
export function canChangeOwnPassword(role: string, mustChangePassword: boolean): boolean {
  return role !== 'VENDOR' || mustChangePassword
}

/**
 * Paths a VENDOR may still reach while it has not completed the forced initial
 * password change. Everything needed to sign in, sign out, and set the new
 * password — and nothing else.
 */
const FORCED_CHANGE_ALLOWED_PATHS = [
  '/api/auth', // NextAuth session, sign-in and sign-out
  '/api/users/me/password', // the route that clears the flag
]

/**
 * Backend half of the forced initial password change.
 *
 * The obligation used to be a middleware redirect on page routes only, while
 * every `/api/*` request went straight through — so a vendor still on the
 * admin-issued password could upload invoices and edit its vendor record
 * through the API without ever changing it. Scoped to VENDOR so no other
 * role's access changes.
 */
export function isVendorApiBlockedPendingPasswordChange(
  role: string,
  mustChangePassword: boolean,
  pathname: string,
): boolean {
  if (role !== 'VENDOR' || !mustChangePassword) return false
  if (!pathname.startsWith('/api/')) return false
  return !FORCED_CHANGE_ALLOWED_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  )
}
