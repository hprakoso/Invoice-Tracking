import { prisma } from '@/lib/db/prisma'
import type { Prisma, InvoiceStatus } from '@prisma/client'

// Invoices still "in play" — everything else (CANCELLED/REJECTED/VOID) is terminal.
const OPEN_STATUSES: InvoiceStatus[] = ['SUBMITTED', 'REVISION']

export async function getDashboardStats(vendorFilter: Prisma.InvoiceWhereInput) {
  const now = new Date()
  // DRAFT invoices (upload wizard in progress) aren't "real" yet — excluded
  // from every dashboard figure, not just the open/overdue ones.
  const baseFilter: Prisma.InvoiceWhereInput = { ...vendorFilter, status: { not: 'DRAFT' } }
  const openFilter = { ...baseFilter, status: { in: OPEN_STATUSES } }

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
