import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, unlinkedVendorResponse } from '@/lib/auth/helpers'
import { getDashboardStats, buildDashboardFilter } from '@/lib/services/dashboardStats'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  // Matches GET /api/invoices: an unlinked vendor is rejected rather than
  // served an unscoped view of every vendor's data.
  const unlinked = unlinkedVendorResponse(session)
  if (unlinked) return unlinked

  const filter = buildDashboardFilter(req.nextUrl.searchParams, session)

  const [stats, recentInvoices] = await Promise.all([
    getDashboardStats(filter),
    prisma.invoice.findMany({
      where: filter,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } }, company: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({ ...stats, recentInvoices })
}
