'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Plus, ChevronRight, ChevronsUpDown } from 'lucide-react'
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
  createdBy: { id: string; name: string }
  pic: { id: string; name: string } | null
  items: { id: string; description: string; quantity: string | null; unitPrice: string | null; total: string }[]
}

interface Vendor { id: string; name: string }

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

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (vendorId) params.set('vendorId', vendorId)
    const res = await fetch(`/api/invoices?${params}`)
    const data = await res.json()
    setInvoices(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [search, status, vendorId])

  useEffect(() => {
    fetch('/api/vendors').then(r => r.json()).then((d: unknown) => setVendors(Array.isArray(d) ? d : []))
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
          <p className="text-sm text-gray-500 dark:text-gray-400">{invoices.length} {t.invoices.countFound}</p>
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
          <select
            value={vendorId}
            onChange={e => setVendorId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t.dashboard.allVendors}</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">{t.invoices.colInvoiceNo}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.invoices.colVendor}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden md:table-cell whitespace-nowrap">{t.invoices.colInvoiceDate}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden sm:table-cell whitespace-nowrap">{t.invoices.colDueDate}</th>
                <th className="text-right px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">{t.invoices.colTotal}</th>
                <th className="text-center px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.invoices.colStatus}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">{t.invoices.colPicStage}</th>
                <th className="w-8 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b dark:border-gray-700">
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
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
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell whitespace-nowrap">{formatDate(inv.invoiceDate)}</td>
                    <td className={`px-4 py-3 hidden sm:table-cell font-medium ${isOverdue(inv.dueDate, inv.status) ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      <div className="whitespace-nowrap">{formatDate(inv.dueDate)}</div>
                      {isOverdue(inv.dueDate, inv.status) && <div className="text-xs text-red-500 dark:text-red-400 font-semibold mt-0.5">{t.invoices.overdueTag}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatIDR(inv.totalAmount)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3">
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
                    </td>
                    <td className="px-2 py-3"><ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600" /></td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
