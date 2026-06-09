import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function GET() {
  const { error, session } = await requireRole(['FINANCE', 'MANAGER', 'ADMIN'])
  if (error || !session) return error!

  const role = session.user.role

  // Finance → step 1, Manager → step 2, Admin → all pending steps
  const stepFilter =
    role === 'MANAGER' ? { step: 2 } :
    role === 'FINANCE' ? { step: 1 } :
    {}  // ADMIN sees every pending step

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
