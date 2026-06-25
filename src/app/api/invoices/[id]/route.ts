import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import { updateInvoiceSchema, isValidStatusTransition, validationErrorResponse } from '@/lib/validations'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      vendor: true,
      createdBy: { select: { id: true, name: true, role: true } },
      items: { orderBy: { sortOrder: 'asc' } },
      approvals: {
        include: { approver: { select: { id: true, name: true, role: true } } },
        orderBy: { step: 'asc' },
      },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // VENDOR can only access their own invoices
  if (session.user.role === 'VENDOR' && invoice.vendorId !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(invoice)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['FINANCE', 'ADMIN'])
  if (error || !session) return error

  const { id } = await params
  const body = await req.json()

  const parsed = updateInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }
  const data = parsed.data

  // Validate status transition if status is being changed
  if (data.status) {
    const current = await prisma.invoice.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const transition = isValidStatusTransition(current.status, data.status)
    if (!transition.valid) {
      return NextResponse.json({ error: transition.message }, { status: 400 })
    }
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      subtotal: data.subtotal,
      taxAmount: data.taxAmount,
      totalAmount: data.totalAmount,
      notes: data.notes,
      status: data.status,
      ocrConfidence: data.ocrConfidence,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      metadata: { fields: Object.keys(data) },
    },
  })

  return NextResponse.json(invoice)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const { id } = await params

  await prisma.invoice.update({ where: { id }, data: { status: 'REJECTED' } })
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.cancelled',
      entityType: 'invoice',
      entityId: id,
    },
  })

  return NextResponse.json({ ok: true })
}
