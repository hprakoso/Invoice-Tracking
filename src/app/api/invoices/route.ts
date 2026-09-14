import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole, unlinkedVendorResponse } from '@/lib/auth/helpers'
import { Prisma } from '@prisma/client'
import { createInvoiceSchema, validationErrorResponse, DRAFT_PO_PLACEHOLDER } from '@/lib/validations'
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

  // Pagination is OPT-IN and the response body stays a bare array.
  //
  // Without `?page`/`?pageSize` this route behaves exactly as it always has —
  // same query, same unbounded result, same JSON — so no existing caller can
  // break. With them, the slice is taken in the database (skip/take) and the
  // metadata rides in response headers instead of wrapping the body in an
  // envelope, which would have been a breaking change to a contract documented
  // in docs/API.md. Filters are built above, i.e. applied BEFORE skip/take, so
  // a search scans the whole table and pages the matches rather than filtering
  // one page's worth of rows.
  //
  // `page` is clamped the way GET /api/audit clamps it — `Number('abc')` is NaN
  // and `?page=0`/`-1` is negative, and either reached Prisma as `skip` and threw.
  const rawPage = req.nextUrl.searchParams.get('page')
  const rawPageSize = req.nextUrl.searchParams.get('pageSize')
  const paginated = rawPage !== null || rawPageSize !== null

  const parsedPage = Number(rawPage ?? '1')
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1
  const parsedSize = Number(rawPageSize ?? '20')
  const pageSize =
    Number.isFinite(parsedSize) && parsedSize >= 1 ? Math.min(Math.floor(parsedSize), 100) : 20

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      // `items` is deliberately not included: the list page never renders line
      // items, and including them serialised the whole invoice_items table on
      // every filter change. Detail pages fetch their own items.
      include: {
        vendor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      // `id` breaks ties on createdAt. Without it the sort is not total — the
      // seed alone has 14 invoices sharing one created_at — and Postgres may
      // then repeat or skip rows across two skip/take pages. Applied
      // unconditionally: the order among ties was previously arbitrary, so
      // making it deterministic changes no contract.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(paginated ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
    paginated ? prisma.invoice.count({ where }) : Promise.resolve(0),
  ])

  if (!paginated) return NextResponse.json(invoices)

  // Metadata out-of-band so the body shape is untouched. Same-origin fetch, so
  // no Access-Control-Expose-Headers is needed.
  return NextResponse.json(invoices, {
    headers: {
      'X-Total-Count': String(total),
      'X-Page': String(page),
      'X-Page-Size': String(pageSize),
      'X-Total-Pages': String(Math.max(1, Math.ceil(total / pageSize))),
    },
  })
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
      // po_number is NOT NULL, and the upload wizard's draft row is created
      // before the document has been read. The schema only lets the PO be
      // omitted for a draft, and PATCH refuses to promote a draft still
      // carrying this marker — see validateReadyToGoLive.
      poNumber: data.poNumber ?? DRAFT_PO_PLACEHOLDER,
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
