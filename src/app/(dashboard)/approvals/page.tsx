'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/invoice/StatusBadge'

interface InvoiceItem {
  id: string
  description: string
  total: string
}

interface ApprovalEntry {
  id: string
  step: number
  status: string
  invoice: {
    id: string
    invoiceNumber: string
    status: string
    totalAmount: string
    dueDate: string | null
    invoiceDate: string | null
    currency: string
    vendor: { name: string }
    items: InvoiceItem[]
  }
}

function formatIDR(v: string | number | null | undefined) {
  if (v == null) return '—'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(v))
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function ApprovalCard({
  entry,
  role,
  onDone,
}: {
  entry: ApprovalEntry
  role: string
  onDone: (id: string) => void
}) {
  const [showReject, setShowReject] = useState(false)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)
  const { invoice } = entry
  const overdue = isOverdue(invoice.dueDate)

  const approve = async () => {
    setActing(true)
    const res = await fetch(`/api/approvals/${invoice.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Disetujui.' }),
    })
    setActing(false)
    if (res.ok) {
      toast.success(
        role === 'FINANCE'
          ? `Invoice ${invoice.invoiceNumber} diteruskan ke Manager`
          : `Invoice ${invoice.invoiceNumber} disetujui`
      )
      onDone(entry.id)
    } else {
      toast.error('Gagal menyetujui invoice')
    }
  }

  const reject = async () => {
    if (!comment.trim()) {
      toast.error('Masukkan alasan penolakan')
      return
    }
    setActing(true)
    const res = await fetch(`/api/approvals/${invoice.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    })
    setActing(false)
    if (res.ok) {
      toast.success(`Invoice ${invoice.invoiceNumber} ditolak`)
      onDone(entry.id)
    } else {
      toast.error('Gagal menolak invoice')
    }
  }

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
        overdue ? 'border-l-4 border-l-red-400' : ''
      }`}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-gray-900 text-sm">
              {invoice.invoiceNumber}
            </span>
            <StatusBadge status={invoice.status} />
            {overdue && (
              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Terlambat
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1 text-gray-500 text-sm">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{invoice.vendor.name}</span>
          </div>
        </div>
        <Link href={`/invoices/${invoice.id}`}>
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-400 hover:text-blue-600 flex-shrink-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <Separator />

      {/* Card Details */}
      <div className="grid grid-cols-3 gap-3 px-5 py-3 text-sm">
        <div>
          <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
            <DollarSign className="h-3 w-3" /> Total
          </p>
          <p className="font-semibold text-blue-700">{formatIDR(invoice.totalAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
            <Calendar className="h-3 w-3" /> Tgl Invoice
          </p>
          <p className="text-gray-700">{formatDate(invoice.invoiceDate)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
            <Clock className="h-3 w-3" /> Jatuh Tempo
          </p>
          <p className={overdue ? 'text-red-600 font-semibold' : 'text-gray-700'}>
            {formatDate(invoice.dueDate)}
          </p>
        </div>
      </div>

      {/* Line Items Preview */}
      {invoice.items.length > 0 && (
        <div className="px-5 pb-3">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            {invoice.items.slice(0, 3).map((item) => (
              <div key={item.id} className="flex justify-between text-xs text-gray-500">
                <span className="truncate mr-2">{item.description}</span>
                <span className="flex-shrink-0 font-medium text-gray-700">
                  {formatIDR(item.total)}
                </span>
              </div>
            ))}
            {invoice.items.length > 3 && (
              <p className="text-xs text-gray-400 italic">
                +{invoice.items.length - 3} item lainnya
              </p>
            )}
          </div>
        </div>
      )}

      <Separator />

      {/* Action Area */}
      <div className="px-5 py-4 space-y-3">
        {!showReject ? (
          <div className="flex gap-2">
            <Button
              onClick={approve}
              disabled={acting}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {role === 'FINANCE' ? 'Teruskan ke Manager' : 'Setujui'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowReject(true)}
              disabled={acting}
              className="flex-1"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Tolak
            </Button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-2"
          >
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              placeholder="Alasan penolakan (wajib)..."
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={reject}
                disabled={acting || !comment.trim()}
                className="flex-1"
              >
                Konfirmasi Penolakan
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowReject(false)
                  setComment('')
                }}
                className="flex-1"
              >
                Batal
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ role }: { role: string }) {
  const message =
    role === 'FINANCE'
      ? 'Tidak ada invoice yang menunggu review Finance.'
      : role === 'MANAGER'
      ? 'Tidak ada invoice yang menunggu persetujuan Manager.'
      : 'Tidak ada invoice yang memerlukan tindakan Anda.'

  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
      <CheckCircle className="h-12 w-12 mb-3 text-green-300" />
      <p className="text-base font-medium text-gray-500">Semua selesai!</p>
      <p className="text-sm mt-1">{message}</p>
    </div>
  )
}

export default function ApprovalsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''
  const [items, setItems] = useState<ApprovalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/approvals')
      .then((r) => r.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleDone = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id))
  }

  const visible = items.filter((i) => !dismissed.has(i.id))

  const roleLabel =
    role === 'FINANCE'
      ? 'Finance Review — Langkah 1'
      : role === 'MANAGER'
      ? 'Manager Approval — Langkah 2'
      : 'Antrian Persetujuan'

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Persetujuan Invoice</h1>
          <p className="text-sm text-gray-500 mt-0.5">{roleLabel}</p>
        </div>
        {!loading && (
          <span className="text-sm bg-blue-50 text-blue-700 font-semibold px-3 py-1 rounded-full border border-blue-200">
            {visible.length} menunggu
          </span>
        )}
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState role={role} />
      ) : (
        <motion.div
          layout
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
        >
          <AnimatePresence>
            {visible.map((entry) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <ApprovalCard entry={entry} role={role} onDone={handleDone} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Viewer-only notice */}
      {!loading && role === 'VIEWER' && (
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-yellow-700 text-sm">
          <FileText className="h-4 w-4 flex-shrink-0" />
          Role Viewer tidak memiliki akses untuk menyetujui atau menolak invoice.
        </div>
      )}
    </div>
  )
}
