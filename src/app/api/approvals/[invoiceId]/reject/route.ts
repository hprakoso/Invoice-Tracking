import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { error, session } = await requireRole(['GA_MANAGER', 'FINANCE', 'MANAGER', 'ADMIN'])
  if (error || !session) return error!

  const { invoiceId } = await params
  const body = await req.json().catch(() => ({}))
  const comment = body.comment ?? 'Ditolak.'
  const role = session.user.role
  const step = role === 'FINANCE' || role === 'MANAGER' ? 2 : 1

  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { invoiceId, step, status: 'PENDING' },
  })

  if (!workflow) {
    return NextResponse.json({ error: 'No pending approval step found' }, { status: 404 })
  }

  await prisma.approvalWorkflow.update({
    where: { id: workflow.id },
    data: {
      status: 'REJECTED',
      approverId: session.user.id,
      comment,
      actionedAt: new Date(),
    },
  })

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'REJECTED' as any },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: `invoice.rejected_step_${step}`,
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { step, comment },
    },
  })

  return NextResponse.json({ ok: true })
}
