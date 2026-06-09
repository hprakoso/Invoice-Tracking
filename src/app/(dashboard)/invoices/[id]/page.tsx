'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowLeft, FileText, Calendar, Building2, CheckCircle,
  XCircle, Clock, ChevronLeft, ChevronRight, AlertTriangle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/invoice/StatusBadge'

// Dynamic import to avoid SSR issues with react-pdf
const PDFDocument = dynamic(() => import('react-pdf').then(m => m.Document), { ssr: false })
const PDFPage = dynamic(() => import('react-pdf').then(m => m.Page), { ssr: false })

// Configure react-pdf worker (client-side only)
if (typeof window !== 'undefined') {
  import('react-pdf').then(({ pdfjs }) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  })
}

interface Approval {
  id: string
  step: number
  status: string
  comment: string | null
  actionedAt: string | null
  approver: { id: string; name: string; role: string } | null
}

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: string
  taxAmount: string | null
  subtotal: string | null
  dueDate: string | null
  invoiceDate: string | null
  currency: string
  ocrConfidence: number | null
  notes: string | null
  filePath: string | null
  fileType: string | null
  vendor: { id: string; name: string; npwp?: string | null }
  createdBy: { id: string; name: string }
  items: { id: string; description: string; quantity: string | null; unitPrice: string | null; total: string; sortOrder: number }[]
  approvals: Approval[]
}

import { formatIDR, formatDate, isOverdue } from '@/lib/format'

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const label = value >= 80 ? 'Tinggi' : value >= 50 ? 'Sedang' : 'Rendah'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-2 rounded-full ${color}`}
        />
      </div>
      <span className="text-xs text-gray-500 w-20">{label} ({value.toFixed(0)}%)</span>
    </div>
  )
}

function ApprovalTimeline({ approvals }: { approvals: Approval[] }) {
  const steps = [
    { step: 1, label: 'Finance Review' },
    { step: 2, label: 'Manager Approval' },
  ]
  return (
    <div className="space-y-0">
      {steps.map(({ step, label }, idx) => {
        const approval = approvals.find(a => a.step === step)
        const status = approval?.status ?? 'PENDING'
        const Icon = status === 'APPROVED' ? CheckCircle : status === 'REJECTED' ? XCircle : Clock
        const iconColor = status === 'APPROVED' ? 'text-green-500' : status === 'REJECTED' ? 'text-red-500' : 'text-gray-400'

        return (
          <div key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <Icon className={`h-5 w-5 flex-shrink-0 ${iconColor}`} />
              {idx < steps.length - 1 && <div className="w-px flex-1 bg-gray-200 my-1 min-h-[24px]" />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">{label}</p>
                <StatusBadge status={status === 'PENDING' ? 'PENDING_REVIEW' : status === 'APPROVED' ? 'APPROVED' : 'REJECTED'} />
              </div>
              {approval && status !== 'PENDING' && (
                <div className="mt-1 space-y-0.5">
                  {approval.approver && <p className="text-xs text-gray-500">{approval.approver.name}</p>}
                  {approval.comment && <p className="text-xs text-gray-400 italic">&ldquo;{approval.comment}&rdquo;</p>}
                  {approval.actionedAt && <p className="text-xs text-gray-400">{formatDate(approval.actionedAt)}</p>}
                </div>
              )}
              {(!approval || status === 'PENDING') && (
                <p className="text-xs text-gray-400 mt-0.5">Menunggu tindakan...</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DocumentViewer({ invoice }: { invoice: Invoice }) {
  const [numPages, setNumPages] = useState<number>(1)
  const [pageNumber, setPageNumber] = useState(1)

  if (!invoice.filePath || !invoice.fileType) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-gray-50 rounded-xl border-2 border-dashed text-gray-400">
        <FileText className="h-10 w-10 mb-2" />
        <p className="text-sm">Dokumen belum diupload</p>
      </div>
    )
  }

  const fileUrl = `/api/invoices/${invoice.id}/file`

  if (['jpg', 'jpeg', 'png'].includes(invoice.fileType)) {
    return (
      <div className="rounded-xl overflow-hidden border bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrl} alt={invoice.invoiceNumber} className="w-full h-auto object-contain max-h-[700px]" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden border bg-gray-50 flex justify-center">
        <PDFDocument
          file={fileUrl}
          onLoadSuccess={({ numPages: n }: { numPages: number }) => setNumPages(n)}
          loading={<div className="flex items-center justify-center h-64"><Skeleton className="w-full h-64" /></div>}
          error={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">Gagal memuat PDF</div>}
        >
          <PDFPage
            pageNumber={pageNumber}
            width={480}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        </PDFDocument>
      </div>
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-500">Hal. {pageNumber} / {numPages}</span>
          <Button variant="outline" size="icon" onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<'notfound' | 'auth' | 'network' | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [acting, setActing] = useState(false)

  const fetchInvoice = async () => {
    try {
      const res = await fetch(`/api/invoices/${id}`)
      if (res.status === 401 || res.status === 403) {
        setFetchError('auth')
      } else if (!res.ok) {
        setFetchError('notfound')
      } else {
        setInvoice(await res.json())
        setFetchError(null)
      }
    } catch {
      setFetchError('network')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInvoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleApprove = async () => {
    setActing(true)
    const res = await fetch(`/api/approvals/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Disetujui.' }),
    })
    setActing(false)
    if (res.ok) {
      toast.success('Invoice disetujui')
      fetchInvoice()
    } else {
      toast.error('Gagal menyetujui invoice')
    }
  }

  const handleReject = async () => {
    if (!rejectComment.trim()) { toast.error('Masukkan alasan penolakan'); return }
    setActing(true)
    const res = await fetch(`/api/approvals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: rejectComment }),
    })
    setActing(false)
    if (res.ok) {
      toast.success('Invoice ditolak')
      setShowReject(false)
      setRejectComment('')
      fetchInvoice()
    } else {
      toast.error('Gagal menolak invoice')
    }
  }

  // router removed — was only suppressing an unused-variable lint warning with `void router`

  const role = (session?.user as { role?: string } | undefined)?.role
  const canAct = invoice?.status === 'PENDING_APPROVAL' &&
    ((role === 'FINANCE' && !invoice.approvals.find(a => a.step === 1 && a.status === 'APPROVED')) ||
     (role === 'MANAGER' && !!invoice.approvals.find(a => a.step === 1 && a.status === 'APPROVED') && !invoice.approvals.find(a => a.step === 2 && a.status !== 'PENDING')) ||
     role === 'ADMIN')

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[500px] rounded-xl" />
          <Skeleton className="h-[500px] rounded-xl" />
        </div>
      </div>
    )
  }

  if (!invoice) {
    const errorMsg =
      fetchError === 'auth'
        ? 'Sesi Anda telah berakhir. Silakan login kembali.'
        : fetchError === 'network'
        ? 'Gagal terhubung ke server. Periksa koneksi Anda.'
        : 'Invoice tidak ditemukan.'
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertTriangle className="h-8 w-8 mb-2 text-yellow-500" />
        <p>{errorMsg}</p>
        <Link href="/invoices"><Button variant="outline" className="mt-4">Kembali</Button></Link>
      </div>
    )
  }

  const overdue = isOverdue(invoice.dueDate, invoice.status)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <Link href="/invoices">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 font-mono truncate">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-gray-500">{invoice.vendor?.name}</p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      {/* Main split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: Document (sticky on desktop) */}
        <div className="lg:sticky lg:top-4">
          <DocumentViewer invoice={invoice} />
        </div>

        {/* Right: Fields (scrollable) */}
        <div className="space-y-5">
          {/* OCR Confidence */}
          {invoice.ocrConfidence != null && (
            <div className="bg-white rounded-xl border p-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Akurasi OCR</p>
              <ConfidenceBar value={invoice.ocrConfidence} />
            </div>
          )}

          {/* Vendor & Dates */}
          <div className="bg-white rounded-xl border p-4 space-y-4">
            <div className="flex items-start gap-2">
              <Building2 className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{invoice.vendor?.name}</p>
                {invoice.vendor?.npwp && <p className="text-xs text-gray-500">NPWP: {invoice.vendor.npwp}</p>}
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" /> Tgl Invoice</p>
                <p className="text-sm font-medium text-gray-700 mt-0.5">{formatDate(invoice.invoiceDate)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" /> Jatuh Tempo</p>
                <p className={`text-sm font-medium mt-0.5 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                  {formatDate(invoice.dueDate)}
                  {overdue && <span className="block text-xs text-red-500">Terlambat</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Ringkasan Keuangan</p>
            <div className="space-y-2">
              {invoice.subtotal && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-700">{formatIDR(invoice.subtotal)}</span>
                </div>
              )}
              {invoice.taxAmount && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">PPN</span>
                  <span className="text-gray-700">{formatIDR(invoice.taxAmount)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span className="text-gray-800">Total</span>
                <span className="text-blue-700">{formatIDR(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>

          {/* Line Items */}
          {invoice.items.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Item Invoice</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-2 text-xs text-gray-500">Deskripsi</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500">Qty</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500 hidden sm:table-cell">Harga</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item, i) => (
                      <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-4 py-2 text-gray-700">{item.description}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{item.quantity ?? '—'}</td>
                        <td className="px-4 py-2 text-right text-gray-500 hidden sm:table-cell">{formatIDR(item.unitPrice)}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-700">{formatIDR(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Approval Timeline */}
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-4">Alur Persetujuan</p>
            <ApprovalTimeline approvals={invoice.approvals} />
          </div>

          {/* Action Buttons */}
          {canAct && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Tindakan</p>
              {!showReject ? (
                <div className="flex gap-2">
                  <Button onClick={handleApprove} disabled={acting} className="flex-1 bg-green-600 hover:bg-green-700">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {role === 'FINANCE' ? 'Teruskan ke Manager' : 'Setujui'}
                  </Button>
                  <Button variant="destructive" onClick={() => setShowReject(true)} disabled={acting} className="flex-1">
                    <XCircle className="h-4 w-4 mr-2" />
                    Tolak
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                    placeholder="Alasan penolakan (wajib diisi)..."
                    rows={3}
                    value={rejectComment}
                    onChange={e => setRejectComment(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button variant="destructive" onClick={handleReject} disabled={acting || !rejectComment.trim()} className="flex-1">
                      Konfirmasi Penolakan
                    </Button>
                    <Button variant="outline" onClick={() => { setShowReject(false); setRejectComment('') }} className="flex-1">
                      Batal
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-400 mb-1">Catatan</p>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
