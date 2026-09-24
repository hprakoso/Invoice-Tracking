import { auth } from '@/lib/auth/auth'
import { NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  }
  return { error: null, session }
}

export async function requireRole(allowedRoles: Role[]) {
  const { error, session } = await requireAuth()
  if (error || !session) return { error: error!, session: null }

  if (!allowedRoles.includes(session.user.role)) {
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      session: null,
    }
  }
  return { error: null, session }
}

/**
 * The companies a GA_STAFF account may see, or `null` for "no company
 * restriction": ADMIN and GA_MANAGER are organisation-wide, VENDOR is scoped by
 * vendorId instead, and a GA_STAFF flagged handlesAllCompanies covers every
 * company including ones created later. `[]` is NOT the same as `null` — it
 * means the staffer only sees invoices that have no company (see canSeeCompany).
 *
 * Read from the database on every call rather than carried in the JWT: if an
 * ADMIN removes a company from a staffer, it bites on the next request.
 */
export async function gaStaffCompanyScope(session: {
  user: { id: string; role: string }
}): Promise<string[] | null> {
  if (session.user.role !== 'GA_STAFF') return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { handlesAllCompanies: true, scopedCompanies: { select: { id: true } } },
  })
  if (!user) return []
  if (user.handlesAllCompanies) return null
  return user.scopedCompanies.map((c) => c.id)
}

/**
 * Whether a caller with `scope` (from gaStaffCompanyScope) may reach an invoice
 * billed to `companyId`. An invoice with no company is visible to every
 * GA_STAFF — nobody can be said to own it yet, and hiding it would strand it.
 */
export function canSeeCompany(scope: string[] | null, companyId: string | null): boolean {
  return scope === null || companyId === null || scope.includes(companyId)
}

/**
 * A VENDOR account with no vendorId can't be scoped to any data, so every
 * vendor-facing read must fail closed on it. Without this, a Prisma filter
 * built as `vendorId: session.user.vendorId ?? undefined` drops the clause
 * entirely and returns every vendor's rows.
 *
 * The state isn't reachable through the app's own APIs (createUserSchema and
 * PATCH /api/users/[id] both require vendorId for VENDOR), but the
 * users.vendor_id FK is ON DELETE SET NULL, so deleting a vendor row directly
 * in the DB produces it.
 */
export function unlinkedVendorResponse(session: {
  user: { role: string; vendorId?: string | null }
}): NextResponse | null {
  if (session.user.role === 'VENDOR' && !session.user.vendorId) {
    return NextResponse.json({ error: 'Vendor account not linked' }, { status: 403 })
  }
  return null
}

/**
 * Authentication plus per-invoice ownership in one call: VENDOR reaches only
 * its own vendor's invoices, every other authenticated role passes. Replaces
 * the ownership check that each single-invoice route used to hand-roll — the
 * OCR route, which is the only one that *writes*, was missing it entirely.
 *
 * A VENDOR gets 403 for a non-existent invoice as well as one it doesn't own,
 * so invoice ids can't be probed for existence.
 */
export async function requireInvoiceAccess(invoiceId: string, allowedRoles?: Role[]) {
  const { error, session } = allowedRoles ? await requireRole(allowedRoles) : await requireAuth()
  if (error || !session) return { error: error!, session: null, invoice: null }

  const unlinked = unlinkedVendorResponse(session)
  if (unlinked) return { error: unlinked, session: null, invoice: null }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      vendorId: true,
      status: true,
      filePath: true,
      fileType: true,
      totalAmount: true,
      invoiceDate: true,
      dueDate: true,
      // The document routes let a VENDOR relabel its own documents only while
      // the submission is still a draft, so callers need this alongside the
      // ownership check they already get here.
      isDraft: true,
      // Needed for the GA_STAFF company-scope check below.
      companyId: true,
    },
  })

  // GA_STAFF reaches only invoices of its companies (or with no company). Same
  // shape as the vendor check: the caller cannot tell "exists but forbidden"
  // from "does not exist".
  const outOfCompanyScope =
    !!invoice && !canSeeCompany(await gaStaffCompanyScope(session), invoice.companyId)

  const isVendor = session.user.role === 'VENDOR'
  if (!invoice || outOfCompanyScope || (isVendor && invoice.vendorId !== session.user.vendorId)) {
    return {
      error: isVendor
        ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        : NextResponse.json({ error: 'Not found' }, { status: 404 }),
      session: null,
      invoice: null,
    }
  }

  return { error: null, session, invoice }
}
