import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import { Prisma } from '@prisma/client'

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
  const { error, session } = await requireRole(['FINANCE', 'ADMIN', 'VENDOR'])
  if (error || !session) return error

  const body = await req.json()

  // VENDOR can only submit invoices for their own vendor
  const effectiveVendorId =
    session.user.role === 'VENDOR' ? session.user.vendorId : body.vendorId
  if (session.user.role === 'VENDOR' && !effectiveVendorId) {
    return NextResponse.json({ error: 'Vendor account not linked' }, { status: 403 })
  }

  const invoice = await prisma.invoice.create({
    data: {
      vendorId: effectiveVendorId,
      invoiceNumber: body.invoiceNumber,
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      currency: body.currency ?? 'IDR',
      subtotal: body.subtotal,
      taxAmount: body.taxAmount,
      totalAmount: body.totalAmount,
      notes: body.notes,
      status: 'PENDING_REVIEW',
      createdById: session.user.id,
      items: {
        create: (body.items ?? []).map((item: any, i: number) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
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
