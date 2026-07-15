import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { getDashboardStats } from '@/lib/services/dashboardStats'

export async function GET() {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  // VENDOR sees only their own invoice stats
  const vendorFilter = session.user.role === 'VENDOR'
    ? { vendorId: session.user.vendorId ?? undefined }
    : {}

  const [stats, recentInvoices] = await Promise.all([
    getDashboardStats(vendorFilter),
    prisma.invoice.findMany({
      where: vendorFilter,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({ ...stats, recentInvoices })
}
