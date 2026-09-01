import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import {
  updateInvoiceSchema,
  validateDeliveryDates,
  validationErrorResponse,
  isValidStatusTransition,
  TERMINAL_STATUSES,
} from '@/lib/validations'
import { sendEmail, renderEmailLayout } from '@/lib/services/email'
import { extraEmailsOf } from '@/lib/services/reminderScheduler'

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
      stageHistory: { orderBy: { changedAt: 'asc' } },
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
  'poNumber',
  'invoiceDate',
  'dueDate',
  'subtotal',
  'taxAmount',
  'totalAmount',
  'notes',
  'companyId',
] as const

// Fields each role may write via PATCH. ADMIN bypasses this for corrections.
// Status is a separate control from PIC stage, and both are ADMIN/GA-only —
// VENDOR edits its own invoice data (when not yet accepted) but never the
// status or stage.
function allowedFields(role: string, currentStatus: string, isOwner: boolean, isEditor: boolean): string[] {
  const editable = !(TERMINAL_STATUSES as readonly string[]).includes(currentStatus)
  switch (role) {
    case 'VENDOR':
      if (!isOwner) return []
      if (!editable) return []
      return [...CREATE_TIME_FIELDS, 'sendDate']
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

  // ADMIN bypasses the transition graph, same as it bypasses allowedFields above.
  if (filtered.status && role !== 'ADMIN' && !isValidStatusTransition(current.status, filtered.status)) {
    return NextResponse.json(
      { error: 'Invalid status transition', from: current.status, to: filtered.status },
      { status: 400 },
    )
  }

  const effectiveSendDate = filtered.sendDate ?? current.sendDate
  const effectiveDeliveredDate = filtered.deliveredDate ?? current.deliveredDate
  if (filtered.sendDate || filtered.deliveredDate) {
    const dateCheck = validateDeliveryDates(effectiveSendDate, effectiveDeliveredDate)
    if (!dateCheck.valid) {
      return NextResponse.json({ error: dateCheck.message }, { status: 400 })
    }
  }

  // Transitioning to PAID is when payment is recorded: paidById is
  // server-assigned (never client-supplied), paidDate/paidAmount default to
  // now/totalAmount. CLOSED (which always follows PAID) doesn't re-trigger
  // this — those fields are already set from the PAID transition.
  const markingAccepted = filtered.status === 'PAID'

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      invoiceNumber: filtered.invoiceNumber,
      poNumber: filtered.poNumber,
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
      paidDate: markingAccepted ? new Date(filtered.paidDate ?? Date.now()) : undefined,
      paidAmount: markingAccepted ? (filtered.paidAmount ?? current.totalAmount) : undefined,
      paidById: markingAccepted ? session.user.id : undefined,
    },
    include: { vendor: { select: { name: true } }, stageHistory: { orderBy: { changedAt: 'asc' } } },
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

  // Any GA/Admin-initiated status change tells the vendor what happened.
  if (filtered.status && filtered.status !== current.status) {
    await notifyStatusChanged(id, invoice.invoiceNumber, current.vendorId, filtered.status)
  }

  return NextResponse.json(invoice)
}

// STATUS_LABELS_ID mirrors the label set other pages hand-roll locally rather
// than importing src/lib/i18n — that module is for client components.
const STATUS_LABELS_ID: Record<string, string> = {
  RECEIVED: 'Invoice Diterima',
  REGISTERED: 'Terdaftar',
  DOC_VERIFICATION: 'Verifikasi Dokumen',
  FINANCE_VERIFICATION: 'Verifikasi Finance/SSU',
  READY_FOR_PAYMENT: 'Siap Dibayar',
  TREASURY_PROCESS: 'Proses Treasury',
  PAYMENT_SCHEDULED: 'Pembayaran Terjadwal',
  PAID: 'Sudah Dibayar',
  CLOSED: 'Selesai',
  DOC_INCOMPLETE: 'Dokumen Tidak Lengkap',
  RETURNED_TO_VENDOR: 'Dikembalikan ke Vendor',
  WAITING_USER_CONFIRMATION: 'Menunggu Konfirmasi User',
  WAITING_APPROVAL: 'Menunggu Approval',
  WAITING_TAX_DOCUMENT: 'Menunggu Faktur Pajak',
  REJECTED: 'Ditolak',
  PAYMENT_HOLD: 'Pembayaran Ditahan',
  VENDOR_BANK_ISSUE: 'Kendala Rekening Vendor',
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

// Admin-only hard delete — there is no CANCELLED status in the new
// verification-workflow enum, so soft-cancelling is no longer possible.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const { id } = await params

  await prisma.invoice.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.deleted',
      entityType: 'invoice',
      entityId: id,
    },
  })

  return NextResponse.json({ ok: true })
}
