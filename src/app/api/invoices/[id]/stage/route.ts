import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { updateInvoiceStageSchema, validationErrorResponse } from '@/lib/validations'
import { sendEmail, renderEmailLayout } from '@/lib/services/email'
import { extraEmailsOf } from '@/lib/services/reminderScheduler'
import type { PICStage } from '@prisma/client'

// PIC stage is an independent dimension from status — only ADMIN/GA_STAFF/
// GA_MANAGER may change it (vendors are read-only). Every change appends an
// InvoiceStageHistory row: the SLA source is the recorded timestamps.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF', 'GA_MANAGER'])
  if (error || !session) return error

  const { id } = await params
  const body = await req.json()

  const parsed = updateInvoiceStageSchema.safeParse(body)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }
  const stage: PICStage = parsed.data.stage

  const previous = await prisma.invoice.findUnique({ where: { id }, select: { picStage: true } })
  if (!previous) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      picStage: stage,
      stageHistory: {
        create: { stage, changedById: session.user.id },
      },
    },
    include: { stageHistory: { orderBy: { changedAt: 'asc' } } },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.stage_changed',
      entityType: 'invoice',
      entityId: id,
      metadata: { from: previous.picStage, to: stage },
    },
  })

  // Only a real move is worth notifying about — re-selecting the current
  // stage still appends history (an explicit "still here" record) but
  // shouldn't ping the team again.
  if (previous.picStage !== stage) {
    await notifyStageAssigned(id, invoice.invoiceNumber, stage)
  }

  return NextResponse.json(invoice)
}

const STAGE_LABELS_ID: Record<string, string> = {
  GA: 'GA',
  BUDGET: 'Budget',
  PROC_LEGAL: 'Procurement/Legal',
  SSU: 'SSU',
  TREASURY: 'Treasury',
}

// Same shape as notifyStatusChanged() in ../route.ts — inlined rather than
// extracted: two call sites with different recipient rules don't justify a
// shared abstraction yet, and merging them would mean parameterizing away
// the only interesting difference (who gets told).
//
// Recipients are the role group configured on the setting, NOT the invoice's
// vendor: pic_stage is internal routing (it's scrubbed from vendor-facing
// responses entirely), so telling a vendor their invoice moved to SSU would
// leak internal process detail they can't act on.
async function notifyStageAssigned(invoiceId: string, invoiceNumber: string, stage: string) {
  const setting = await prisma.reminderSetting.findUnique({ where: { type: 'stage_assigned' } })
  if (!setting?.isActive || !(setting.inAppEnabled || setting.emailEnabled)) return

  const roles = Array.isArray(setting.recipientRoles) ? (setting.recipientRoles as string[]) : []
  if (roles.length === 0) return

  const recipients = await prisma.user.findMany({
    where: { role: { in: roles as never[] }, isActive: true },
    select: { id: true, email: true },
  })
  if (recipients.length === 0) return

  const label = STAGE_LABELS_ID[stage] ?? stage
  const title = `Invoice ${invoiceNumber} masuk tahap ${label}`

  if (setting.emailEnabled) {
    await sendEmail(
      [...recipients.map((u) => u.email), ...extraEmailsOf(setting.extraEmails)],
      title,
      renderEmailLayout({
        heading: title,
        bodyHtml: `<p style="margin:0;">Invoice <strong>${invoiceNumber}</strong> kini berada di tahap <strong>${label}</strong> dan menunggu tindak lanjut.</p>`,
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
      type: 'stage_assigned',
      title,
      body: `Invoice berpindah ke tahap ${label}.`,
    })),
  })
}
