import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { FileText, DollarSign, AlertTriangle, Clock } from 'lucide-react'
import { KPICard } from '@/components/dashboard/KPICard'
import { StatusDonut } from '@/components/dashboard/StatusDonut'
import { AgingBar } from '@/components/dashboard/AgingBar'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'

async function getDashboardData() {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.toString()
  const res = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

import { formatIDR, formatDate } from '@/lib/format'

async function DashboardContent() {
  const data = await getDashboardData()

  if (!data) {
    return <p className="text-gray-500">Gagal memuat data dashboard.</p>
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard title="Total Invoice" value={data.totalInvoices} icon={<FileText className="h-5 w-5" />} color="blue" />
        <KPICard title="Total Tagihan" value={data.totalPayable} icon={<DollarSign className="h-5 w-5" />} color="green" format="currency" subtitle="Belum dibayar" />
        <KPICard title="Terlambat" value={data.overdueCount} icon={<AlertTriangle className="h-5 w-5" />} color="red" subtitle="Lewat jatuh tempo" />
        <KPICard title="Menunggu Approval" value={data.pendingApprovalCount} icon={<Clock className="h-5 w-5" />} color="orange" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Status Invoice</h3>
          <StatusDonut data={data.statusBreakdown} />
        </div>
        <div className="bg-white rounded-xl border p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Analisa Aging (Rp)</h3>
          <AgingBar data={data.agingBuckets} />
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white rounded-xl border">
        <div className="px-4 sm:px-5 py-4 border-b">
          <h3 className="text-sm font-semibold text-gray-700">Invoice Terbaru</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">No. Invoice</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium hidden sm:table-cell">Jatuh Tempo</th>
                <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Total</th>
                <th className="text-center px-4 py-3 text-xs text-gray-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentInvoices.map((inv: {
                id: string
                invoiceNumber: string
                vendor?: { name: string }
                dueDate?: string
                totalAmount: string
                status: string
              }) => (
                <tr key={inv.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-gray-700">{inv.vendor?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-700">
                    {formatIDR(Number(inv.totalAmount))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Ringkasan sistem invoice AP</p>
      </div>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
