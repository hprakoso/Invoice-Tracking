import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function GET() {
  const { error, session } = await requireRole(['FINANCE', 'MANAGER', 'ADMIN'])
  if (error || !session) return error!

  const role = session.user.role

  // Finance sees step-1 pending, Manager sees step-2 pending
  const step = role === 'MANAGER' ? 2 : 1

  const pending = await prisma.approvalWorkflow.findMany({
    where: {
      step,
      status: 'PENDING',
    },
    include: {
      invoice: {
        include: {
          vendor: { select: { name: true } },
          items: { orderBy: { sortOrder: 'asc' } },
        },
      },
      approver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(pending)
}
