import { prisma } from '@/lib/db/prisma'
import type { Prisma, InvoiceStatus } from '@prisma/client'

// Settled/dead statuses — excluded from "open" KPI metrics (Total Payable,
// Overdue, Open Count, Aging). A REJECTED invoice isn't payable any more
// than a PAID/CLOSED one is, so it's excluded the same way.
export const NON_OPEN_STATUSES: InvoiceStatus[] = ['PAID', 'CLOSED', 'REJECTED']

// UTC month key — matches the codebase's ISO/UTC date handling elsewhere.
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

// Trailing `count` month keys (YYYY-MM) ascending, ending at the anchor's month.
function trailingMonthKeys(anchor: Date, count: number): string[] {
  const y = anchor.getUTCFullYear()
  const m = anchor.getUTCMonth()
  return Array.from({ length: count }, (_, i) => monthKey(new Date(Date.UTC(y, m - count + 1 + i, 1))))
}

// Shared by GET /api/dashboard and GET /api/dashboard/export so the KPI
// cards/charts/table and the Excel export always reflect the same filtered
// view. `session` only needs role + vendorId, kept loose so callers don't
// need to import the full NextAuth session type.
export function buildDashboardFilter(
  searchParams: URLSearchParams,
  session: { user: { role: string; vendorId?: string | null } },
): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {}

  // VENDOR is always scoped to their own invoices — never client-controlled.
  if (session.user.role === 'VENDOR') {
    where.vendorId = session.user.vendorId ?? undefined
  } else {
    const vendorId = searchParams.get('vendorId')
    if (vendorId) where.vendorId = vendorId
  }

  const search = searchParams.get('search')
  if (search) where.invoiceNumber = { contains: search, mode: 'insensitive' }

  const status = searchParams.get('status')
  if (status) where.status = status as Prisma.EnumInvoiceStatusFilter['equals']

  const companyId = searchParams.get('companyId')
  if (companyId) where.companyId = companyId

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (from || to) {
    where.dueDate = {}
    if (from) where.dueDate.gte = new Date(from)
    if (to) where.dueDate.lte = new Date(to)
  }

  return where
}

export async function getDashboardStats(filter: Prisma.InvoiceWhereInput) {
  const now = new Date()
  // "Open" metrics (Total Payable, Overdue, Open count, Aging) narrow to
  // non-accepted invoices only when the caller hasn't already picked a status —
  // once they have, those cards reflect that filtered view instead, same as
  // every other number on the dashboard.
  const openFilter: Prisma.InvoiceWhereInput = filter.status
    ? filter
    : { ...filter, status: { notIn: NON_OPEN_STATUSES } }

  const d30 = new Date(now.getTime() - 30 * 86400000)
  const d60 = new Date(now.getTime() - 60 * 86400000)
  const d90 = new Date(now.getTime() - 90 * 86400000)

  // Trailing-12-month window (UTC) for the monthly trend charts. The window
  // start is the first UTC day of the month 11 months back, so every month key
  // in the window can match a stored createdAt instant.
  const monthKeys = trailingMonthKeys(now, 12)
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))

  const [totalInvoices, statusCounts, totalPayable, overdueCount, openCount, agingBuckets, trendRows] =
    await Promise.all([
      prisma.invoice.count({ where: filter }),
      prisma.invoice.groupBy({ by: ['status'], _count: { id: true }, where: filter }),
      prisma.invoice.aggregate({ where: openFilter, _sum: { totalAmount: true } }),
      prisma.invoice.count({ where: { ...openFilter, dueDate: { lt: now } } }),
      prisma.invoice.count({ where: openFilter }),
      Promise.all([
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d30 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d60, lt: d30 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d90, lt: d60 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { lt: d90 } }, _sum: { totalAmount: true } }),
      ]),
      prisma.invoice.findMany({
        where: { ...filter, createdAt: { gte: windowStart } },
        select: { createdAt: true, status: true, totalAmount: true },
      }),
    ])

  const monthlyTrend = monthKeys.map((month) => ({ month, totalAmount: 0, count: 0 }))
  // Pipeline-health trend: of invoices created in month X, how many are
  // currently freshly-entered (RECEIVED) vs already paid (PAID) — a
  // snapshot proxy, not a true historical flow-rate. Collapsed to these 2
  // series (not all 17 statuses) since that's all the trend chart plots;
  // the full per-status breakdown lives in `statusBreakdown` below.
  const statusByMonth = monthKeys.map((month) => ({ month, entered: 0, accepted: 0 }))
  const trendIndex = new Map(monthKeys.map((month, i) => [month, i]))
  for (const inv of trendRows) {
    const i = trendIndex.get(monthKey(inv.createdAt))
    if (i === undefined) continue
    monthlyTrend[i].totalAmount += inv.totalAmount.toNumber()
    monthlyTrend[i].count += 1
    if (inv.status === 'RECEIVED') statusByMonth[i].entered += 1
    else if (inv.status === 'PAID') statusByMonth[i].accepted += 1
  }

  return {
    totalInvoices,
    totalPayable: Number(totalPayable._sum?.totalAmount ?? 0),
    overdueCount,
    openCount,
    statusBreakdown: statusCounts.map((s) => ({ status: s.status, count: s._count.id })),
    agingBuckets: [
      { label: '0–30 hari', amount: Number(agingBuckets[0]._sum?.totalAmount ?? 0) },
      { label: '31–60 hari', amount: Number(agingBuckets[1]._sum?.totalAmount ?? 0) },
      { label: '61–90 hari', amount: Number(agingBuckets[2]._sum?.totalAmount ?? 0) },
      { label: '> 90 hari', amount: Number(agingBuckets[3]._sum?.totalAmount ?? 0) },
    ],
    monthlyTrend,
    statusByMonth,
  }
}
