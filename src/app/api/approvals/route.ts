import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function GET() {
  const { error, session } = await requireRole(['GA_STAFF', 'GA_MANAGER', 'FINANCE', 'MANAGER', 'ADMIN'])
  if (error || !session) return error!

  const role = session.user.role

  // GA_MANAGER → step 1, FINANCE → step 2, GA_STAFF/ADMIN → all pending steps
  const stepFilter =
    role === 'GA_MANAGER' ? { step: 1 } :
    role === 'FINANCE' ? { step: 2 } :
    role === 'MANAGER' ? { step: 2 } :
    {}  // GA_STAFF and ADMIN see every pending step

  const pending = await prisma.approvalWorkflow.findMany({
    where: {
      ...stepFilter,
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
