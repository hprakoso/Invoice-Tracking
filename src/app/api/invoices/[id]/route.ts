import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import {
  updateInvoiceSchema,
  isValidStatusTransition,
  validateDeliveryDates,
  validationErrorResponse,
} from '@/lib/validations'

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
      pic: { select: { id: true, name: true, role: true } },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // VENDOR can only access their own invoices
  if (session.user.role === 'VENDOR' && invoice.vendorId !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(invoice)
}

const CREATE_TIME_FIELDS = [
  'invoiceNumber',
  'invoiceDate',
  'dueDate',
  'subtotal',
  'taxAmount',
  'totalAmount',
  'notes',
] as const

// Fields each role may write via PATCH, given the invoice's current status.
// ADMIN bypasses this (and the VALID_TRANSITIONS table) for corrections.
// isEditor: VENDOR owns the invoice's vendor, or GA_STAFF created it — either
// way, the field is still being finalized (SUBMITTED/REVISION) post-upload.
function allowedFields(role: string, currentStatus: string, isOwner: boolean, isEditor: boolean): string[] {
  const stillOpen = currentStatus === 'SUBMITTED' || currentStatus === 'REVISION'
  switch (role) {
    case 'VENDOR':
      if (!isOwner) return []
      if (!stillOpen) return ['sendDate']
      return currentStatus === 'REVISION'
        ? [...CREATE_TIME_FIELDS, 'sendDate', 'status']
        : [...CREATE_TIME_FIELDS, 'sendDate']
    case 'GA_STAFF':
      return isEditor && stillOpen
        ? [...CREATE_TIME_FIELDS, 'deliveredDate', 'picId', 'sendDate', 'status']
        : ['deliveredDate', 'picId', 'sendDate', 'status']
    case 'FINANCE':
      return currentStatus === 'REVISION'
        ? [...CREATE_TIME_FIELDS, 'ocrConfidence']
        : [...CREATE_TIME_FIELDS, 'ocrConfidence', 'status']
    default:
      return []
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params
  const body = await req.json()

  const parsed = updateInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }
  const { comment, ...data } = parsed.data

  const current = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true, sendDate: true, deliveredDate: true, vendorId: true, createdById: true },
  })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const role = session.user.role
  const isOwner = role === 'VENDOR' && current.vendorId === session.user.vendorId
  const isEditor = current.createdById === session.user.id
  const allowed = role === 'ADMIN' ? Object.keys(data) : allowedFields(role, current.status, isOwner, isEditor)
  const filtered = Object.fromEntries(
    Object.entries(data).filter(([key, value]) => allowed.includes(key) && value !== undefined),
  ) as typeof data

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (filtered.status && role !== 'ADMIN') {
    const transition = isValidStatusTransition(current.status, filtered.status)
    if (!transition.valid) {
      return NextResponse.json({ error: transition.message }, { status: 400 })
    }
  }

  const effectiveSendDate = filtered.sendDate ?? current.sendDate
  const effectiveDeliveredDate = filtered.deliveredDate ?? current.deliveredDate
  if (filtered.sendDate || filtered.deliveredDate) {
    const dateCheck = validateDeliveryDates(effectiveSendDate, effectiveDeliveredDate)
    if (!dateCheck.valid) {
      return NextResponse.json({ error: dateCheck.message }, { status: 400 })
    }
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      invoiceNumber: filtered.invoiceNumber,
      invoiceDate: filtered.invoiceDate ? new Date(filtered.invoiceDate) : undefined,
      dueDate: filtered.dueDate ? new Date(filtered.dueDate) : undefined,
      subtotal: filtered.subtotal,
      taxAmount: filtered.taxAmount,
      totalAmount: filtered.totalAmount,
      notes: filtered.notes,
      status: filtered.status,
      ocrConfidence: filtered.ocrConfidence,
      sendDate: filtered.sendDate ? new Date(filtered.sendDate) : undefined,
      deliveredDate: filtered.deliveredDate ? new Date(filtered.deliveredDate) : undefined,
      picId: filtered.picId,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: filtered.status ? 'invoice.status_changed' : 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      metadata: filtered.status
        ? { from: current.status, to: filtered.status, comment }
        : { fields: Object.keys(filtered) },
    },
  })

  return NextResponse.json(invoice)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const { id } = await params

  await prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' } })
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
