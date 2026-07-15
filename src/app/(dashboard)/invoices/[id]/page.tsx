'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowLeft, FileText, Calendar, Building2,
  ChevronLeft, ChevronRight, AlertTriangle, Send, Truck, User as UserIcon,
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

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: string
  taxAmount: string | null
  subtotal: string | null
  dueDate: string | null
  invoiceDate: string | null
  sendDate: string | null
  deliveredDate: string | null
  currency: string
  ocrConfidence: number | null
  notes: string | null
  filePath: string | null
  fileType: string | null
  vendor: { id: string; name: string; npwp?: string | null }
  createdBy: { id: string; name: string }
  pic: { id: string; name: string } | null
  items: { id: string; description: string; quantity: string | null; unitPrice: string | null; total: string; sortOrder: number }[]
}

import { formatIDR, formatDate, isOverdue } from '@/lib/format'

// Duplicated (not imported) from src/lib/validations.ts — that module also
// pulls in next/server, which can't be bundled into this client component.
const VALID_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['CANCELLED', 'REJECTED', 'VOID', 'REVISION'],
  REVISION: ['SUBMITTED'],
  CANCELLED: [],
  REJECTED: [],
  VOID: [],
}
const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Diajukan', CANCELLED: 'Dibatalkan', REJECTED: 'Ditolak', VOID: 'Void', REVISION: 'Revisi',
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const label = value >= 80 ? 'High' : value >= 50 ? 'Medium' : 'Low'
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

function DocumentViewer({ invoice }: { invoice: Invoice }) {
  const [numPages, setNumPages] = useState<number>(1)
  const [pageNumber, setPageNumber] = useState(1)

  if (!invoice.filePath || !invoice.fileType) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-gray-50 rounded-xl border-2 border-dashed text-gray-400">
        <FileText className="h-10 w-10 mb-2" />
        <p className="text-sm">No document uploaded</p>
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
          error={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">Failed to load PDF</div>}
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
          <span className="text-sm text-gray-500">Page {pageNumber} / {numPages}</span>
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
  const [newStatus, setNewStatus] = useState('')
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)
  const [gaStaff, setGaStaff] = useState<{ id: string; name: string }[]>([])
  const [sendDateInput, setSendDateInput] = useState('')
  const [deliveredDateInput, setDeliveredDateInput] = useState('')
  const [picId, setPicId] = useState('')
  const [revNumber, setRevNumber] = useState('')
  const [revInvoiceDate, setRevInvoiceDate] = useState('')
  const [revDueDate, setRevDueDate] = useState('')
  const [revSubtotal, setRevSubtotal] = useState('')
  const [revTax, setRevTax] = useState('')
  const [revTotal, setRevTotal] = useState('')
  const [revNotes, setRevNotes] = useState('')

  const fetchInvoice = async () => {
    try {
      const res = await fetch(`/api/invoices/${id}`)
      if (res.status === 401 || res.status === 403) {
        setFetchError('auth')
      } else if (!res.ok) {
        setFetchError('notfound')
      } else {
        const data = await res.json()
        setInvoice(data)
        setSendDateInput(data.sendDate?.slice(0, 10) ?? '')
        setDeliveredDateInput(data.deliveredDate?.slice(0, 10) ?? '')
        setPicId(data.pic?.id ?? '')
        setRevNumber(data.invoiceNumber ?? '')
        setRevInvoiceDate(data.invoiceDate?.slice(0, 10) ?? '')
        setRevDueDate(data.dueDate?.slice(0, 10) ?? '')
        setRevSubtotal(data.subtotal ?? '')
        setRevTax(data.taxAmount ?? '')
        setRevTotal(data.totalAmount ?? '')
        setRevNotes(data.notes ?? '')
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
    fetch('/api/users?role=GA_STAFF').then(r => r.json()).then((d: unknown) => setGaStaff(Array.isArray(d) ? d : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const role = (session?.user as { role?: string } | undefined)?.role
  const sessionVendorId = (session?.user as { vendorId?: string | null } | undefined)?.vendorId
  const isOwner = role === 'VENDOR' && invoice?.vendor?.id === sessionVendorId
  const canUpdateStatus = ['GA_STAFF', 'FINANCE', 'ADMIN'].includes(role ?? '')
  // Fixing & resubmitting a revision is the vendor's job — GA_STAFF only
  // creates/handles intake, they don't correct the vendor's own data.
  const canResubmit = invoice?.status === 'REVISION' && (role === 'ADMIN' || isOwner)
  const canEditDelivery = ['GA_STAFF', 'ADMIN'].includes(role ?? '')
  const canEditSendDate = canEditDelivery || (role === 'VENDOR' && isOwner)
  const transitionOptions = invoice ? (VALID_TRANSITIONS[invoice.status] ?? []) : []

  const patchInvoice = async (body: Record<string, unknown>, successMsg: string) => {
    setActing(true)
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setActing(false)
    if (res.ok) {
      toast.success(successMsg)
      fetchInvoice()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? 'Update failed')
    }
  }

  const handleStatusUpdate = () => {
    if (!newStatus) { toast.error('Select a status'); return }
    patchInvoice({ status: newStatus, comment: comment || undefined }, 'Status updated')
    setNewStatus('')
    setComment('')
  }

  const handleResubmit = () => patchInvoice({
    status: 'SUBMITTED',
    invoiceNumber: revNumber || undefined,
    invoiceDate: revInvoiceDate || undefined,
    dueDate: revDueDate || undefined,
    subtotal: revSubtotal !== '' ? Number(revSubtotal) : undefined,
    taxAmount: revTax !== '' ? Number(revTax) : undefined,
    totalAmount: revTotal !== '' ? Number(revTotal) : undefined,
    notes: revNotes || undefined,
  }, 'Invoice diperbaiki & diajukan ulang')

  const handleDeliverySave = () => {
    if (deliveredDateInput && sendDateInput && deliveredDateInput < sendDateInput) {
      toast.error('Delivered date cannot be earlier than send date')
      return
    }
    patchInvoice(
      { sendDate: sendDateInput || undefined, deliveredDate: deliveredDateInput || undefined, picId: picId || undefined },
      'Delivery info saved',
    )
  }

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
        ? 'Your session has expired. Please log in again.'
        : fetchError === 'network'
        ? 'Failed to connect to server. Check your connection.'
        : 'Invoice not found.'
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertTriangle className="h-8 w-8 mb-2 text-yellow-500" />
        <p>{errorMsg}</p>
        <Link href="/invoices"><Button variant="outline" className="mt-4">Back</Button></Link>
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
              <p className="text-xs text-gray-400 uppercase tracking-wide">OCR Accuracy</p>
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
                <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" /> Invoice Date</p>
                <p className="text-sm font-medium text-gray-700 mt-0.5">{formatDate(invoice.invoiceDate)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" /> Due Date</p>
                <p className={`text-sm font-medium mt-0.5 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                  {formatDate(invoice.dueDate)}
                  {overdue && <span className="block text-xs text-red-500">Overdue</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Financial Summary</p>
            <div className="space-y-2">
              {invoice.subtotal && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-700">{formatIDR(invoice.subtotal)}</span>
                </div>
              )}
              {invoice.taxAmount && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">VAT</span>
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
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Invoice Items</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-2 text-xs text-gray-500">Description</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500">Qty</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500 hidden sm:table-cell">Price</th>
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

          {/* Delivery & PIC */}
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Delivery &amp; PIC</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1"><Send className="h-3 w-3" /> Send Date</label>
                <input
                  type="date"
                  value={sendDateInput}
                  onChange={e => setSendDateInput(e.target.value)}
                  disabled={!canEditSendDate}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1"><Truck className="h-3 w-3" /> Delivered Date</label>
                <input
                  type="date"
                  value={deliveredDateInput}
                  onChange={e => setDeliveredDateInput(e.target.value)}
                  disabled={!canEditDelivery}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                />
              </div>
            </div>
            {canEditDelivery ? (
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1"><UserIcon className="h-3 w-3" /> PIC (GA Staff)</label>
                <select
                  value={picId}
                  onChange={e => setPicId(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {gaStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            ) : role !== 'VENDOR' ? (
              <p className="text-sm text-gray-600"><UserIcon className="h-3 w-3 inline mr-1" /> PIC: {invoice.pic?.name ?? '—'}</p>
            ) : null}
            {(canEditSendDate || canEditDelivery) && (
              <Button size="sm" onClick={handleDeliverySave} disabled={acting}>Save Delivery Info</Button>
            )}
          </div>

          {/* Fix & Resubmit (REVISION) */}
          {canResubmit && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Perbaiki &amp; Ajukan Ulang</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">Invoice Number</label>
                  <input
                    type="text"
                    value={revNumber}
                    onChange={e => setRevNumber(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Invoice Date</label>
                  <input
                    type="date"
                    value={revInvoiceDate}
                    onChange={e => setRevInvoiceDate(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Due Date</label>
                  <input
                    type="date"
                    value={revDueDate}
                    onChange={e => setRevDueDate(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Subtotal</label>
                  <input
                    type="number"
                    value={revSubtotal}
                    onChange={e => setRevSubtotal(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Tax Amount</label>
                  <input
                    type="number"
                    value={revTax}
                    onChange={e => setRevTax(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Total Amount</label>
                  <input
                    type="number"
                    value={revTotal}
                    onChange={e => setRevTotal(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400">Notes</label>
                <textarea
                  rows={2}
                  value={revNotes}
                  onChange={e => setRevNotes(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <Button onClick={handleResubmit} disabled={acting} className="w-full">Simpan &amp; Ajukan Ulang</Button>
            </div>
          )}
          {canUpdateStatus && transitionOptions.length > 0 && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Update Status</p>
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Select new status...</option>
                {transitionOptions.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
              </select>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                placeholder="Comment (optional)..."
                rows={2}
                value={comment}
                onChange={e => setComment(e.target.value)}
              />
              <Button onClick={handleStatusUpdate} disabled={acting || !newStatus} className="w-full">Update</Button>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-400 mb-1">Notes</p>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
