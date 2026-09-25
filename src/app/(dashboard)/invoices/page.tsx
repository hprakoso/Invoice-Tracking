'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Plus, ChevronLeft, ChevronRight, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { PICStageBadge, PIC_STAGE_ORDER } from '@/components/invoice/PICStageBadge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useI18n } from '@/hooks/useI18n'

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  picStage: string
  poNumber: string | null
  totalAmount: string
  dueDate: string | null
  invoiceDate: string | null
  sendDate: string | null
  deliveredDate: string | null
  currency: string
  ocrConfidence: number | null
  vendor: { id: string; name: string }
  company: { id: string; name: string } | null
  createdBy: { id: string; name: string }
  pic: { id: string; name: string } | null
  items: { id: string; description: string; quantity: string | null; unitPrice: string | null; total: string }[]
}

interface Vendor { id: string; name: string }

// Columns the API is willing to sort by — mirrors the SORTABLE whitelist in
// src/app/api/invoices/route.ts. Anything not listed renders as a plain header.
type SortKey =
  | 'invoiceNumber' | 'company' | 'status' | 'sendDate' | 'deliveredDate'
  | 'invoiceDate' | 'dueDate' | 'createdAt' | 'totalAmount' | 'picStage'

// A sortable column header. Declared at module scope, not inside the page
// component — a component created during render is a new type on every render,
// which resets its state and defeats reconciliation. Non-sortable columns stay
// a plain <th> so they don't look clickable; aria-sort tells assistive tech
// which column is currently ordering the table.
function SortTh({
  k, label, sort, dir, onToggle, cls = '', align = 'left',
}: {
  k: SortKey
  label: string
  sort: SortKey
  dir: 'asc' | 'desc'
  onToggle: (k: SortKey) => void
  cls?: string
  align?: 'left' | 'right' | 'center'
}) {
  const active = sort === k
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap ${alignCls} ${cls}`}
    >
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={`inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 ${active ? 'text-gray-700 dark:text-gray-200' : ''}`}
      >
        {label}
        {active
          ? (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
      </button>
    </th>
  )
}

import { formatIDR, formatDate, isOverdue } from '@/lib/format'

export default function InvoicesPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { t } = useI18n()
  const canManageStage = ['ADMIN', 'GA_STAFF', 'GA_MANAGER'].includes(session?.user?.role ?? '')

  const STATUSES = [
    { value: '', label: t.dashboard.allStatuses },
    ...Object.entries(t.status).map(([value, label]) => ({ value, label })),
  ]
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [companies, setCompanies] = useState<Vendor[]>([])
  const [companyId, setCompanyId] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [picId, setPicId] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [gaStaff, setGaStaff] = useState<{ id: string; name: string }[]>([])
  // Server-side paging. The body is still a bare array, so `total`/`pages` come
  // from the response headers — the table only ever holds one page and neither
  // figure can be derived from it.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  // Sort is applied by the API before paging, so it is server state, not a
  // client-side re-order of the current page. Keys are the API's whitelist.
  const [sort, setSort] = useState<SortKey>('createdAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  // A new column starts descending (most useful default for dates/amounts);
  // clicking the active column flips direction. Sorting re-orders the whole
  // filtered set, so the current page number no longer means anything.
  const toggleSort = (key: SortKey) => {
    if (key === sort) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir('desc') }
    setPage(1)
  }

  // A filter change invalidates the page number: page 4 of the unfiltered list
  // is not page 4 of the filtered one, and is usually past its end. Done in the
  // setters rather than an effect so the narrowed query is fetched once instead
  // of fetched-then-refetched.
  const onFilter = <T,>(set: (v: T) => void) => (value: T) => {
    set(value)
    setPage(1)
  }

  // PIC is internal-only (scrubbed from vendor-facing invoice responses), so
  // vendors don't get a filter for it either.
  const canFilterByPic = ['ADMIN', 'GA_STAFF', 'GA_MANAGER'].includes(session?.user?.role ?? '')
  // The PIC stage column is internal workflow, so vendors don't see it. The
  // skeleton and empty-state rows must span the same number of columns.
  const showPicStage = session?.user?.role !== 'VENDOR'
  const colCount = showPicStage ? 11 : 10

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (vendorId) params.set('vendorId', vendorId)
    if (companyId) params.set('companyId', companyId)
    if (poNumber) params.set('poNumber', poNumber)
    if (picId) params.set('picId', picId)
    if (amountMin) params.set('amountMin', amountMin)
    if (amountMax) params.set('amountMax', amountMax)
    params.set('page', String(page))
    params.set('sort', sort)
    params.set('dir', dir)
    const res = await fetch(`/api/invoices?${params}`)
    const data = await res.json()
    setInvoices(Array.isArray(data) ? data : [])
    const headerTotal = Number(res.headers.get('X-Total-Count'))
    const headerPages = Number(res.headers.get('X-Total-Pages'))
    setTotal(Number.isFinite(headerTotal) ? headerTotal : 0)
    setPages(Number.isFinite(headerPages) && headerPages > 0 ? headerPages : 1)
    setLoading(false)
  }, [search, status, vendorId, companyId, poNumber, picId, amountMin, amountMax, page, sort, dir])

  useEffect(() => {
    fetch('/api/vendors').then(r => r.json()).then((d: unknown) => setVendors(Array.isArray(d) ? d : []))
    // Inactive companies included, same as the dashboard filter: older invoices
    // may still be billed to a company that has since been deactivated.
    fetch('/api/companies?includeInactive=true').then(r => r.json()).then((d: unknown) => setCompanies(Array.isArray(d) ? d : []))
    // PIC filter lists GA staff — the same source the upload wizard's PIC
    // dropdown uses. VENDOR callers get 403 here and simply see no filter.
    if (canFilterByPic) {
      fetch('/api/users?role=GA_STAFF').then(r => r.json()).then((d: unknown) => setGaStaff(Array.isArray(d) ? d : []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(fetchInvoices, 300)
    return () => clearTimeout(timer)
  }, [fetchInvoices])

  const moveStage = async (invoiceId: string, stage: string) => {
    const res = await fetch(`/api/invoices/${invoiceId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    })
    if (res.ok) {
      toast.success(t.invoices.stageMoved)
      fetchInvoices()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.invoices.stageMoveFailed)
    }
  }

  const canUpload = ['ADMIN', 'VENDOR', 'GA_STAFF', 'GA_MANAGER'].includes(session?.user?.role ?? '')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.invoices.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{total} {t.invoices.countFound}</p>
        </div>
        {canUpload && (
          <Link href="/invoices/upload">
            <Button className="gap-2 w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              {t.invoices.uploadInvoice}
            </Button>
          </Link>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t.invoices.searchPlaceholder}
              value={search}
              onChange={e => onFilter(setSearch)(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={status}
            onChange={e => onFilter(setStatus)(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            value={vendorId}
            onChange={e => onFilter(setVendorId)(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t.dashboard.allVendors}</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select
            value={companyId}
            onChange={e => onFilter(setCompanyId)(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t.dashboard.allCompanies}</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
          <Input
            placeholder={t.invoices.poFilterPlaceholder}
            value={poNumber}
            onChange={e => onFilter(setPoNumber)(e.target.value)}
            className="sm:max-w-[180px]"
          />
          {canFilterByPic && (
            <select
              value={picId}
              onChange={e => onFilter(setPicId)(e.target.value)}
              aria-label={t.invoices.picFilterLabel}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t.invoices.allPics}</option>
              {gaStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={t.invoices.amountMinPlaceholder}
              value={amountMin}
              onChange={e => onFilter(setAmountMin)(e.target.value)}
              aria-label={t.invoices.amountMinPlaceholder}
              className="w-full sm:w-[140px]"
            />
            <span className="text-sm text-gray-400">–</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={t.invoices.amountMaxPlaceholder}
              value={amountMax}
              onChange={e => onFilter(setAmountMax)(e.target.value)}
              aria-label={t.invoices.amountMaxPlaceholder}
              className="w-full sm:w-[140px]"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <SortTh k="invoiceNumber" label={t.invoices.colInvoiceNo} sort={sort} dir={dir} onToggle={toggleSort} />
                {/* Vendor is not in the API's sort whitelist, so it stays a plain header. */}
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.invoices.colVendor}</th>
                <SortTh k="company" label={t.invoices.colCompany} sort={sort} dir={dir} onToggle={toggleSort} cls="hidden md:table-cell" />
                <SortTh k="invoiceDate" label={t.invoices.colInvoiceDate} sort={sort} dir={dir} onToggle={toggleSort} cls="hidden xl:table-cell" />
                <SortTh k="dueDate" label={t.invoices.colDueDate} sort={sort} dir={dir} onToggle={toggleSort} cls="hidden sm:table-cell" />
                <SortTh k="sendDate" label={t.invoices.colSentDate} sort={sort} dir={dir} onToggle={toggleSort} cls="hidden lg:table-cell" />
                <SortTh k="deliveredDate" label={t.invoices.colReceivedDate} sort={sort} dir={dir} onToggle={toggleSort} cls="hidden lg:table-cell" />
                <SortTh k="totalAmount" label={t.invoices.colTotal} sort={sort} dir={dir} onToggle={toggleSort} align="right" />
                <SortTh k="status" label={t.invoices.colStatus} sort={sort} dir={dir} onToggle={toggleSort} align="center" />
                {showPicStage && <SortTh k="picStage" label={t.invoices.colPicStage} sort={sort} dir={dir} onToggle={toggleSort} />}
                <th className="w-8 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b dark:border-gray-700">
                    {[...Array(colCount)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    {t.invoices.noInvoicesFound}
                  </td>
                </tr>
              ) : (
                invoices.map((inv, i) => (
                  <motion.tr
                    key={inv.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className={`border-b dark:border-gray-700 last:border-0 hover:bg-blue-50/50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${
                      isOverdue(inv.dueDate, inv.status) ? 'bg-red-50/30 dark:bg-red-900/10' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      <div>{inv.invoiceNumber}</div>
                      {inv.poNumber && <div className="text-[10px] text-gray-400 dark:text-gray-500 font-sans">{t.invoices.poShort}: {inv.poNumber}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[180px] truncate">{inv.vendor?.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell max-w-[180px] truncate">{inv.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden xl:table-cell whitespace-nowrap">{formatDate(inv.invoiceDate)}</td>
                    <td className={`px-4 py-3 hidden sm:table-cell font-medium ${isOverdue(inv.dueDate, inv.status) ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      <div className="whitespace-nowrap">{formatDate(inv.dueDate)}</div>
                      {isOverdue(inv.dueDate, inv.status) && <div className="text-xs text-red-500 dark:text-red-400 font-semibold mt-0.5">{t.invoices.overdueTag}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell whitespace-nowrap">{formatDate(inv.sendDate)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell whitespace-nowrap">{formatDate(inv.deliveredDate)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatIDR(inv.totalAmount)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={inv.status} /></td>
                    {showPicStage && <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <PICStageBadge stage={inv.picStage} />
                        {canManageStage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" aria-label={t.invoices.moveStageAria} />
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ChevronsUpDown className="h-3.5 w-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {PIC_STAGE_ORDER.map((stage) => (
                                <DropdownMenuItem
                                  key={stage}
                                  disabled={stage === inv.picStage}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    moveStage(inv.id, stage)
                                  }}
                                >
                                  {(t.picStage as Record<string, string>)[stage] ?? stage}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>}
                    <td className="px-2 py-3"><ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600" /></td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination — same controls as the audit log's */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t.invoices.pageOf.replace('{page}', String(page)).replace('{pages}', String(pages))}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              {t.invoices.previous}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages || loading} className="gap-1">
              {t.invoices.next}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
