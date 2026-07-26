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
  ChevronLeft, ChevronRight, AlertTriangle, Send, Truck, User as UserIcon, Banknote,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { useI18n } from '@/hooks/useI18n'

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
  paidDate: string | null
  paidAmount: string | null
  vendor: { id: string; name: string; npwp?: string | null }
  company: { id: string; name: string } | null
  createdBy: { id: string; name: string }
  pic: { id: string; name: string } | null
  paidBy: { id: string; name: string } | null
  items: { id: string; description: string; quantity: string | null; unitPrice: string | null; total: string; sortOrder: number }[]
}

import { formatIDR, formatDate, isOverdue } from '@/lib/format'

// Duplicated (not imported) from src/lib/validations.ts — that module also
// pulls in next/server, which can't be bundled into this client component.
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PAID', 'CANCELLED', 'REJECTED', 'VOID', 'REVISION'],
  REVISION: ['SUBMITTED'],
  PAID: [],
  CANCELLED: [],
  REJECTED: [],
  VOID: [],
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
  const { t } = useI18n()
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
  const [paidDateInput, setPaidDateInput] = useState('')
  const [paidAmountInput, setPaidAmountInput] = useState('')

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
        setPaidDateInput(data.paidDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
        setPaidAmountInput(data.paidAmount ?? data.totalAmount ?? '')
        setFetchError(null)
      }
    } catch {
      setFetchError('network')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchInvoice() sets a loading flag before its async fetch
    fetchInvoice()
    fetch('/api/users?role=GA_STAFF').then(r => r.json()).then((d: unknown) => setGaStaff(Array.isArray(d) ? d : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const role = (session?.user as { role?: string } | undefined)?.role
  const sessionVendorId = (session?.user as { vendorId?: string | null } | undefined)?.vendorId
  const isOwner = role === 'VENDOR' && invoice?.vendor?.id === sessionVendorId
  const canUpdateStatus = ['GA_STAFF', 'GA_MANAGER', 'ADMIN'].includes(role ?? '')
  // Fixing & resubmitting a revision is the vendor's job — GA_STAFF/GA_MANAGER
  // only create/handle intake, they don't correct the vendor's own data.
  const canResubmit = invoice?.status === 'REVISION' && (role === 'ADMIN' || isOwner)
  const canEditDelivery = ['GA_STAFF', 'GA_MANAGER', 'ADMIN'].includes(role ?? '')
  const canEditSendDate = canEditDelivery || (role === 'VENDOR' && isOwner)
  const canMarkPaid = canUpdateStatus && invoice?.status === 'SUBMITTED'
  // PAID has its own dedicated form (below) that collects paidDate/paidAmount —
  // excluded here so the generic status dropdown can't set it without those.
  const transitionOptions = invoice ? (VALID_TRANSITIONS[invoice.status] ?? []).filter(s => s !== 'PAID') : []

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
      toast.error(data.error ?? t.common.required)
    }
  }

  const handleStatusUpdate = () => {
    if (!newStatus) { toast.error(t.invoiceDetail.selectNewStatus); return }
    patchInvoice({ status: newStatus, comment: comment || undefined }, t.invoiceDetail.statusUpdated)
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
  }, t.invoiceDetail.resubmitted)

  const handleMarkPaid = () => {
    if (!paidAmountInput || Number(paidAmountInput) <= 0) {
      toast.error(t.invoiceDetail.validPaidAmount)
      return
    }
    patchInvoice(
      { status: 'PAID', paidDate: paidDateInput || undefined, paidAmount: Number(paidAmountInput) },
      t.invoiceDetail.paidAmount,
    )
  }

  const handleDeliverySave = () => {
    if (deliveredDateInput && sendDateInput && deliveredDateInput < sendDateInput) {
      toast.error(t.invoiceDetail.deliveredBeforeSendError)
      return
    }
    patchInvoice(
      { sendDate: sendDateInput || undefined, deliveredDate: deliveredDateInput || undefined, picId: picId || undefined },
      t.invoiceDetail.deliveryInfoSaved,
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
        ? t.invoiceDetail.sessionExpired
        : fetchError === 'network'
        ? t.invoiceDetail.networkError
        : t.invoiceDetail.notFound
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertTriangle className="h-8 w-8 mb-2 text-yellow-500" />
        <p>{errorMsg}</p>
        <Link href="/invoices"><Button variant="outline" className="mt-4">{t.common.back}</Button></Link>
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
              <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.ocrAccuracy}</p>
              <ConfidenceBar value={invoice.ocrConfidence} />
            </div>
          )}

          {/* Vendor & Dates */}
          <div className="bg-white rounded-xl border p-4 space-y-4">
            <div className="flex items-start gap-2">
              <Building2 className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{invoice.vendor?.name}</p>
                {invoice.vendor?.npwp && <p className="text-xs text-gray-500">{t.invoiceDetail.npwp}: {invoice.vendor.npwp}</p>}
                <p className="text-xs text-gray-500 mt-0.5">{t.invoiceDetail.billTo}: {invoice.company?.name ?? '—'}</p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" /> {t.invoiceDetail.invoiceDate}</p>
                <p className="text-sm font-medium text-gray-700 mt-0.5">{formatDate(invoice.invoiceDate)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" /> {t.invoiceDetail.dueDate}</p>
                <p className={`text-sm font-medium mt-0.5 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                  {formatDate(invoice.dueDate)}
                  {overdue && <span className="block text-xs text-red-500">{t.invoiceDetail.overdue}</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">{t.invoiceDetail.financialSummary}</p>
            <div className="space-y-2">
              {invoice.subtotal && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t.invoiceDetail.subtotal}</span>
                  <span className="text-gray-700">{formatIDR(invoice.subtotal)}</span>
                </div>
              )}
              {invoice.taxAmount && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t.invoiceDetail.vat}</span>
                  <span className="text-gray-700">{formatIDR(invoice.taxAmount)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span className="text-gray-800">{t.invoiceDetail.total}</span>
                <span className="text-blue-700">{formatIDR(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>

          {/* Payment */}
          {invoice.status === 'PAID' ? (
            <div className="bg-white rounded-xl border p-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <Banknote className="h-3 w-3" /> {t.invoiceDetail.payment}
              </p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t.invoiceDetail.paidDate}</span>
                <span className="text-gray-700 font-medium">{formatDate(invoice.paidDate)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t.invoiceDetail.paidAmount}</span>
                <span className="text-gray-700 font-medium">{formatIDR(invoice.paidAmount)}</span>
              </div>
              {invoice.paidBy && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t.invoiceDetail.markedBy}</span>
                  <span className="text-gray-700">{invoice.paidBy.name}</span>
                </div>
              )}
            </div>
          ) : canMarkPaid ? (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <Banknote className="h-3 w-3" /> {t.invoiceDetail.markAsPaid}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.paidDate}</label>
                  <input
                    type="date"
                    value={paidDateInput}
                    onChange={e => setPaidDateInput(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.paidAmount}</label>
                  <input
                    type="number"
                    value={paidAmountInput}
                    onChange={e => setPaidAmountInput(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              </div>
              <Button size="sm" onClick={handleMarkPaid} disabled={acting} className="w-full">{t.invoiceDetail.markAsPaid}</Button>
            </div>
          ) : null}

          {/* Line Items */}
          {invoice.items.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{t.invoiceDetail.invoiceItems}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-2 text-xs text-gray-500">{t.invoiceDetail.colDescription}</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500">{t.invoiceDetail.colQty}</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500 hidden sm:table-cell">{t.invoiceDetail.colPrice}</th>
                      <th className="text-right px-4 py-2 text-xs text-gray-500">{t.invoiceDetail.colTotal}</th>
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
            <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.deliveryAndPic}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1"><Send className="h-3 w-3" /> {t.invoiceDetail.sendDate}</label>
                <input
                  type="date"
                  value={sendDateInput}
                  onChange={e => setSendDateInput(e.target.value)}
                  disabled={!canEditSendDate}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1"><Truck className="h-3 w-3" /> {t.invoiceDetail.deliveredDate}</label>
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
                <label className="text-xs text-gray-400 flex items-center gap-1"><UserIcon className="h-3 w-3" /> {t.invoiceDetail.pic}</label>
                <select
                  value={picId}
                  onChange={e => setPicId(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{t.common.unassigned}</option>
                  {gaStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            ) : role !== 'VENDOR' ? (
              <p className="text-sm text-gray-600"><UserIcon className="h-3 w-3 inline mr-1" /> {t.invoiceDetail.picLabel}: {invoice.pic?.name ?? '—'}</p>
            ) : null}
            {(canEditSendDate || canEditDelivery) && (
              <Button size="sm" onClick={handleDeliverySave} disabled={acting}>{t.invoiceDetail.saveDeliveryInfo}</Button>
            )}
          </div>

          {/* Fix & Resubmit (REVISION) */}
          {canResubmit && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.fixAndResubmit}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.invoiceNumber}</label>
                  <input
                    type="text"
                    value={revNumber}
                    onChange={e => setRevNumber(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.invoiceDate}</label>
                  <input
                    type="date"
                    value={revInvoiceDate}
                    onChange={e => setRevInvoiceDate(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.dueDate}</label>
                  <input
                    type="date"
                    value={revDueDate}
                    onChange={e => setRevDueDate(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.subtotal}</label>
                  <input
                    type="number"
                    value={revSubtotal}
                    onChange={e => setRevSubtotal(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{t.upload.fieldTaxAmount}</label>
                  <input
                    type="number"
                    value={revTax}
                    onChange={e => setRevTax(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.total}</label>
                  <input
                    type="number"
                    value={revTotal}
                    onChange={e => setRevTotal(e.target.value)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400">{t.invoiceDetail.notes}</label>
                <textarea
                  rows={2}
                  value={revNotes}
                  onChange={e => setRevNotes(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <Button onClick={handleResubmit} disabled={acting} className="w-full">{t.invoiceDetail.saveAndResubmit}</Button>
            </div>
          )}
          {canUpdateStatus && transitionOptions.length > 0 && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.updateStatus}</p>
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t.invoiceDetail.selectNewStatus}</option>
                {transitionOptions.map(s => <option key={s} value={s}>{(t.status as Record<string, string>)[s] ?? s}</option>)}
              </select>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                placeholder={t.invoiceDetail.commentPlaceholder}
                rows={2}
                value={comment}
                onChange={e => setComment(e.target.value)}
              />
              <Button onClick={handleStatusUpdate} disabled={acting || !newStatus} className="w-full">{t.invoiceDetail.update}</Button>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-400 mb-1">{t.invoiceDetail.notes}</p>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
