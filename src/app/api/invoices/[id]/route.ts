import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import {
  updateInvoiceSchema,
  validateDeliveryDates,
  validateInvoiceDates,
  validationErrorResponse,
  isValidStatusTransition,
  TERMINAL_STATUSES,
} from '@/lib/validations'
import { canVendorEdit, NON_OPEN_STATUSES } from '@/lib/invoiceStatus'
import { jakartaDayStart } from '@/lib/format'
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
      documents: { orderBy: { createdAt: 'asc' } },
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
  // Set at creation by the upload wizard and cleared when the user confirms
  // the review step — whoever may edit the invoice's data may promote it.
  'isDraft',
] as const

// Fields each role may write via PATCH. ADMIN bypasses this for corrections.
// Status is a separate control from PIC stage, and both are ADMIN/GA-only —
// VENDOR edits its own invoice data (when not yet accepted) but never the
// status or stage.
function allowedFields(role: string, currentStatus: string, isOwner: boolean, isEditor: boolean): string[] {
  const editable = !(TERMINAL_STATUSES as readonly string[]).includes(currentStatus)
  switch (role) {
    case 'VENDOR': {
      if (!isOwner) return []
      // A vendor may only correct its own figures while the ball is still in
      // its court. The old rule was merely "not CLOSED/REJECTED", which left a
      // vendor able to rewrite invoiceNumber, totalAmount and dueDate on an
      // invoice finance had already verified and treasury had scheduled — or
      // one already marked PAID — so the approved amount and the stored one
      // could silently diverge.
      if (!canVendorEdit(currentStatus)) return []
      return [...CREATE_TIME_FIELDS, 'sendDate']
    }
    case 'GA_STAFF':
    case 'GA_MANAGER':
      // `editable` gates both branches now. The fallback used to ignore it, so
      // GA could still mutate deliveredDate/picId/sendDate on a CLOSED or
      // REJECTED invoice that every other rule treats as immutable.
      if (!editable) return []
      return isEditor
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
    select: {
      status: true, sendDate: true, deliveredDate: true, vendorId: true,
      createdById: true, totalAmount: true, invoiceNumber: true, notes: true,
      invoiceDate: true, dueDate: true,
    },
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

  // The schema catches a payload carrying both dates; this catches the case it
  // can't see — one date sent against the other already stored. Without it, a
  // PATCH of dueDate alone could still land before the stored invoice date,
  // which is the shape that produced the impossible rows in the first place.
  if (filtered.invoiceDate || filtered.dueDate) {
    const orderCheck = validateInvoiceDates(
      filtered.invoiceDate ?? current.invoiceDate,
      filtered.dueDate ?? current.dueDate,
    )
    if (!orderCheck.valid) {
      return NextResponse.json({ error: orderCheck.message }, { status: 400 })
    }
  }

  // Duplicate check — the invoice number is only really known once the user
  // has reviewed OCR output, so this is the first point it can run (not at
  // POST, where it's still a `DRAFT-<timestamp>` placeholder). A failed
  // upload retried against the same row never reaches here, so retrying is
  // never mistaken for a duplicate.
  //
  // Match key is vendor + invoiceNumber (case-insensitive), ignoring already
  // rejected rows. Deliberately NOT scoped by company: one vendor reusing an
  // invoice number across different bill-to companies still counts.
  let duplicateOf: { id: string; invoiceNumber: string } | null = null
  if (filtered.invoiceNumber && filtered.invoiceNumber !== current.invoiceNumber) {
    duplicateOf = await prisma.invoice.findFirst({
      where: {
        id: { not: id },
        vendorId: current.vendorId,
        invoiceNumber: { equals: filtered.invoiceNumber, mode: 'insensitive' },
        status: { not: 'REJECTED' },
      },
      select: { id: true, invoiceNumber: true },
    })
  }

  // Auto-rejection is still a status transition and must obey the graph. It
  // used to be written straight into the update, so PATCHing the invoiceNumber
  // of an already-PAID invoice into a collision forced it to REJECTED — a
  // transition PAID does not have (its only edge is CLOSED) — and left
  // paidDate/paidAmount/paidById sitting on a rejected row.
  if (duplicateOf && role !== 'ADMIN' && !isValidStatusTransition(current.status, 'REJECTED')) {
    return NextResponse.json(
      {
        error: 'Duplicate invoice number, but this invoice can no longer be rejected',
        from: current.status,
        duplicateOf,
      },
      { status: 409 },
    )
  }

  // Recording a payment happens on the transition INTO PaID — not on a
  // PAID -> PAID self-transition, which isValidStatusTransition allows and
  // which used to re-run this block: paidDate reset to today, a partial
  // paidAmount re-defaulted to the full total, and paidById reassigned to
  // whoever sent the second request.
  const isBecomingPaid = !duplicateOf && filtered.status === 'PAID' && current.status !== 'PAID'

  if (isBecomingPaid) {
    // Partial payments are rejected outright: PAID is excluded from every
    // payable KPI, so an invoice settled for less than its total silently
    // dropped the remainder out of Total Payable, Overdue and aging, and
    // nothing anywhere computed the outstanding balance.
    const paidAmount = filtered.paidAmount ?? Number(current.totalAmount)
    if (Math.abs(paidAmount - Number(current.totalAmount)) > 1) {
      return NextResponse.json(
        {
          error: 'paidAmount must equal the invoice total',
          paidAmount,
          totalAmount: Number(current.totalAmount),
        },
        { status: 400 },
      )
    }
  }

  // Moving off PAID (an ADMIN correction — ADMIN bypasses the transition
  // graph) clears the payment record. Without this the invoice kept rendering
  // its Payment panel, and geminiChat's unfiltered sumPaidAmount kept counting
  // money that was no longer considered paid.
  const leavingPaid =
    !duplicateOf &&
    !!filtered.status &&
    current.status === 'PAID' &&
    !(NON_OPEN_STATUSES as readonly string[]).includes(filtered.status)

  // A duplicate is auto-rejected rather than blocked: the row is still saved
  // (so it isn't stranded with a placeholder number and no way back to it),
  // but forced to REJECTED regardless of the status the caller asked for.
  const applyUpdate = (dup: typeof duplicateOf) =>
    prisma.invoice.update({
      where: { id },
      data: {
        invoiceNumber: filtered.invoiceNumber,
        poNumber: filtered.poNumber,
        invoiceDate: filtered.invoiceDate ? new Date(filtered.invoiceDate) : undefined,
        dueDate: filtered.dueDate ? new Date(filtered.dueDate) : undefined,
        subtotal: filtered.subtotal,
        taxAmount: filtered.taxAmount,
        totalAmount: filtered.totalAmount,
        notes: dup
          ? [filtered.notes ?? current.notes, `Auto-rejected: duplikat dari invoice ${dup.invoiceNumber} (id ${dup.id})`]
              .filter(Boolean)
              .join('\n')
          : filtered.notes,
        companyId: filtered.companyId,
        isDraft: filtered.isDraft,
        // `currency` was missing entirely, so a bad value written by the old
        // unvalidated OCR path could never be corrected through the API.
        currency: filtered.currency,
        status: dup ? 'REJECTED' : filtered.status,
        ocrConfidence: filtered.ocrConfidence,
        sendDate: filtered.sendDate ? new Date(filtered.sendDate) : undefined,
        deliveredDate: filtered.deliveredDate ? new Date(filtered.deliveredDate) : undefined,
        picId: filtered.picId,
        // Transitioning INTO PAID is when payment is recorded: paidById is
        // server-assigned (never client-supplied), paidDate/paidAmount default
        // to today/totalAmount. CLOSED (which always follows PAID) doesn't
        // re-trigger this — already set from the PAID transition.
        ...(isBecomingPaid
          ? {
              paidDate: new Date(filtered.paidDate ?? jakartaDayStart()),
              paidAmount: filtered.paidAmount ?? current.totalAmount,
              paidById: session.user.id,
            }
          : {}),
        // Correcting a payment record without re-running the transition:
        // paidDate/paidAmount were only ever written inside the block above, so
        // a PATCH carrying them alone returned 200 while persisting nothing —
        // and wrote an audit row claiming they had changed.
        ...(!dup && !isBecomingPaid && !leavingPaid
          ? {
              paidDate: filtered.paidDate ? new Date(filtered.paidDate) : undefined,
              paidAmount: filtered.paidAmount ?? undefined,
            }
          : {}),
        // Leaving PAID clears the record rather than leaving a paid-looking
        // invoice behind.
        ...(leavingPaid ? { paidDate: null, paidAmount: null, paidById: null } : {}),
      },
      include: { vendor: { select: { name: true } }, stageHistory: { orderBy: { changedAt: 'asc' } } },
    })

  let invoice
  try {
    invoice = await applyUpdate(duplicateOf)
  } catch (e) {
    // The findFirst above and this write aren't atomic — a concurrent
    // submission can claim the same number in between. The partial unique
    // index (migration 20260902000000_invoice_duplicate_guard) turns that
    // race into a P2002 here, which lands in the same auto-reject path.
    const isDuplicateKey =
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      !duplicateOf
    if (!isDuplicateKey) throw e

    duplicateOf =
      (await prisma.invoice.findFirst({
        where: {
          id: { not: id },
          vendorId: current.vendorId,
          invoiceNumber: { equals: filtered.invoiceNumber!, mode: 'insensitive' },
          status: { not: 'REJECTED' },
        },
        select: { id: true, invoiceNumber: true },
      })) ?? { id: 'unknown', invoiceNumber: filtered.invoiceNumber! }
    invoice = await applyUpdate(duplicateOf)
  }

  const effectiveStatus = duplicateOf ? 'REJECTED' : filtered.status

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: duplicateOf
        ? 'invoice.auto_rejected'
        : filtered.status
          ? 'invoice.status_changed'
          : 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      metadata: duplicateOf
        ? { from: current.status, to: 'REJECTED', reason: 'duplicate', duplicateOfId: duplicateOf.id, duplicateOfNumber: duplicateOf.invoiceNumber }
        : filtered.status
          ? { from: current.status, to: filtered.status, comment }
          : { fields: Object.keys(filtered) },
    },
  })

  // Any GA/Admin-initiated status change tells the vendor what happened —
  // including an auto-rejection, which the vendor needs to know about most.
  if (effectiveStatus && effectiveStatus !== current.status) {
    await notifyStatusChanged(id, invoice.invoiceNumber, current.vendorId, effectiveStatus)
  }

  // `duplicateOf` is Not Stored on the invoice — it's surfaced here (and in
  // the audit log above) so the client can explain *why* this came back
  // rejected instead of showing a generic success toast.
  return NextResponse.json(duplicateOf ? { ...invoice, duplicateOf } : invoice)
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
