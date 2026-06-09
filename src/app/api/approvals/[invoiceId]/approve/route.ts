import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { error, session } = await requireRole(['FINANCE', 'MANAGER', 'ADMIN'])
  if (error || !session) return error!

  const { invoiceId } = await params
  const body = await req.json().catch(() => ({}))
  const comment = body.comment ?? 'Disetujui.'
  const role = session.user.role
  const step = role === 'MANAGER' ? 2 : 1

  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { invoiceId, step, status: 'PENDING' },
  })

  if (!workflow) {
    return NextResponse.json({ error: 'No pending approval step found' }, { status: 404 })
  }

  await prisma.approvalWorkflow.update({
    where: { id: workflow.id },
    data: {
      status: 'APPROVED',
      approverId: session.user.id,
      comment,
      actionedAt: new Date(),
    },
  })

  // Determine next invoice status
  let nextInvoiceStatus: string
  if (step === 1) {
    // Finance approved → create step-2 workflow for Manager
    nextInvoiceStatus = 'PENDING_APPROVAL'
    await prisma.approvalWorkflow.create({
      data: {
        invoiceId,
        step: 2,
        status: 'PENDING',
      },
    })
    // Notify managers
    const managers = await prisma.user.findMany({ where: { role: 'MANAGER', isActive: true } })
    await prisma.notification.createMany({
      data: managers.map(m => ({
        userId: m.id,
        invoiceId,
        type: 'approval_required',
        title: 'Invoice menunggu persetujuan Anda',
        body: `Finance telah menyetujui. Harap tinjau dan setujui invoice ini.`,
      })),
    })
  } else {
    // Manager approved → fully approved
    nextInvoiceStatus = 'APPROVED'
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: nextInvoiceStatus as any },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: `invoice.approved_step_${step}`,
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { step, comment },
    },
  })

  return NextResponse.json({ ok: true, nextStatus: nextInvoiceStatus })
}
