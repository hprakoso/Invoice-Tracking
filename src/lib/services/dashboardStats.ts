import { prisma } from '@/lib/db/prisma'
import type { Prisma, InvoiceStatus } from '@prisma/client'

// Invoices still "in play" — everything else (CANCELLED/REJECTED/VOID) is terminal.
const OPEN_STATUSES: InvoiceStatus[] = ['SUBMITTED', 'REVISION']

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
  // DRAFT invoices (upload wizard in progress) aren't "real" yet — excluded
  // from every dashboard figure, unless the caller already narrowed to a
  // specific status (which inherently excludes DRAFT already, or — in the
  // unexposed case of explicitly filtering to DRAFT itself — means it).
  const baseFilter: Prisma.InvoiceWhereInput = filter.status
    ? filter
    : { ...filter, status: { not: 'DRAFT' } }
  // "Open" metrics (Total Payable, Overdue, Open count, Aging) narrow to
  // SUBMITTED/REVISION only when the caller hasn't already picked a status —
  // once they have, those cards reflect that filtered view instead, same as
  // every other number on the dashboard.
  const openFilter: Prisma.InvoiceWhereInput = filter.status
    ? baseFilter
    : { ...baseFilter, status: { in: OPEN_STATUSES } }

  const d30 = new Date(now.getTime() - 30 * 86400000)
  const d60 = new Date(now.getTime() - 60 * 86400000)
  const d90 = new Date(now.getTime() - 90 * 86400000)

  const [totalInvoices, statusCounts, totalPayable, overdueCount, openCount, agingBuckets] =
    await Promise.all([
      prisma.invoice.count({ where: baseFilter }),
      prisma.invoice.groupBy({ by: ['status'], _count: { id: true }, where: baseFilter }),
      prisma.invoice.aggregate({ where: openFilter, _sum: { totalAmount: true } }),
      prisma.invoice.count({ where: { ...openFilter, dueDate: { lt: now } } }),
      prisma.invoice.count({ where: openFilter }),
      Promise.all([
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d30 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d60, lt: d30 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d90, lt: d60 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { lt: d90 } }, _sum: { totalAmount: true } }),
      ]),
    ])

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
  }
}
