import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import { Prisma } from '@prisma/client'
import { createInvoiceSchema, validationErrorResponse } from '@/lib/validations'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: Prisma.InvoiceWhereInput = {}
  if (status) where.status = status as any
  if (search) where.invoiceNumber = { contains: search, mode: 'insensitive' }
  if (from || to) {
    where.dueDate = {}
    if (from) where.dueDate.gte = new Date(from)
    if (to) where.dueDate.lte = new Date(to)
  }

  // VENDOR can only see their own invoices — server-enforced, never client-supplied
  if (session.user.role === 'VENDOR') {
    if (!session.user.vendorId) {
      return NextResponse.json({ error: 'Vendor account not linked' }, { status: 403 })
    }
    where.vendorId = session.user.vendorId
  } else {
    // Non-vendor users may filter by vendorId via query param
    const vendorId = searchParams.get('vendorId')
    if (vendorId) where.vendorId = vendorId
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(invoices)
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireRole(['FINANCE', 'ADMIN', 'VENDOR', 'GA_STAFF'])
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

  const invoice = await prisma.invoice.create({
    data: {
      vendorId: effectiveVendorId as string,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      currency: data.currency,
      subtotal: data.subtotal ?? null,
      taxAmount: data.taxAmount ?? null,
      totalAmount: data.totalAmount,
      notes: data.notes ?? null,
      status: 'SUBMITTED',
      sendDate: data.sendDate ? new Date(data.sendDate) : null,
      picId: effectivePicId,
      createdById: session.user.id,
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
