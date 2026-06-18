import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'

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

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      invoiceNumber: body.invoiceNumber,
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      subtotal: body.subtotal,
      taxAmount: body.taxAmount,
      totalAmount: body.totalAmount,
      notes: body.notes,
      status: body.status,
      ocrConfidence: body.ocrConfidence,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    },
  })

  return NextResponse.json(invoice)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const { id } = await params

  await prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' as any } })
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
