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
import { PICStageBadge, PIC_STAGE_ORDER } from '@/components/invoice/PICStageBadge'
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
  poNumber: string | null
  status: string
  picStage: string
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
  documents?: {
    id: string
    type: string
    filePath: string
    fileType: string
    originalName: string
    classificationConfidence: number | null
  }[]
  stageHistory: {
    id: string
    stage: string
    changedAt: string
    changedById: string | null
    changedBy?: { name: string; email?: string | null } | null
  }[]
}

import { formatIDR, formatDate, formatDateTime, isOverdue, jakartaDayStart } from '@/lib/format'
import { VALID_TRANSITIONS } from '@/lib/invoiceStatus'

function ConfidenceBar({ value }: { value: number }) {
  const { t } = useI18n()
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const label = value >= 80 ? t.invoiceDetail.confidenceHigh : value >= 50 ? t.invoiceDetail.confidenceMedium : t.invoiceDetail.confidenceLow
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

// Renders one file. Split out of DocumentViewer so each tab gets its own
// page-number state — sharing one counter across documents left tab 2 opening
// on tab 1's page number.
function DocumentPreview({ fileUrl, fileType, alt }: { fileUrl: string; fileType: string; alt: string }) {
  const [numPages, setNumPages] = useState<number>(1)
  const [pageNumber, setPageNumber] = useState(1)
  const { t } = useI18n()

  if (['jpg', 'jpeg', 'png'].includes(fileType)) {
    return (
      <div className="rounded-xl overflow-hidden border bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrl} alt={alt} className="w-full h-auto object-contain max-h-[700px]" />
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
          error={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">{t.invoiceDetail.pdfLoadFailed}</div>}
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
          <span className="text-sm text-gray-500">{t.invoiceDetail.pdfPage.replace('{page}', String(pageNumber)).replace('{pages}', String(numPages))}</span>
          <Button variant="outline" size="icon" onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function DocumentViewer({ invoice, canEdit, onChanged }: { invoice: Invoice; canEdit: boolean; onChanged: () => void }) {
  const [active, setActive] = useState(0)
  const { t } = useI18n()

  const documents = invoice.documents ?? []

  // Falls back to the legacy single Invoice.filePath for rows predating
  // invoice_documents that somehow weren't backfilled.
  if (documents.length === 0) {
    if (!invoice.filePath || !invoice.fileType) {
      return (
        <div className="flex flex-col items-center justify-center h-64 bg-gray-50 rounded-xl border-2 border-dashed text-gray-400">
          <FileText className="h-10 w-10 mb-2" />
          <p className="text-sm">{t.invoiceDetail.noDocument}</p>
        </div>
      )
    }
    return (
      <DocumentPreview
        fileUrl={`/api/invoices/${invoice.id}/file`}
        fileType={invoice.fileType}
        alt={invoice.invoiceNumber}
      />
    )
  }

  const current = documents[Math.min(active, documents.length - 1)]

  async function reclassify(documentId: string, type: string) {
    const res = await fetch(`/api/invoices/${invoice.id}/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
    if (!res.ok) {
      toast.error(t.upload.docTypeUpdateFailed)
      return
    }
    onChanged()
  }

  return (
    <div className="space-y-3">
      {documents.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {documents.map((doc, i) => (
            <button
              key={doc.id}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                i === active
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {(t.documentType as Record<string, string>)[doc.type] ?? doc.type}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="min-w-0 truncate" title={current.originalName}>{current.originalName}</span>
        {canEdit ? (
          <select
            value={current.type}
            onChange={(e) => reclassify(current.id, e.target.value)}
            aria-label={t.upload.docTypeLabel}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          >
            {['INVOICE', 'TAX_INVOICE', 'BAST', 'OTHER'].map((k) => (
              <option key={k} value={k}>{(t.documentType as Record<string, string>)[k] ?? k}</option>
            ))}
          </select>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
            {(t.documentType as Record<string, string>)[current.type] ?? current.type}
          </span>
        )}
        {current.classificationConfidence !== null && current.classificationConfidence !== undefined && (
          <span className="tabular-nums text-[10px] text-gray-400" title={t.upload.docTypeAiHint}>
            AI {Math.round(current.classificationConfidence)}%
          </span>
        )}
      </div>

      <DocumentPreview
        key={current.id}
        fileUrl={`/api/invoices/${invoice.id}/documents/${current.id}/file`}
        fileType={current.fileType}
        alt={current.originalName}
      />
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
  const [newStage, setNewStage] = useState('')
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)
  const [gaStaff, setGaStaff] = useState<{ id: string; name: string }[]>([])
  const [sendDateInput, setSendDateInput] = useState('')
  const [deliveredDateInput, setDeliveredDateInput] = useState('')
  const [picId, setPicId] = useState('')
  const [paidDateInput, setPaidDateInput] = useState('')
  const [paidAmountInput, setPaidAmountInput] = useState('')
  const [now] = useState(() => Date.now()) // frozen at mount — Date.now() can't be called during render

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
        // Jakarta's calendar date, not the UTC one: before 07:00 WIB
        // `new Date().toISOString()` is still yesterday, so the payment was
        // pre-filled — and recorded, if nobody noticed — one day early.
        setPaidDateInput(data.paidDate?.slice(0, 10) ?? jakartaDayStart().toISOString().slice(0, 10))
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
  // Status + PIC stage are both ADMIN/GA-only controls; VENDOR sees read-only badges.
  const canUpdateStatus = ['GA_STAFF', 'GA_MANAGER', 'ADMIN'].includes(role ?? '')
  const canManageStage = canUpdateStatus
  const canEditDelivery = ['GA_STAFF', 'GA_MANAGER', 'ADMIN'].includes(role ?? '')
  const canEditSendDate = canEditDelivery || (role === 'VENDOR' && isOwner)
  // PAYMENT_SCHEDULED -> PAID is the only valid entry into PAID (see
  // VALID_TRANSITIONS); the dedicated form collects paidDate/paidAmount.
  const canMarkAccepted = canUpdateStatus && invoice?.status === 'PAYMENT_SCHEDULED'

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

  const handleStageUpdate = async () => {
    if (!newStage) { toast.error(t.invoiceDetail.selectNewStage); return }
    setActing(true)
    const res = await fetch(`/api/invoices/${id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage }),
    })
    setActing(false)
    if (res.ok) {
      toast.success(t.invoiceDetail.stageUpdated)
      setNewStage('')
      fetchInvoice()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.invoiceDetail.stageUpdateFailed)
    }
  }

  const handleMarkAccepted = () => {
    if (!paidAmountInput || Number(paidAmountInput) <= 0) {
      toast.error(t.invoiceDetail.validPaidAmount)
      return
    }
    // The server rejects a partial settlement (PAID drops out of every payable
    // KPI, so a remainder would vanish silently). Caught here too, to explain
    // it before the round-trip rather than as a bare 400.
    if (invoice && Math.abs(Number(paidAmountInput) - Number(invoice.totalAmount)) > 1) {
      toast.error(t.invoiceDetail.paidAmountMustMatchTotal)
      return
    }
    patchInvoice(
      { status: 'PAID', paidDate: paidDateInput || undefined, paidAmount: Number(paidAmountInput) },
      t.invoiceDetail.markAsAccepted,
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
        <div className="flex items-center gap-2">
          <StatusBadge status={invoice.status} />
          <PICStageBadge stage={invoice.picStage} />
        </div>
      </div>

      {/* Main split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: Document (sticky on desktop) */}
        <div className="lg:sticky lg:top-4">
          <DocumentViewer invoice={invoice} canEdit={canManageStage} onChanged={fetchInvoice} />
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
                {invoice.poNumber && <p className="text-xs text-gray-500">{t.invoiceDetail.poNumber}: <span className="font-mono">{invoice.poNumber}</span></p>}
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

          {/* Payment — paidDate is the source of truth (set once, on -> PAID;
              stays set through -> CLOSED), not the current status string. */}
          {invoice.paidDate ? (
            <div className="bg-white rounded-xl border p-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <Banknote className="h-3 w-3" /> {t.invoiceDetail.payment}
              </p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t.invoiceDetail.acceptedDate}</span>
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
          ) : canMarkAccepted ? (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <Banknote className="h-3 w-3" /> {t.invoiceDetail.markAsAccepted}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">{t.invoiceDetail.acceptedDate}</label>
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
              <Button size="sm" onClick={handleMarkAccepted} disabled={acting} className="w-full">{t.invoiceDetail.markAsAccepted}</Button>
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

          {/* Status control (ADMIN/GA only) — dropdown offers only statuses
              the server will actually accept (VALID_TRANSITIONS), so the UI
              never dangles a choice that 400s. ADMIN sees every status,
              matching its server-side bypass of the transition graph. */}
          {canUpdateStatus && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.updateStatus}</p>
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t.invoiceDetail.selectNewStatus}</option>
                {(role === 'ADMIN' ? Object.keys(t.status) : (VALID_TRANSITIONS[invoice.status] ?? [])).map(
                  s => <option key={s} value={s}>{(t.status as Record<string, string>)[s] ?? s}</option>,
                )}
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

          {/* PIC Stage control (ADMIN/GA only) */}
          {canManageStage && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.picStageTitle}</p>
              <select
                value={newStage}
                onChange={e => setNewStage(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t.invoiceDetail.selectNewStage}</option>
                {PIC_STAGE_ORDER.map(s => <option key={s} value={s}>{(t.picStage as Record<string, string>)[s] ?? s}</option>)}
              </select>
              <Button onClick={handleStageUpdate} disabled={acting || !newStage} className="w-full">{t.invoiceDetail.update}</Button>
            </div>
          )}

          {/* SLA timeline — stageHistory with auto-computed durations */}
          {invoice.stageHistory.length > 0 && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">{t.invoiceDetail.slaTitle}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t.invoiceDetail.slaSubtitle}</p>
              </div>
              <div>
                {invoice.stageHistory.map((h, i) => {
                  const isCurrent = i === invoice.stageHistory.length - 1
                  const prev = invoice.stageHistory[i - 1]
                  const durDays = prev
                    ? Math.floor((new Date(h.changedAt).getTime() - new Date(prev.changedAt).getTime()) / 86400000)
                    : null
                  const ongoingDays = isCurrent ? Math.floor((now - new Date(h.changedAt).getTime()) / 86400000) : null
                  const durLabel = prev
                    ? durDays !== null && durDays <= 0
                      ? t.invoiceDetail.stageDurationZero
                      : t.invoiceDetail.stageDurationDays.replace('{count}', String(durDays))
                    : '—'
                  const ongoingLabel = ongoingDays !== null
                    ? ongoingDays <= 0
                      ? t.invoiceDetail.stageDurationZero
                      : t.invoiceDetail.stageDurationOngoing.replace('{count}', String(ongoingDays))
                    : null
                  return (
                    <div key={h.id} className="relative pl-5 pb-4 last:pb-0">
                      {!isCurrent && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />}
                      <span
                        className={`absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full ${
                          isCurrent ? 'bg-amber-400 ring-4 ring-amber-400/20' : 'bg-teal-500 ring-4 ring-teal-500/15'
                        }`}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {(t.picStage as Record<string, string>)[h.stage] ?? h.stage}
                        </span>
                        <span className="text-[11px] text-gray-400 tabular-nums">{formatDateTime(h.changedAt)}</span>
                        <span
                          className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ${
                            isCurrent
                              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800'
                          }`}
                        >
                          {isCurrent ? ongoingLabel : durLabel}
                        </span>
                      </div>
                      {h.changedBy?.name && <p className="text-[11px] text-gray-400 mt-0.5">{h.changedBy.name}</p>}
                    </div>
                  )
                })}
              </div>
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
