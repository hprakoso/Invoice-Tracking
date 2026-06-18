import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'

export async function GET() {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const now = new Date()

  // VENDOR sees only their own invoice stats
  const vendorFilter = session.user.role === 'VENDOR'
    ? { vendorId: session.user.vendorId ?? undefined }
    : {}

  const [
    totalInvoices,
    statusCounts,
    totalPayable,
    overdueCount,
    pendingApprovalCount,
    recentInvoices,
  ] = await Promise.all([
    prisma.invoice.count({ where: vendorFilter }),
    prisma.invoice.groupBy({ by: ['status'], _count: { id: true }, where: vendorFilter }),
    prisma.invoice.aggregate({
      where: { ...vendorFilter, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.count({
      where: {
        ...vendorFilter,
        dueDate: { lt: now },
        status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
      },
    }),
    prisma.invoice.count({ where: { ...vendorFilter, status: 'PENDING_APPROVAL' } }),
    prisma.invoice.findMany({
      where: vendorFilter,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } } },
    }),
  ])

  // Aging buckets
  const d30 = new Date(now.getTime() - 30 * 86400000)
  const d60 = new Date(now.getTime() - 60 * 86400000)
  const d90 = new Date(now.getTime() - 90 * 86400000)

  const agingBuckets = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...vendorFilter, dueDate: { gte: d30 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { ...vendorFilter, dueDate: { gte: d60, lt: d30 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { ...vendorFilter, dueDate: { gte: d90, lt: d60 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { ...vendorFilter, dueDate: { lt: d90 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
  ])

  return NextResponse.json({
    totalInvoices,
    totalPayable: Number(totalPayable._sum.totalAmount ?? 0),
    overdueCount,
    pendingApprovalCount,
    statusBreakdown: statusCounts.map(s => ({
      status: s.status,
      count: s._count.id,
    })),
    agingBuckets: [
      { label: '0–30 hari', amount: Number(agingBuckets[0]._sum.totalAmount ?? 0) },
      { label: '31–60 hari', amount: Number(agingBuckets[1]._sum.totalAmount ?? 0) },
      { label: '61–90 hari', amount: Number(agingBuckets[2]._sum.totalAmount ?? 0) },
      { label: '> 90 hari', amount: Number(agingBuckets[3]._sum.totalAmount ?? 0) },
    ],
    recentInvoices,
  })
}
