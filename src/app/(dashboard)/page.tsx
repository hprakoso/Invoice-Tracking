'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Search, FileText, DollarSign, AlertTriangle, Clock, Download } from 'lucide-react'
import { KPICard } from '@/components/dashboard/KPICard'
import { StatusDonut } from '@/components/dashboard/StatusDonut'
import { AgingBar } from '@/components/dashboard/AgingBar'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { formatIDR, formatDate } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'

interface DashboardData {
  totalInvoices: number
  totalPayable: number
  overdueCount: number
  openCount: number
  statusBreakdown: { status: string; count: number }[]
  agingBuckets: { label: string; amount: number }[]
  recentInvoices: {
    id: string
    invoiceNumber: string
    vendor?: { name: string }
    company?: { name: string } | null
    dueDate?: string
    totalAmount: string
    status: string
  }[]
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

export default function DashboardPage() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isVendor = role === 'VENDOR'
  const { t } = useI18n()

  const STATUSES = [
    { value: '', label: t.dashboard.allStatuses },
    { value: 'SUBMITTED', label: t.status.SUBMITTED },
    { value: 'PAID', label: t.status.PAID },
    { value: 'REVISION', label: t.status.REVISION },
    { value: 'CANCELLED', label: t.status.CANCELLED },
    { value: 'REJECTED', label: t.status.REJECTED },
    { value: 'VOID', label: t.status.VOID },
  ]

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')

  const buildParams = useCallback(() => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (!isVendor && vendorId) params.set('vendorId', vendorId)
    if (companyId) params.set('companyId', companyId)
    if (dueFrom) params.set('from', dueFrom)
    if (dueTo) params.set('to', dueTo)
    return params
  }, [search, status, isVendor, vendorId, companyId, dueFrom, dueTo])

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/dashboard?${buildParams()}`)
    setData(res.ok ? await res.json() : null)
    setLoading(false)
  }, [buildParams])

  useEffect(() => {
    if (!isVendor) {
      fetch('/api/vendors').then(r => r.json()).then((d: unknown) => setVendors(Array.isArray(d) ? d : []))
    }
    fetch('/api/companies').then(r => r.json()).then((d: unknown) => setCompanies(Array.isArray(d) ? d : []))
  }, [isVendor])

  useEffect(() => {
    const timer = setTimeout(fetchDashboard, 300)
    return () => clearTimeout(timer)
  }, [fetchDashboard])

  const AGING_LABELS: Record<string, string> = {
    '0–30 hari': t.dashboard.aging0_30,
    '31–60 hari': t.dashboard.aging31_60,
    '61–90 hari': t.dashboard.aging61_90,
    '> 90 hari': t.dashboard.aging90plus,
  }
  const translatedAgingBuckets = data?.agingBuckets.map((b) => ({ ...b, label: AGING_LABELS[b.label] ?? b.label }))

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.dashboard.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t.dashboard.subtitle}</p>
        </div>
        <a
          href={`/api/dashboard/export?${buildParams()}`}
          download
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md border text-sm font-medium text-gray-700 dark:text-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          <Download className="h-4 w-4" /> {t.dashboard.exportExcel}
        </a>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 sm:p-4 mb-6">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t.dashboard.searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {!isVendor && (
            <select
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t.dashboard.allVendors}</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <select
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t.dashboard.allCompanies}</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dueFrom}
              onChange={e => setDueFrom(e.target.value)}
              aria-label="Due date from"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="date"
              value={dueTo}
              onChange={e => setDueTo(e.target.value)}
              aria-label="Due date to"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {loading || !data ? <DashboardSkeleton /> : (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KPICard title={t.dashboard.totalInvoices} value={data.totalInvoices} icon={<FileText className="h-5 w-5" />} color="blue" />
            <KPICard title={t.dashboard.totalPayable} value={data.totalPayable} icon={<DollarSign className="h-5 w-5" />} color="green" format="currency" subtitle={t.dashboard.totalPayableSubtitle} />
            <KPICard title={t.dashboard.overdue} value={data.overdueCount} icon={<AlertTriangle className="h-5 w-5" />} color="red" subtitle={t.dashboard.overdueSubtitle} />
            <KPICard title={t.dashboard.openInvoices} value={data.openCount} icon={<Clock className="h-5 w-5" />} color="orange" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-4">{t.dashboard.invoiceStatus}</h3>
              <StatusDonut data={data.statusBreakdown} />
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-4">{t.dashboard.agingAnalysis}</h3>
              <AgingBar data={translatedAgingBuckets ?? []} />
            </div>
          </div>

          {/* Recent Invoices */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700">
            <div className="px-4 sm:px-5 py-4 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100">{t.dashboard.recentInvoices}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                    <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.dashboard.colInvoiceNo}</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.dashboard.colVendor}</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden md:table-cell">{t.dashboard.colCompany}</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden sm:table-cell">{t.dashboard.colDueDate}</th>
                    <th className="text-right px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.dashboard.colTotal}</th>
                    <th className="text-center px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.dashboard.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                        {t.dashboard.noInvoicesFound}
                      </td>
                    </tr>
                  ) : (
                    data.recentInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{inv.invoiceNumber}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{inv.vendor?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{inv.company?.name ?? '—'}</td>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
