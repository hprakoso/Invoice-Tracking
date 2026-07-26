import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { getDashboardStats, buildDashboardFilter } from '@/lib/services/dashboardStats'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const filter = buildDashboardFilter(req.nextUrl.searchParams, session)

  const [stats, recentInvoices] = await Promise.all([
    getDashboardStats(filter),
    prisma.invoice.findMany({
      where: filter.status ? filter : { ...filter, status: { not: 'DRAFT' } },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } }, company: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({ ...stats, recentInvoices })
}
