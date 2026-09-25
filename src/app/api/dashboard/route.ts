import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, unlinkedVendorResponse, gaStaffCompanyScope } from '@/lib/auth/helpers'
import { getDashboardStats, buildDashboardFilter, applyKpiScope, parseKpiScope } from '@/lib/services/dashboardStats'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  // Matches GET /api/invoices: an unlinked vendor is rejected rather than
  // served an unscoped view of every vendor's data.
  const unlinked = unlinkedVendorResponse(session)
  if (unlinked) return unlinked

  const filter = buildDashboardFilter(req.nextUrl.searchParams, session, await gaStaffCompanyScope(session))
  // Which KPI card is selected, by its business predicate — see applyKpiScope.
  // `scoped` only ever narrows `filter`, so the VENDOR scoping inside it holds.
  const kpi = parseKpiScope(req.nextUrl.searchParams)
  const scoped = applyKpiScope(filter, kpi)

  const [stats, recentInvoices] = await Promise.all([
    getDashboardStats(filter, scoped),
    prisma.invoice.findMany({
      where: scoped,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } }, company: { select: { name: true } } },
    }),
  ])

  // `kpi` is echoed back so the client can tell an accepted value from one the
  // server ignored, rather than highlighting a card that had no effect.
  return NextResponse.json({ ...stats, recentInvoices, kpi })
}
