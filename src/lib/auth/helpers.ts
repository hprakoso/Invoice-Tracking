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
    },
  })

  const isVendor = session.user.role === 'VENDOR'
  if (!invoice || (isVendor && invoice.vendorId !== session.user.vendorId)) {
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
