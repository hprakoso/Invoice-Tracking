'use client'

import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Upload, FileText, Image as ImageIcon, CheckCircle, AlertTriangle, Loader2, ArrowLeft, Plus, X, Lock, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/hooks/useI18n'
import type { Dictionary } from '@/lib/i18n'
import { formatIDR, parseAmountID } from '@/lib/format'
import {
  ACCEPTED_MIME_TYPES,
  DROPZONE_ACCEPT,
  MAX_DOCUMENTS_PER_INVOICE,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
} from '@/lib/uploadLimits'

interface ExtractedField {
  key: string
  label: string
  value: string | null
  confidence: number
}

interface LineItem {
  description: string
  quantity: number | null
  unit_price: number | null
  total: number
}

// Matches the server's field order in GET /api/invoices/[id]/ocr — used to
// populate empty, manually-fillable fields when OCR produces nothing (either
// it failed outright, or no uploaded document could be identified as the
// invoice), so review never shows a blank form.
const FIELD_DEFS: { key: string; labelKey: keyof Dictionary['upload'] }[] = [
  { key: 'vendor_name', labelKey: 'fieldVendorName' },
  { key: 'invoice_number', labelKey: 'fieldInvoiceNumber' },
  { key: 'po_number', labelKey: 'fieldPoNumber' },
  { key: 'invoice_date', labelKey: 'fieldInvoiceDate' },
  { key: 'due_date', labelKey: 'fieldDueDate' },
  { key: 'currency', labelKey: 'fieldCurrency' },
  { key: 'subtotal', labelKey: 'fieldSubtotal' },
  { key: 'tax_amount', labelKey: 'fieldTaxAmount' },
  { key: 'total_amount', labelKey: 'fieldTotalAmount' },
]

// STEP 1 upload -> STEP 2 processing (uploading + ocr) -> STEP 3 review -> STEP 4 done.
type UploadStage = 'upload' | 'uploading' | 'ocr' | 'review' | 'done'

const DOC_TYPE_KEYS = ['INVOICE', 'TAX_INVOICE', 'BAST', 'OTHER'] as const

// One row of the documents list. Mirrors the InvoiceDocument the upload route
// returns.
interface UploadedDoc {
  id: string
  type: string
  originalName: string
  classificationConfidence: number | null
}

// The server's bill-to resolution: what it read off the document, and which
// Company row (if any) that resolved to.
interface CompanyMatch {
  companyId: string | null
  status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS'
  matchedOn: 'npwp' | 'name' | null
  extractedName: string | null
  extractedNpwp: string | null
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const color =
    confidence >= 80 ? 'bg-green-500' : confidence >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const textColor =
    confidence >= 80 ? 'text-green-600' : confidence >= 50 ? 'text-yellow-600' : 'text-red-600'
  return (
    <div className="flex items-center gap-2 mt-0.5">
      <div className="flex-1 bg-gray-200 rounded-full h-1.5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${confidence}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`h-1.5 rounded-full ${color}`}
        />
      </div>
      <span className={`text-xs font-medium ${textColor}`}>{confidence.toFixed(0)}%</span>
    </div>
  )
}

function ExtractedFieldCard({ field }: { field: ExtractedField }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg p-3"
    >
      <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">{field.label}</p>
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{field.value ?? '—'}</p>
      <ConfidenceBar confidence={field.confidence} />
    </motion.div>
  )
}

export default function UploadPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { t } = useI18n()
  const role = (session?.user as { role?: string })?.role
  const isVendor = role === 'VENDOR'
  const isGaStaff = role === 'GA_STAFF'
  // GA_MANAGER shares GA_STAFF's PIC-assignment permission but isn't
  // auto-assigned as PIC on load — that default only fits the person who
  // actually receives the hardcopy.
  const canAssignPic = isGaStaff || role === 'GA_MANAGER'
  const sessionVendorId = (session?.user as { vendorId?: string | null })?.vendorId

  const [stage, setStage] = useState<UploadStage>('upload')
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [companyIdValue, setCompanyIdValue] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [sessionVendorName, setSessionVendorName] = useState('')

  // Files staged in the browser before anything is sent. The whole set is
  // uploaded in one action, so nothing reaches the server until the user is
  // done attaching.
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [docs, setDocs] = useState<UploadedDoc[]>([])
  const [uploadingExtra, setUploadingExtra] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [fields, setFields] = useState<ExtractedField[]>([])
  const [ocrFailed, setOcrFailed] = useState(false)
  // No uploaded document could be confidently identified as the invoice, so
  // extraction never ran. Distinct from ocrFailed: nothing went wrong, the
  // set just doesn't say which file to read.
  const [needsInvoiceSelection, setNeedsInvoiceSelection] = useState(false)
  const [drivingDocumentId, setDrivingDocumentId] = useState<string | null>(null)
  const [companyMatch, setCompanyMatch] = useState<CompanyMatch | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [overallConfidence, setOverallConfidence] = useState(0)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [editableValues, setEditableValues] = useState<Record<string, string>>({})
  const [sendDateValue, setSendDateValue] = useState('')
  const [gaStaff, setGaStaff] = useState<{ id: string; name: string }[]>([])
  const [picIdValue, setPicIdValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isGaStaff) setPicIdValue(session?.user?.id ?? '')
    if (['ADMIN', 'GA_STAFF', 'GA_MANAGER'].includes(role ?? '')) {
      fetch('/api/users?role=GA_STAFF').then(r => r.json()).then((d: unknown) => setGaStaff(Array.isArray(d) ? d : []))
      fetch('/api/vendors').then(r => r.json()).then((d: unknown) => setVendors(Array.isArray(d) ? d : []))
    }
    fetch('/api/companies').then(r => r.json()).then((d: unknown) => setCompanies(Array.isArray(d) ? d : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  // A vendor never picks their vendor — it comes from the account. Fetched only
  // to display the name; the id that matters is the one the server derives from
  // the session, never this.
  useEffect(() => {
    if (!isVendor || !sessionVendorId) return
    fetch(`/api/vendors/${sessionVendorId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string } | null) => {
        if (d?.name) setSessionVendorName(d.name)
      })
      .catch(() => {})
  }, [isVendor, sessionVendorId])

  // The vendor's own id for VENDOR callers, or whichever vendor a GA/Admin
  // picked. Never defaults to "the first vendor in the list" — that was a real
  // bug (wrong vendor billed). For a VENDOR the server ignores whatever is sent
  // and uses the session's vendor regardless, so this is display/guard only.
  const effectiveVendorId = isVendor ? sessionVendorId : selectedVendorId
  const selectedVendorName = isVendor
    ? sessionVendorName
    : vendors.find((v) => v.id === selectedVendorId)?.name

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return
    const accepted: File[] = []
    for (const f of incoming) {
      if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(f.type)) {
        toast.error(t.upload.fileTypeRejected.replace('{name}', f.name))
        continue
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        toast.error(t.upload.fileTooLarge.replace('{name}', f.name).replace('{max}', MAX_FILE_SIZE_LABEL))
        continue
      }
      accepted.push(f)
    }
    setStagedFiles((prev) => {
      // Counts documents already stored on the draft, not just what is staged:
      // a retry after a partial upload has rows on the server that the route's
      // own cap will count, so ignoring them here would let the user stage
      // files that are then rejected one by one.
      const room = MAX_DOCUMENTS_PER_INVOICE - prev.length - docs.length
      if (accepted.length > room) {
        toast.error(t.upload.tooManyFiles.replace('{max}', String(MAX_DOCUMENTS_PER_INVOICE)))
      }
      return [...prev, ...accepted.slice(0, Math.max(0, room))]
    })
  }

  // Not useCallback: react-dropzone re-subscribes fine on a new callback each
  // render, and a memoized-with-[] version froze this closure's state at its
  // initial value forever.
  function onDrop(accepted: File[]) {
    addFiles(accepted)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    multiple: true,
    maxFiles: MAX_DOCUMENTS_PER_INVOICE,
    disabled: stage !== 'upload',
  })

  function fallbackToManualFields() {
    setFields((prev) =>
      prev.length > 0 ? prev : FIELD_DEFS.map((f) => ({ key: f.key, label: t.upload[f.labelKey], value: null, confidence: 0 })),
    )
  }

  // The invoice's documents as the server actually holds them. Reuses the
  // detail endpoint rather than adding a list route — it already returns
  // `documents[]` ordered by creation.
  async function refreshDocs(id: string) {
    const res = await fetch(`/api/invoices/${id}`)
    if (!res.ok) return
    const invoice: { documents?: UploadedDoc[] } = await res.json()
    if (Array.isArray(invoice.documents)) setDocs(invoice.documents)
  }

  /**
   * STEP 2. Creates the draft row, uploads every staged file, then streams the
   * OCR result. The row has to exist before the uploads (each file attaches to
   * its id), but it isn't an invoice until the review step is confirmed — until
   * then `isDraft` keeps it out of every KPI, list, export and reminder, so
   * abandoning the wizard leaves nothing behind that anyone has to chase.
   */
  async function processDocuments() {
    if (stagedFiles.length === 0) {
      toast.error(t.upload.noFilesSelected)
      return
    }
    if (!isVendor && !selectedVendorId) {
      toast.error(t.upload.vendorRequired)
      return
    }

    setStage('uploading')
    setStatusMsg(t.upload.creatingRecord)
    setFields([])
    setLineItems([])
    setOcrFailed(false)
    setNeedsInvoiceSelection(false)

    try {
      if (!effectiveVendorId) throw new Error(t.upload.vendorNotSelected)

      // Created once. Retrying after a failed upload/OCR reuses the row from
      // the previous attempt instead of orphaning it — re-POSTing here would
      // leave a stray placeholder invoice behind on every retry. Cleared only
      // by resetWizard().
      let id = invoiceId
      if (!id) {
        const createRes = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vendorId: effectiveVendorId,
            invoiceNumber: `DRAFT-${Date.now()}`,
            totalAmount: 0,
            // No companyId and no poNumber: both are read off the documents (or
            // typed at the confirmation step) and neither exists yet. The
            // server fills a PO placeholder and refuses to let the draft go
            // live still carrying it.
            isDraft: true,
          }),
        })
        if (!createRes.ok) throw new Error(t.upload.createFailed)
        const invoice = await createRes.json()
        id = invoice.id as string
        setInvoiceId(id)
      }

      // Uploaded one request each — the route already validates and classifies
      // a single file, and for the handful a submission carries, N requests
      // beats a new batch endpoint. Sequential so a partial failure is
      // attributable to a named file.
      //
      // Each file is isolated in its own try: a thrown fetch (offline, reset
      // connection, restarted server) must not abort the files after it. Every
      // failure is kept in `failed`, and only those stay staged — retrying
      // then re-uploads exactly what is missing instead of duplicating the
      // documents that already landed, since the route has no idempotency key
      // and would happily create a second row per file.
      let uploadedCount = 0
      const failed: File[] = []
      for (const [i, f] of stagedFiles.entries()) {
        setStatusMsg(
          t.upload.uploadingProgress
            .replace('{current}', String(i + 1))
            .replace('{total}', String(stagedFiles.length)),
        )
        const fd = new FormData()
        fd.append('file', f)
        try {
          const res = await fetch(`/api/invoices/${id}/upload`, { method: 'POST', body: fd })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            toast.error(`${f.name}: ${data.error ?? t.upload.uploadFailed}`)
            failed.push(f)
            continue
          }
          await res.json()
          uploadedCount++
        } catch {
          toast.error(`${f.name}: ${t.upload.uploadFailed}`)
          failed.push(f)
        }
      }
      setStagedFiles(failed)

      if (uploadedCount === 0) throw new Error(t.upload.uploadFailed)

      // Read the document list back from the server rather than trusting what
      // this run happened to upload. A previous partially-failed attempt can
      // have left rows on the same draft, and a list built only from this
      // attempt's responses would hide them — leaving documents the user
      // cannot see, relabel or remove, which then surface after submit.
      await refreshDocs(id)
      // Everything that follows is post-upload: the files are safely stored, so
      // any failure from here falls back to manual entry on the review step and
      // never back to the file picker.
      runExtraction(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.common.unknownError
      toast.error(msg)
      setStage('upload')
    }
  }

  /**
   * Opens the OCR stream. With no documentId the server picks the document it
   * classified as the invoice; with one, it reads exactly that document — the
   * path taken when the user resolves an unidentified set on the review step.
   */
  function runExtraction(id: string, documentId?: string) {
    setStage('ocr')
    setStatusMsg(documentId ? t.upload.reExtracting : t.upload.classifyingDocuments)
    setOcrFailed(false)
    setNeedsInvoiceSelection(false)
    setFields([])
    setLineItems([])

    const url = documentId
      ? `/api/invoices/${id}/ocr?documentId=${encodeURIComponent(documentId)}`
      : `/api/invoices/${id}/ocr`
    const es = new EventSource(url)

    es.addEventListener('status', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setStatusMsg(d.message)
    })

    es.addEventListener('driving_document', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setDrivingDocumentId(d.documentId)
    })

    // No document could be identified as the invoice. Nothing was extracted on
    // purpose — reading the bill-to and PO off a faktur pajak or a BAST would
    // produce confidently wrong data. The review step asks the user which file
    // is the invoice and re-runs against it.
    es.addEventListener('needs_invoice_selection', () => {
      setNeedsInvoiceSelection(true)
      setDrivingDocumentId(null)
      fallbackToManualFields()
      setStage('review')
      es.close()
    })

    es.addEventListener('document_type', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setDocs((prev) =>
        prev.map((doc) =>
          doc.id === d.documentId
            ? { ...doc, type: d.type, classificationConfidence: d.confidence }
            : doc,
        ),
      )
    })

    es.addEventListener('company', (e) => {
      const d: CompanyMatch = JSON.parse((e as MessageEvent).data)
      setCompanyMatch(d)
      // Pre-selection only — the user can still change it below.
      if (d.companyId) setCompanyIdValue(d.companyId)
    })

    es.addEventListener('field', (e) => {
      const d: ExtractedField = JSON.parse((e as MessageEvent).data)
      setFields((prev) => [...prev, d])
      setEditableValues((prev) => ({ ...prev, [d.key]: d.value ?? '' }))
    })

    es.addEventListener('line_items', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setLineItems(d.items ?? [])
    })

    es.addEventListener('done', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setOverallConfidence(d.overallConfidence ?? 0)
      setStatusMsg(d.message)
      setStage('review')
      es.close()
      toast.success(t.upload.ocrComplete)
    })

    es.addEventListener('error', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data ?? '{}')
        setStatusMsg(d.message ?? t.upload.ocrFailedStatus)
      } catch {
        setStatusMsg(t.upload.ocrFailedStatus)
      }
      setStage('review')
      setOcrFailed(true)
      fallbackToManualFields()
      es.close()
      toast.error(t.upload.ocrFailedToast)
    })

    es.onerror = () => {
      setStage('review')
      setOcrFailed(true)
      fallbackToManualFields()
      es.close()
      toast.error(t.upload.connectionLost)
    }
  }

  // Adding a document from the review step, after the initial batch.
  async function uploadMoreDocs(files: File[]) {
    if (!invoiceId || files.length === 0) return
    if (docs.length + files.length > MAX_DOCUMENTS_PER_INVOICE) {
      toast.error(t.upload.tooManyFiles.replace('{max}', String(MAX_DOCUMENTS_PER_INVOICE)))
      return
    }
    setUploadingExtra(true)
    for (const f of files) {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch(`/api/invoices/${invoiceId}/upload`, { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(`${f.name}: ${data.error ?? t.upload.uploadFailed}`)
        continue
      }
      const doc: UploadedDoc = await res.json()
      setDocs((prev) => [...prev, doc])
    }
    setUploadingExtra(false)
  }

  async function changeDocType(documentId: string, type: string) {
    const res = await fetch(`/api/invoices/${invoiceId}/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
    if (!res.ok) {
      toast.error(t.upload.docTypeUpdateFailed)
      return
    }
    // Confidence is cleared server-side once a human sets the type, so the
    // row stops rendering as an AI guess — and the OCR route treats that null
    // as "a person decided this" and won't overwrite it.
    setDocs((prev) =>
      prev.map((d) => (d.id === documentId ? { ...d, type, classificationConfidence: null } : d)),
    )
  }

  async function removeDoc(documentId: string) {
    const res = await fetch(`/api/invoices/${invoiceId}/documents/${documentId}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error(t.upload.docRemoveFailed)
      return
    }
    setDocs((prev) => prev.filter((d) => d.id !== documentId))
    if (drivingDocumentId === documentId) setDrivingDocumentId(null)
  }

  // Resolves the "which file is the invoice?" state: extraction re-runs against
  // whichever document the user marked INVOICE.
  function extractFromSelectedInvoice() {
    const target = docs.find((d) => d.type === 'INVOICE')
    if (!invoiceId || !target) {
      toast.error(t.upload.noInvoiceSelected)
      return
    }
    runExtraction(invoiceId, target.id)
  }

  async function confirmAndSubmit() {
    if (!invoiceId) return

    // The confirmation step is the last place these can be corrected, and the
    // server rejects the draft->live transition without them. Checked here too
    // so the user gets a pointed message instead of a generic 400.
    if (docs.length === 0) {
      toast.error(t.upload.noDocumentsAttached)
      return
    }
    const invoiceNumber = editableValues['invoice_number']?.trim()
    if (!invoiceNumber) {
      toast.error(t.upload.invoiceNumberRequiredConfirm)
      return
    }
    const poNumber = editableValues['po_number']?.trim()
    if (!poNumber) {
      toast.error(t.upload.poRequiredConfirm)
      return
    }
    if (!companyIdValue) {
      toast.error(t.upload.companyRequiredConfirm)
      return
    }

    const vendorNameField = editableValues['vendor_name']
    const totalField = editableValues['total_amount']

    setSubmitting(true)
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceNumber,
        poNumber,
        companyId: companyIdValue,
        invoiceDate: editableValues['invoice_date'] || null,
        dueDate: editableValues['due_date'] || null,
        // parseAmountID, not parseFloat: '1.500.000' is one and a half million
        // here, and `?? null` rather than `|| null` so a genuine 0 (a
        // tax-exempt invoice) is stored as 0 instead of "unknown".
        totalAmount: parseAmountID(totalField) ?? 0,
        taxAmount: parseAmountID(editableValues['tax_amount']),
        subtotal: parseAmountID(editableValues['subtotal']),
        notes: vendorNameField ? `Vendor: ${vendorNameField}` : null,
        sendDate: sendDateValue || null,
        picId: canAssignPic ? (picIdValue || null) : undefined,
        // Confirming the review is what turns the placeholder row into a real
        // invoice that the dashboard, lists and reminders can see.
        isDraft: false,
      }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.upload.submitFailed)
      return
    }

    // The server saves duplicates rather than rejecting the request, so a 200
    // isn't automatically a success — it may have come back force-REJECTED.
    const saved = await res.json().catch(() => ({}))
    if (saved.duplicateOf) {
      toast.error(t.upload.duplicateRejected.replace('{number}', saved.duplicateOf.invoiceNumber))
      router.push(`/invoices/${invoiceId}`) // detail page shows the rejection reason
      return
    }

    setStage('done')
    toast.success(t.upload.submitted)
    setTimeout(() => router.push('/invoices'), 1500)
  }

  function resetWizard() {
    setStage('upload')
    setStagedFiles([])
    setDocs([])
    setFields([])
    setOcrFailed(false)
    setNeedsInvoiceSelection(false)
    setDrivingDocumentId(null)
    setCompanyMatch(null)
    setLineItems([])
    setInvoiceId(null)
    setEditableValues({})
    setOverallConfidence(0)
    setCompanyIdValue('')
    setSelectedVendorId('')
  }

  const companyHint = !companyMatch
    ? null
    : companyMatch.status === 'MATCHED'
      ? companyMatch.matchedOn === 'npwp'
        ? t.upload.companyMatchedNpwp
        : t.upload.companyMatchedName
      : companyMatch.status === 'AMBIGUOUS'
        ? t.upload.companyAmbiguous
        : t.upload.companyUnmatched

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/invoices">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.upload.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.upload.subtitle}</p>
        </div>
      </div>

      {/* STEP 1: attach documents. No company, vendor or PO is asked for here —
          they come from the documents themselves (or from the account, for a
          vendor's own identity). The vendor picker below is shown only to staff
          uploading a hardcopy on a vendor's behalf, who have no vendor of their
          own on the session. */}
      {stage === 'upload' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t.upload.selectHeading}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.upload.selectSubheading}</p>
          </div>

          {!isVendor && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t.upload.vendorLabel}</label>
              <select
                value={selectedVendorId}
                onChange={(e) => setSelectedVendorId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t.upload.selectVendor}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          )}

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              isDragActive
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-gray-700'
            }`}
          >
            <input {...getInputProps()} />
            <motion.div
              animate={isDragActive ? { scale: 1.1 } : { scale: 1 }}
              transition={{ duration: 0.2 }}
            >
              <Upload className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
            </motion.div>
            <p className="text-base font-semibold text-gray-700 dark:text-gray-200">
              {isDragActive ? t.upload.dropActive : t.upload.dropIdle}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t.upload.orBrowse}</p>
            <div className="flex items-center justify-center gap-4 mt-4">
              {(['PDF', 'JPG', 'PNG'] as const).map((ext) => (
                <span
                  key={ext}
                  className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md px-2 py-1"
                >
                  {ext === 'PDF' ? (
                    <FileText className="h-3 w-3" />
                  ) : (
                    <ImageIcon className="h-3 w-3" />
                  )}
                  {ext}
                </span>
              ))}
            </div>
          </div>

          {stagedFiles.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t.upload.stagedFilesTitle} ({stagedFiles.length}/{MAX_DOCUMENTS_PER_INVOICE})
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.upload.stagedFilesHint}</p>
              </div>
              <ul className="space-y-2">
                {stagedFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border dark:border-gray-700 px-3 py-2">
                    <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{f.name}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      onClick={() => setStagedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={t.upload.removeStagedFile}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button onClick={processDocuments} disabled={stagedFiles.length === 0} className="w-full gap-2">
            <Sparkles className="h-4 w-4" />
            {t.upload.processDocuments}
          </Button>
        </motion.div>
      )}

      {/* STEP 2: upload + AI processing */}
      {(stage === 'uploading' || stage === 'ocr') && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{statusMsg}</p>
          </div>

          {docs.length > 0 && (
            <ul className="space-y-1 mb-6">
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-500" />
                  <span className="truncate">{doc.originalName}</span>
                  <span className="ml-auto text-xs">{t.documentType[doc.type as keyof typeof t.documentType]}</span>
                </li>
              ))}
            </ul>
          )}

          {fields.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t.upload.extractedData}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fields.map((field) => (
                  <ExtractedFieldCard key={field.key} field={field} />
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* STEP 3: review & confirm */}
      {stage === 'review' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t.upload.reviewStepTitle}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.upload.reviewStepSubtitle}</p>
          </div>

          {/* Banner: unidentified invoice > OCR failure > confidence */}
          {needsInvoiceSelection ? (
            <div className="rounded-xl px-4 py-3 flex items-start gap-3 bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {t.upload.needsInvoiceTitle}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  {t.upload.needsInvoiceBody}
                </p>
              </div>
            </div>
          ) : ocrFailed ? (
            <div className="rounded-xl px-4 py-3 flex items-center gap-3 bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  {t.upload.ocrFailedTitle}
                </p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t.upload.ocrFailedBody}
                </p>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-xl px-4 py-3 flex items-center gap-3 ${
                overallConfidence >= 80
                  ? 'bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800'
                  : 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
              }`}
            >
              {overallConfidence >= 80 ? (
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {overallConfidence >= 80 ? t.upload.extractionSuccess : t.upload.verifyData}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t.upload.overallAccuracy}: {overallConfidence.toFixed(0)}%
                </p>
              </div>
            </div>
          )}

          {/* Documents + their classification. Shown before the fields because
              which document is the invoice determines where the fields came
              from — and, when unidentified, has to be resolved first. */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t.upload.documentsTitle}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.upload.documentsHint}</p>
            </div>

            {docs.length > 0 && (
              <ul className="space-y-2">
                {docs.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg border dark:border-gray-700 px-3 py-2">
                    <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{doc.originalName}</span>
                    {doc.id === drivingDocumentId && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        {t.upload.drivingDocumentTag}
                      </span>
                    )}
                    <select
                      value={doc.type}
                      onChange={(e) => changeDocType(doc.id, e.target.value)}
                      aria-label={t.upload.docTypeLabel}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {DOC_TYPE_KEYS.map((k) => (
                        <option key={k} value={k}>{t.documentType[k]}</option>
                      ))}
                    </select>
                    {doc.classificationConfidence !== null && (
                      <span className="text-[10px] text-gray-400 tabular-nums" title={t.upload.docTypeAiHint}>
                        AI {Math.round(doc.classificationConfidence)}%
                      </span>
                    )}
                    <button
                      onClick={() => removeDoc(doc.id)}
                      aria-label={t.upload.docRemove}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t.common.delete}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed dark:border-gray-600 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                <Plus className="h-3.5 w-3.5" />
                {uploadingExtra ? t.upload.docUploading : t.upload.addSupportingDoc}
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  disabled={uploadingExtra}
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    e.target.value = '' // let the same file be re-picked after a failure
                    void uploadMoreDocs(files)
                  }}
                />
              </label>

              {needsInvoiceSelection && (
                <Button size="sm" onClick={extractFromSelectedInvoice} className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t.upload.runExtraction}
                </Button>
              )}
            </div>
          </div>

          {/* Company (from OCR, correctable) + vendor (from the account) */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t.upload.companySectionTitle} <span className="text-red-500">*</span>
              </label>
              <select
                value={companyIdValue}
                onChange={(e) => setCompanyIdValue(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t.upload.selectCompany}</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {companyMatch?.extractedName
                  ? t.upload.companyDetected.replace('{name}', companyMatch.extractedName)
                  : t.upload.companyNotDetected}
                {companyHint && ` · ${companyHint}`}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
                {isVendor && <Lock className="h-3 w-3" />} {t.upload.vendorSectionTitle}
              </label>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedVendorName ?? '—'}</p>
              {isVendor && <p className="text-xs text-gray-400 mt-0.5">{t.upload.vendorFromAccount}</p>}
            </div>
          </div>

          {/* Extracted / manual fields */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t.upload.reviewAndEdit}</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {field.label}
                    {(field.key === 'po_number' || field.key === 'invoice_number') && <span className="text-red-500"> *</span>}
                  </label>
                  <Input
                    value={editableValues[field.key] ?? ''}
                    onChange={(e) =>
                      setEditableValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="h-10 text-sm"
                  />
                  {!ocrFailed && !needsInvoiceSelection && <ConfidenceBar confidence={field.confidence} />}
                </div>
              ))}
            </div>

            {/* Line Items */}
            {lineItems.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    {t.upload.invoiceItems}
                  </p>
                  <div className="space-y-1">
                    {lineItems.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-300 flex-1 min-w-0 truncate">
                          {item.description}
                        </span>
                        <span className="text-gray-700 dark:text-gray-200 font-medium ml-4">
                          {formatIDR(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t.upload.sendDateLabel}</label>
              <input
                type="date"
                value={sendDateValue}
                onChange={(e) => setSendDateValue(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            {canAssignPic && (
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t.upload.picLabel}</label>
                <select
                  value={picIdValue}
                  onChange={(e) => setPicIdValue(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t.upload.picUnassigned}</option>
                  {gaStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={confirmAndSubmit} disabled={uploadingExtra || submitting || docs.length === 0} className="flex-1 gap-2">
              <CheckCircle className="h-4 w-4" />
              {t.upload.confirmAndSubmit}
            </Button>
            <Button variant="outline" onClick={resetWizard}>
              {t.upload.uploadAgain}
            </Button>
          </div>
        </motion.div>
      )}

      {/* STEP 4: done */}
      {stage === 'done' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-12"
        >
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.upload.doneTitle}</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2">{t.upload.doneSubtitle}</p>
        </motion.div>
      )}
    </div>
  )
}
