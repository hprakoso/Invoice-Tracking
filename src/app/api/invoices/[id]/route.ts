import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import {
  updateInvoiceSchema,
  isValidStatusTransition,
  validateDeliveryDates,
  validationErrorResponse,
} from '@/lib/validations'
import { sendEmail, renderEmailLayout } from '@/lib/services/email'
import { extraEmailsOf } from '@/lib/services/reminderScheduler'
import { notifyInvoiceSubmitted } from '@/app/api/invoices/route'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      vendor: true,
      company: true,
      createdBy: { select: { id: true, name: true, role: true } },
      items: { orderBy: { sortOrder: 'asc' } },
      pic: { select: { id: true, name: true, role: true } },
      paidBy: { select: { id: true, name: true, role: true } },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // VENDOR can only access their own invoices
  if (session.user.role === 'VENDOR' && invoice.vendorId !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // PIC (GA Staff handling the hardcopy) is internal-only, not for vendors
  if (session.user.role === 'VENDOR') {
    return NextResponse.json({ ...invoice, pic: null })
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
  'companyId',
] as const

// Fields each role may write via PATCH, given the invoice's current status.
// ADMIN bypasses this (and the VALID_TRANSITIONS table) for corrections.
// isEditor: VENDOR owns the invoice's vendor, or GA_STAFF created it — either
// way, the field is still being finalized (SUBMITTED/REVISION) post-upload.
// paidDate/paidAmount are available to GA_STAFF/GA_MANAGER regardless of
// isEditor — marking an invoice paid isn't tied to who created it.
function allowedFields(role: string, currentStatus: string, isOwner: boolean, isEditor: boolean): string[] {
  const editable = currentStatus === 'DRAFT' || currentStatus === 'SUBMITTED' || currentStatus === 'REVISION'
  // DRAFT needs 'status' available too — that's how the wizard's final Submit
  // step transitions DRAFT -> SUBMITTED, same as REVISION -> SUBMITTED on resubmit.
  const needsStatusField = currentStatus === 'DRAFT' || currentStatus === 'REVISION'
  switch (role) {
    case 'VENDOR':
      if (!isOwner) return []
      if (!editable) return ['sendDate']
      return needsStatusField
        ? [...CREATE_TIME_FIELDS, 'sendDate', 'status']
        : [...CREATE_TIME_FIELDS, 'sendDate']
    case 'GA_STAFF':
    case 'GA_MANAGER':
      return isEditor && editable
        ? [...CREATE_TIME_FIELDS, 'deliveredDate', 'picId', 'sendDate', 'status', 'paidDate', 'paidAmount']
        : ['deliveredDate', 'picId', 'sendDate', 'status', 'paidDate', 'paidAmount']
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
    select: { status: true, sendDate: true, deliveredDate: true, vendorId: true, createdById: true, totalAmount: true },
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
    // Fixing & resubmitting a revision is the vendor's job, not GA_STAFF's
    if (current.status === 'REVISION' && filtered.status === 'SUBMITTED' && role !== 'VENDOR') {
      return NextResponse.json({ error: 'Only the vendor can resubmit a revision' }, { status: 403 })
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

  // Marking PAID: paidById is server-assigned (never client-supplied), and
  // paidDate/paidAmount default to now/totalAmount when the caller omits them.
  const markingPaid = filtered.status === 'PAID'

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
      companyId: filtered.companyId,
      status: filtered.status,
      ocrConfidence: filtered.ocrConfidence,
      sendDate: filtered.sendDate ? new Date(filtered.sendDate) : undefined,
      deliveredDate: filtered.deliveredDate ? new Date(filtered.deliveredDate) : undefined,
      picId: filtered.picId,
      paidDate: markingPaid ? new Date(filtered.paidDate ?? Date.now()) : undefined,
      paidAmount: markingPaid ? (filtered.paidAmount ?? current.totalAmount) : undefined,
      paidById: markingPaid ? session.user.id : undefined,
    },
    include: { vendor: { select: { name: true } } },
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

  if (filtered.status === 'REVISION') {
    await notifyRevisionRequested(id, invoice.invoiceNumber, current.vendorId)
  }

  // Fires the same "new invoice" notification the old flow sent at creation
  // time — moved here since invoices are now created as DRAFT and only
  // become real (SUBMITTED) once the wizard's final step confirms them.
  if (current.status === 'DRAFT' && filtered.status === 'SUBMITTED' && role === 'VENDOR') {
    await notifyInvoiceSubmitted(id, invoice.invoiceNumber, invoice.vendor.name)
  }

  // Any GA/Admin-initiated status change other than REVISION (its own richer
  // notification above) tells the vendor what happened to their invoice.
  if (
    filtered.status &&
    filtered.status !== current.status &&
    filtered.status !== 'REVISION' &&
    ['PAID', 'CANCELLED', 'REJECTED', 'VOID'].includes(filtered.status)
  ) {
    await notifyStatusChanged(id, invoice.invoiceNumber, current.vendorId, filtered.status)
  }

  return NextResponse.json(invoice)
}

// Recipient is always the invoice's own vendor — not configurable via
// ReminderSetting.recipientRoles, unlike due_soon/overdue/invoice_submitted.
async function notifyRevisionRequested(invoiceId: string, invoiceNumber: string, vendorId: string) {
  const setting = await prisma.reminderSetting.findUnique({ where: { type: 'revision_requested' } })
  if (!setting?.isActive || !(setting.inAppEnabled || setting.emailEnabled)) return

  const vendorUsers = await prisma.user.findMany({
    where: { vendorId, role: 'VENDOR', isActive: true },
    select: { id: true, email: true },
  })
  if (vendorUsers.length === 0) return

  if (setting.emailEnabled) {
    const to = [...vendorUsers.map((u) => u.email), ...extraEmailsOf(setting.extraEmails)]
    await sendEmail(
      to,
      `Invoice ${invoiceNumber} perlu direvisi`,
      renderEmailLayout({
        heading: `Invoice ${invoiceNumber} perlu direvisi`,
        bodyHtml: `<p style="margin:0;">Invoice <strong>${invoiceNumber}</strong> perlu diperbaiki. Silakan perbaiki dan ajukan ulang invoice ini.</p>`,
        ctaText: 'Perbaiki Invoice',
        ctaPath: `/invoices/${invoiceId}`,
      }),
    )
  }

  if (!setting.inAppEnabled) return

  await prisma.notification.createMany({
    data: vendorUsers.map((u) => ({
      userId: u.id,
      invoiceId,
      type: 'revision_requested',
      title: `Invoice ${invoiceNumber} perlu direvisi`,
      body: `Silakan perbaiki dan ajukan ulang invoice ini.`,
    })),
  })
}

// STATUS_LABELS_ID mirrors the label set every other page in the app already
// hand-rolls locally (see invoices/[id]/page.tsx) rather than importing
// src/lib/i18n — that module is written for client components and pulling it
// into a server route isn't worth it for 4 strings.
const STATUS_LABELS_ID: Record<string, string> = {
  PAID: 'Lunas',
  CANCELLED: 'Dibatalkan',
  REJECTED: 'Ditolak',
  VOID: 'Void',
}

async function notifyStatusChanged(invoiceId: string, invoiceNumber: string, vendorId: string, status: string) {
  const setting = await prisma.reminderSetting.findUnique({ where: { type: 'status_changed' } })
  if (!setting?.isActive || !(setting.inAppEnabled || setting.emailEnabled)) return

  const vendorUsers = await prisma.user.findMany({
    where: { vendorId, role: 'VENDOR', isActive: true },
    select: { id: true, email: true },
  })
  if (vendorUsers.length === 0) return

  const label = STATUS_LABELS_ID[status] ?? status
  const title = `Invoice ${invoiceNumber}: ${label}`

  if (setting.emailEnabled) {
    const to = [...vendorUsers.map((u) => u.email), ...extraEmailsOf(setting.extraEmails)]
    await sendEmail(
      to,
      title,
      renderEmailLayout({
        heading: title,
        bodyHtml: `<p style="margin:0;">Status invoice <strong>${invoiceNumber}</strong> telah diubah menjadi <strong>${label}</strong>.</p>`,
        ctaText: 'Lihat Invoice',
        ctaPath: `/invoices/${invoiceId}`,
      }),
    )
  }

  if (!setting.inAppEnabled) return

  await prisma.notification.createMany({
    data: vendorUsers.map((u) => ({
      userId: u.id,
      invoiceId,
      type: 'status_changed',
      title,
      body: `Status invoice diubah menjadi ${label}.`,
    })),
  })
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
