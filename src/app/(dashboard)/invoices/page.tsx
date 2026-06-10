'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Plus, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { InvoiceDetailDrawer } from '@/components/invoice/InvoiceDetailDrawer'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: string
  dueDate: string | null
  invoiceDate: string | null
  currency: string
  ocrConfidence: number | null
  vendor: { id: string; name: string }
  createdBy: { id: string; name: string }
  items: { id: string; description: string; quantity: string | null; unitPrice: string | null; total: string }[]
  approvals: {
    id: string
    step: number
    status: string
    comment: string | null
    actionedAt: string | null
    approver: { id: string; name: string; role: string } | null
  }[]
}

interface Vendor { id: string; name: string }

const STATUSES = [
  { value: '', label: 'Semua Status' },
  { value: 'PENDING_OCR', label: 'OCR' },
  { value: 'PENDING_REVIEW', label: 'Review' },
  { value: 'PENDING_APPROVAL', label: 'Approval' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' },
  { value: 'PAID', label: 'Dibayar' },
]

import { formatIDR, formatDate, isOverdue } from '@/lib/format'

export default function InvoicesPage() {
  const { data: session } = useSession()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

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

  const canUpload = ['ADMIN', 'FINANCE'].includes(session?.user?.role ?? '')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Invoice</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{invoices.length} invoice ditemukan</p>
        </div>
        {canUpload && (
          <Link href="/invoices/upload">
            <Button className="gap-2 w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Upload Invoice
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
              placeholder="Cari nomor invoice..."
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
            <option value="">Semua Vendor</option>
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
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">No. Invoice</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden md:table-cell whitespace-nowrap">Tgl Invoice</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium hidden sm:table-cell whitespace-nowrap">Jatuh Tempo</th>
                <th className="text-right px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">Total</th>
                <th className="text-center px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Status</th>
                <th className="w-8 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b dark:border-gray-700">
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    Tidak ada invoice ditemukan.
                  </td>
                </tr>
              ) : (
                invoices.map((inv, i) => (
                  <motion.tr
                    key={inv.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => setSelectedInvoice(inv)}
                    className={`border-b dark:border-gray-700 last:border-0 hover:bg-blue-50/50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${
                      isOverdue(inv.dueDate, inv.status) ? 'bg-red-50/30 dark:bg-red-900/10' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[180px] truncate">{inv.vendor?.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell whitespace-nowrap">{formatDate(inv.invoiceDate)}</td>
                    <td className={`px-4 py-3 hidden sm:table-cell font-medium ${isOverdue(inv.dueDate, inv.status) ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      <div className="whitespace-nowrap">{formatDate(inv.dueDate)}</div>
                      {isOverdue(inv.dueDate, inv.status) && <div className="text-xs text-red-500 dark:text-red-400 font-semibold mt-0.5">(Terlambat)</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatIDR(inv.totalAmount)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={inv.status} /></td>
                    <td className="px-2 py-3"><ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600" /></td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Drawer */}
      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onRefresh={fetchInvoices}
      />
    </div>
  )
}
