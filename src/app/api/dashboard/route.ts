import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'

export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  const now = new Date()

  const [
    totalInvoices,
    statusCounts,
    totalPayable,
    overdueCount,
    pendingApprovalCount,
    recentInvoices,
  ] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.invoice.aggregate({
      where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.count({
      where: {
        dueDate: { lt: now },
        status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
      },
    }),
    prisma.invoice.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.invoice.findMany({
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
      where: { dueDate: { gte: d30 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { dueDate: { gte: d60, lt: d30 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { dueDate: { gte: d90, lt: d60 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { dueDate: { lt: d90 }, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
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
