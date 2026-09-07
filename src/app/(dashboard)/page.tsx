'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Search, Download, Inbox } from 'lucide-react'
import { KPICard } from '@/components/dashboard/KPICard'
import { MonthlyTrendChart } from '@/components/dashboard/MonthlyTrendChart'
import { StatusFlowChart } from '@/components/dashboard/StatusFlowChart'
import { AgingList } from '@/components/dashboard/AgingList'
import { StageLeadTimeList, type StageLeadTime } from '@/components/dashboard/StageLeadTimeList'
import { CompanyList, type CompanyBreakdownItem } from '@/components/dashboard/CompanyList'
import { ChartEmpty } from '@/components/dashboard/ChartEmpty'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { formatIDR, formatDate } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'

// Hairline dividers between KPI strip cells — mobile 2×2 grid, desktop 1×4.
// Odd cells are the left column (no left border), cells 1–2 are the top row (no top border).
const KPI_CELL =
  'border-t border-l border-border/60 max-lg:[&:nth-child(-n+2)]:border-t-0 max-lg:[&:nth-child(odd)]:border-l-0 lg:first:border-l-0'

interface DashboardData {  totalInvoices: number
  totalPayable: number
  overdueCount: number
  openCount: number
  statusBreakdown: { status: string; count: number }[]
  agingBuckets: { label: string; amount: number; overdue: boolean }[]
  monthlyTrend: { month: string; totalAmount: number; count: number }[]
  statusByMonth: { month: string; entered: number; accepted: number }[]
  stageLeadTimes: StageLeadTime[]
  companyBreakdown: CompanyBreakdownItem[]
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

function DashboardSkeleton({ ariaLabel }: { ariaLabel: string }) {
  return (
    <div className="space-y-5 sm:space-y-6" aria-busy="true" aria-label={ariaLabel}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <Skeleton className="h-56 rounded-2xl" />
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
    ...Object.entries(t.status).map(([value, label]) => ({ value, label })),
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
    'Belum jatuh tempo': t.dashboard.agingNotDue,
    '0–30 hari': t.dashboard.aging0_30,
    '31–60 hari': t.dashboard.aging31_60,
    '61–90 hari': t.dashboard.aging61_90,
    '> 90 hari': t.dashboard.aging90plus,
    'Tanpa jatuh tempo': t.dashboard.agingNoDueDate,
  }
  const translatedAgingBuckets = data?.agingBuckets.map((b) => ({ ...b, label: AGING_LABELS[b.label] ?? b.label }))

  const trendTotal = data?.monthlyTrend.reduce((sum, p) => sum + p.totalAmount, 0) ?? 0
  const trendCount = data?.monthlyTrend.reduce((sum, p) => sum + p.count, 0) ?? 0

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t.dashboard.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.subtitle}</p>
        </div>
        <a
          href={`/api/dashboard/export?${buildParams()}`}
          download
          className="glass-panel-strong inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition hover:brightness-105"
        >
          <Download className="h-4 w-4" /> {t.dashboard.exportExcel}
        </a>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel mb-6 rounded-2xl p-3 sm:p-4">
        <div className="flex flex-col flex-wrap gap-2 sm:flex-row sm:gap-3">
          <div className="relative min-w-[160px] flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {!isVendor && (
            <select
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">{t.dashboard.allVendors}</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <select
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">{t.dashboard.allCompanies}</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dueFrom}
              onChange={e => setDueFrom(e.target.value)}
              aria-label={t.dashboard.filterDueFrom}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <span className="text-sm text-muted-foreground">–</span>
            <input
              type="date"
              value={dueTo}
              onChange={e => setDueTo(e.target.value)}
              aria-label={t.dashboard.filterDueTo}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {loading || !data ? <DashboardSkeleton ariaLabel={t.dashboard.loadingAria} /> : (
        <div className="space-y-5 sm:space-y-6">
          {/* KPI summary — single glass strip, hairline-divided cells */}
          <section className="glass-panel overflow-hidden rounded-2xl" aria-label={t.dashboard.subtitle}>
            <div className="grid grid-cols-2 lg:grid-cols-4">
              <KPICard className={KPI_CELL} title={t.dashboard.totalInvoices} value={data.totalInvoices} />
              <KPICard className={KPI_CELL} title={t.dashboard.totalPayable} value={data.totalPayable} format="currency" subtitle={t.dashboard.totalPayableSubtitle} />
              <KPICard className={KPI_CELL} title={t.dashboard.overdue} value={data.overdueCount} tone="danger" subtitle={t.dashboard.overdueSubtitle} />
              <KPICard className={KPI_CELL} title={t.dashboard.openInvoices} value={data.openCount} />
            </div>
          </section>

          {/* Hero — monthly trend */}
          <section className="glass-panel rounded-2xl p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t.dashboard.monthlyTrendTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.dashboard.monthlyTrendSubtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
                  {t.dashboard.monthlyTrendCount.replace('{count}', String(trendCount))}
                </span>
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs font-medium tabular-nums text-foreground">
                  {formatIDR(trendTotal)}
                </span>
              </div>
            </div>
            <MonthlyTrendChart data={data.monthlyTrend ?? []} />
          </section>

          {/* Verification flow + aging */}
          <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
            <section className="glass-panel rounded-2xl p-4 sm:p-6">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t.dashboard.statusFlowTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.dashboard.statusFlowSubtitle}</p>
              </div>
              <StatusFlowChart data={data.statusByMonth ?? []} breakdown={data.statusBreakdown ?? []} />
            </section>
            <section className="glass-panel rounded-2xl p-4 sm:p-6">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t.dashboard.agingTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.dashboard.agingSubtitle}</p>
              </div>
              <AgingList data={translatedAgingBuckets ?? []} openCount={data.openCount} />
            </section>
          </div>

          {/* Per-stage lead time + per-company totals */}
          <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
            <section className="glass-panel rounded-2xl p-4 sm:p-6">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t.dashboard.stageLeadTimeTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.dashboard.stageLeadTimeSubtitle}</p>
              </div>
              <StageLeadTimeList data={data.stageLeadTimes ?? []} />
            </section>
            <section className="glass-panel rounded-2xl p-4 sm:p-6">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">{t.dashboard.byCompanyTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.dashboard.byCompanySubtitle}</p>
              </div>
              <CompanyList data={data.companyBreakdown ?? []} />
            </section>
          </div>

          {/* Recent Invoices */}
          <section className="glass-panel overflow-hidden rounded-2xl">
            <div className="border-b border-border/60 px-4 py-4 sm:px-5">
              <h3 className="text-sm font-semibold text-foreground">{t.dashboard.recentInvoices}</h3>
            </div>
            <div className="liquid-scrollbar overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-black/[0.02] dark:bg-white/[0.03]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{t.dashboard.colInvoiceNo}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{t.dashboard.colVendor}</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">{t.dashboard.colCompany}</th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">{t.dashboard.colDueDate}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{t.dashboard.colTotal}</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">{t.dashboard.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4">
                        <ChartEmpty
                          icon={<Inbox className="h-5 w-5" />}
                          title={t.dashboard.noInvoicesFound}
                          hint={t.dashboard.recentInvoicesEmptyHint}
                        />
                      </td>
                    </tr>
                  ) : (
                    data.recentInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{inv.invoiceNumber}</td>
                        <td className="px-4 py-3 text-foreground">{inv.vendor?.name ?? '—'}</td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{inv.company?.name ?? '—'}</td>
                        <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                          {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
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
          </section>
        </div>
      )}
    </div>
  )
}
