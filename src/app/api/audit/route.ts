import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function GET(req: NextRequest) {
  const { error } = await requireRole(['ADMIN', 'GA_MANAGER'])
  if (error) return error

  const { searchParams } = req.nextUrl
  // Clamped rather than trusted: `parseInt('abc')` is NaN and `?page=0`/`-1`
  // is negative, and either reached Prisma as `skip` and threw an unhandled
  // validation error — a 500 on a hand-edited or stale URL. Same treatment the
  // amount filters already give junk input: ignore it and serve page 1.
  const parsedPage = Number(searchParams.get('page') ?? '1')
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1
  const limit = 20
  const skip = (page - 1) * limit
  const entityType = searchParams.get('entityType')
  const userId = searchParams.get('userId')

  const where: Prisma.AuditLogWhereInput = {}
  if (entityType) where.entityType = entityType
  if (userId) where.userId = userId

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ])

  return NextResponse.json({ logs, total, page, pages: Math.ceil(total / limit) })
}
