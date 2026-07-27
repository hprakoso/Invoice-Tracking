import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import { Prisma } from '@prisma/client'
import { createInvoiceSchema, validationErrorResponse } from '@/lib/validations'
import { sendEmail, renderEmailLayout } from '@/lib/services/email'
import { extraEmailsOf } from '@/lib/services/reminderScheduler'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // DRAFT invoices (upload wizard in progress, not yet submitted) never
  // appear in list views regardless of filter — they're not "real" yet.
  const where: Prisma.InvoiceWhereInput = { status: { not: 'DRAFT' } }
  if (status) where.status = status as Prisma.EnumInvoiceStatusFilter['equals']
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

  const invoice = await prisma.invoice.create({
    data: {
      vendorId: effectiveVendorId as string,
      companyId: data.companyId ?? null,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      currency: data.currency,
      subtotal: data.subtotal ?? null,
      taxAmount: data.taxAmount ?? null,
      totalAmount: data.totalAmount,
      notes: data.notes ?? null,
      // Created as DRAFT — the upload wizard fills in the rest and transitions
      // this to SUBMITTED itself via PATCH once the user actually confirms.
      // That's also where notifyInvoiceSubmitted now fires, not here.
      status: 'DRAFT',
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

// Called from PATCH /api/invoices/[id] when a VENDOR transitions DRAFT -> SUBMITTED
// (exported since the trigger now lives in the [id] route, not here).
export async function notifyInvoiceSubmitted(invoiceId: string, invoiceNumber: string, vendorName: string) {
  const setting = await prisma.reminderSetting.findUnique({ where: { type: 'invoice_submitted' } })
  if (!setting?.isActive || !(setting.inAppEnabled || setting.emailEnabled)) return

  const roles = Array.isArray(setting.recipientRoles) ? (setting.recipientRoles as string[]) : []
  if (roles.length === 0) return

  const recipients = await prisma.user.findMany({
    where: { role: { in: roles as never[] }, isActive: true },
    select: { id: true, email: true },
  })
  if (recipients.length === 0) return

  if (setting.emailEnabled) {
    const to = [...recipients.map((u) => u.email), ...extraEmailsOf(setting.extraEmails)]
    await sendEmail(
      to,
      `Invoice baru dari ${vendorName}`,
      renderEmailLayout({
        heading: `Invoice baru dari ${vendorName}`,
        bodyHtml: `<p style="margin:0;">Invoice <strong>${invoiceNumber}</strong> dari <strong>${vendorName}</strong> perlu diperiksa.</p>`,
        ctaText: 'Lihat Invoice',
        ctaPath: `/invoices/${invoiceId}`,
      }),
    )
  }

  if (!setting.inAppEnabled) return

  await prisma.notification.createMany({
    data: recipients.map((u) => ({
      userId: u.id,
      invoiceId,
      type: 'invoice_submitted',
      title: `Invoice baru dari ${vendorName}`,
      body: `Invoice ${invoiceNumber} perlu diperiksa.`,
    })),
  })
}
