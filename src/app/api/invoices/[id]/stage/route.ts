import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { updateInvoiceStageSchema, validationErrorResponse } from '@/lib/validations'
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
      metadata: { stage },
    },
  })

  return NextResponse.json(invoice)
}
