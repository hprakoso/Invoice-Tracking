import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { FileText, DollarSign, AlertTriangle, Clock, Download } from 'lucide-react'
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
    return <p className="text-gray-500 dark:text-gray-400">Failed to load dashboard data.</p>
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard title="Total Invoices" value={data.totalInvoices} icon={<FileText className="h-5 w-5" />} color="blue" />
        <KPICard title="Total Payable" value={data.totalPayable} icon={<DollarSign className="h-5 w-5" />} color="green" format="currency" subtitle="Unpaid" />
        <KPICard title="Overdue" value={data.overdueCount} icon={<AlertTriangle className="h-5 w-5" />} color="red" subtitle="Past due date" />
        <KPICard title="Open Invoices" value={data.openCount} icon={<Clock className="h-5 w-5" />} color="orange" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-4">Invoice Status</h3>
          <StatusDonut data={data.statusBreakdown} />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-4">Aging Analysis (Rp)</h3>
          <AgingBar data={data.agingBuckets} />
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700">
        <div className="px-4 sm:px-5 py-4 border-b dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100">Recent Invoices</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Invoice No.</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden sm:table-cell">Due Date</th>
                <th className="text-right px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Total</th>
                <th className="text-center px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Status</th>
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
                <tr key={inv.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{inv.vendor?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                    {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">
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
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">AP invoice system overview</p>
        </div>
        <a
          href="/api/dashboard/export"
          download
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md border text-sm font-medium text-gray-700 dark:text-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          <Download className="h-4 w-4" /> Export to Excel
        </a>
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
