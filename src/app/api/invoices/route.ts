import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole, unlinkedVendorResponse } from '@/lib/auth/helpers'
import { Prisma } from '@prisma/client'
import { createInvoiceSchema, validationErrorResponse } from '@/lib/validations'
import { buildDashboardFilter } from '@/lib/services/dashboardStats'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  // VENDOR can only see their own invoices — server-enforced, never
  // client-supplied. buildDashboardFilter applies the scoping itself.
  const unlinked = unlinkedVendorResponse(session)
  if (unlinked) return unlinked

  // The dashboard's filter builder, not a second copy of it: the hand-rolled
  // block this replaces silently ignored companyId (which the dashboard
  // honoured), so the same query string scoped one surface but not the other.
  const where = buildDashboardFilter(req.nextUrl.searchParams, session)

  const invoices = await prisma.invoice.findMany({
    where,
    // `items` is deliberately not included: the list page never renders line
    // items, and including them serialised the whole invoice_items table on
    // every filter change. Detail pages fetch their own items.
    include: {
      vendor: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(invoices)
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN', 'VENDOR', 'GA_STAFF', 'GA_MANAGER'])
  if (error || !session) return error

  const body = await req.json()

  const parsed = createInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }
  const data = parsed.data

  // VENDOR can only submit invoices for their own vendor
  const effectiveVendorId =
    session.user.role === 'VENDOR' ? session.user.vendorId : data.vendorId
  if (session.user.role === 'VENDOR' && !effectiveVendorId) {
    return NextResponse.json({ error: 'Vendor account not linked' }, { status: 403 })
  }

  // GA_STAFF creating an invoice is the hardcopy's first handler by default
  const effectivePicId =
    session.user.role === 'GA_STAFF' ? session.user.id : (data.picId ?? null)

  let invoice
  try {
    invoice = await prisma.invoice.create({
    data: {
      vendorId: effectiveVendorId as string,
      companyId: data.companyId ?? null,
      invoiceNumber: data.invoiceNumber,
      poNumber: data.poNumber,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      currency: data.currency,
      subtotal: data.subtotal ?? null,
      taxAmount: data.taxAmount ?? null,
      totalAmount: data.totalAmount,
      notes: data.notes ?? null,
      status: 'RECEIVED',
      isDraft: data.isDraft ?? false,
      picStage: data.picStage,
      sendDate: data.sendDate ? new Date(data.sendDate) : null,
      picId: effectivePicId,
      createdById: session.user.id,
      stageHistory: {
        create: { stage: data.picStage ?? 'GA', changedById: session.user.id },
      },
      items: {
        create: data.items.map((item, i) => ({
          description: item.description,
          quantity: item.quantity ?? null,
          unitPrice: item.unitPrice ?? null,
          total: item.total,
          sortOrder: i,
        })),
      },
    },
      include: { vendor: true, items: true },
    })
  } catch (e) {
    // The partial unique index (migration 20260902000000_invoice_duplicate_guard)
    // is all that stands between a direct API caller and two live invoices
    // carrying the same number. POST had no duplicate check and no P2002
    // handler, so a collision surfaced as an opaque 500 rather than the
    // conflict PATCH reports. Unlike PATCH there is no auto-reject here: a
    // brand-new row rejected on arrival is noise, so the caller is told to fix
    // the number instead.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: 'Invoice number already exists for this vendor', invoiceNumber: data.invoiceNumber },
        { status: 409 },
      )
    }
    throw e
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber },
    },
  })

  return NextResponse.json(invoice, { status: 201 })
}
