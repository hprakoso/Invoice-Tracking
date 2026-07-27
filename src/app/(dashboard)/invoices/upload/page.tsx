'use client'

import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Upload, FileText, Image as ImageIcon, CheckCircle, AlertTriangle, Loader2, ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/hooks/useI18n'
import type { Dictionary } from '@/lib/i18n'

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
// populate 8 empty, manually-fillable fields when OCR fails entirely (no
// 'field' events ever arrive), so review never shows a blank form.
const FIELD_DEFS: { key: string; labelKey: keyof Dictionary['upload'] }[] = [
  { key: 'vendor_name', labelKey: 'fieldVendorName' },
  { key: 'invoice_number', labelKey: 'fieldInvoiceNumber' },
  { key: 'invoice_date', labelKey: 'fieldInvoiceDate' },
  { key: 'due_date', labelKey: 'fieldDueDate' },
  { key: 'currency', labelKey: 'fieldCurrency' },
  { key: 'subtotal', labelKey: 'fieldSubtotal' },
  { key: 'tax_amount', labelKey: 'fieldTaxAmount' },
  { key: 'total_amount', labelKey: 'fieldTotalAmount' },
]

type UploadStage = 'select' | 'drop' | 'uploading' | 'ocr' | 'review' | 'done'

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

  const [stage, setStage] = useState<UploadStage>('select')
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [companyIdValue, setCompanyIdValue] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [fields, setFields] = useState<ExtractedField[]>([])
  const [ocrFailed, setOcrFailed] = useState(false)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [overallConfidence, setOverallConfidence] = useState(0)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [editableValues, setEditableValues] = useState<Record<string, string>>({})
  const [sendDateValue, setSendDateValue] = useState('')
  const [gaStaff, setGaStaff] = useState<{ id: string; name: string }[]>([])
  const [picIdValue, setPicIdValue] = useState('')

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

  // Resolved once the user leaves the 'select' stage: the vendor's own id for
  // VENDOR callers, or whichever vendor a GA/Admin picked. Never defaults to
  // "the first vendor in the list" — that was a real bug (wrong vendor billed).
  const effectiveVendorId = isVendor ? sessionVendorId : selectedVendorId

  function continueFromSelect() {
    if (!companyIdValue) {
      toast.error(t.upload.companyRequired)
      return
    }
    if (!isVendor && !selectedVendorId) {
      toast.error(t.upload.vendorRequired)
      return
    }
    setStage('drop')
  }

  // Not useCallback: react-dropzone re-subscribes fine on a new callback each
  // render, and a memoized-with-[] version froze this closure's companyIdValue
  // at its initial '' forever, so every drop sent companyId: '' regardless of
  // what the user picked in the select stage.
  async function onDrop(accepted: File[]) {
    const f = accepted[0]
    if (!f) return
    setFile(f)
    await runOCR(f)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 1,
    disabled: stage !== 'drop',
  })

  function fallbackToManualFields() {
    setOcrFailed(true)
    setFields((prev) =>
      prev.length > 0 ? prev : FIELD_DEFS.map((f) => ({ key: f.key, label: t.upload[f.labelKey], value: null, confidence: 0 })),
    )
  }

  async function runOCR(uploadFile: File) {
    setStage('uploading')
    setStatusMsg(t.upload.creatingRecord)
    setFields([])
    setLineItems([])
    setOcrFailed(false)

    try {
      if (!effectiveVendorId) throw new Error(t.upload.vendorNotSelected)

      // 1. Create invoice record (DRAFT — invisible everywhere until Submit)
      const createRes = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: effectiveVendorId,
          companyId: companyIdValue,
          invoiceNumber: `DRAFT-${Date.now()}`,
          totalAmount: 0,
        }),
      })
      if (!createRes.ok) throw new Error(t.upload.createFailed)
      const invoice = await createRes.json()
      const id: string = invoice.id
      setInvoiceId(id)

      // 2. Upload file
      setStatusMsg(t.upload.uploadingFile)
      const formData = new FormData()
      formData.append('file', uploadFile)
      const uploadRes = await fetch(`/api/invoices/${id}/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!uploadRes.ok) throw new Error(t.upload.uploadFailed)

      // 3. SSE OCR stream — the upload itself already succeeded at this point,
      // so any failure from here on falls back to manual entry (review stage
      // with empty fields), never back to 'drop'. The file stays uploaded.
      setStage('ocr')
      setStatusMsg(t.upload.startingOcr)

      const es = new EventSource(`/api/invoices/${id}/ocr`)

      es.addEventListener('status', (e) => {
        const d = JSON.parse((e as MessageEvent).data)
        setStatusMsg(d.message)
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
          setStatusMsg(d.message ?? 'OCR failed')
        } catch {
          setStatusMsg('OCR failed')
        }
        setStage('review')
        fallbackToManualFields()
        es.close()
        toast.error(t.upload.ocrFailedToast)
      })

      es.onerror = () => {
        setStage('review')
        fallbackToManualFields()
        es.close()
        toast.error(t.upload.connectionLost)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
      setStage('drop')
    }
  }

  async function confirmAndSubmit() {
    if (!invoiceId) return
    const vendorNameField = editableValues['vendor_name']
    const totalField = editableValues['total_amount']

    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'SUBMITTED',
        invoiceNumber: editableValues['invoice_number'] || `INV-${Date.now()}`,
        invoiceDate: editableValues['invoice_date'] || null,
        dueDate: editableValues['due_date'] || null,
        totalAmount:
          parseFloat(totalField?.replace(/[^0-9.]/g, '') ?? '0') || 0,
        taxAmount:
          parseFloat(editableValues['tax_amount']?.replace(/[^0-9.]/g, '') ?? '0') || null,
        subtotal:
          parseFloat(editableValues['subtotal']?.replace(/[^0-9.]/g, '') ?? '0') || null,
        notes: vendorNameField ? `Vendor: ${vendorNameField}` : null,
        sendDate: sendDateValue || null,
        picId: canAssignPic ? (picIdValue || null) : undefined,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.upload.submitFailed)
      return
    }

    setStage('done')
    toast.success(t.upload.submitted)
    setTimeout(() => router.push('/invoices'), 1500)
  }

  function resetWizard() {
    setStage('select')
    setFile(null)
    setFields([])
    setOcrFailed(false)
    setLineItems([])
    setInvoiceId(null)
    setEditableValues({})
    setOverallConfidence(0)
    setCompanyIdValue('')
    setSelectedVendorId('')
  }

  const selectedCompanyName = companies.find((c) => c.id === companyIdValue)?.name
  const selectedVendorName = isVendor
    ? undefined
    : vendors.find((v) => v.id === selectedVendorId)?.name

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

      {/* Step 1: Select company + vendor */}
      {stage === 'select' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-5 sm:p-6 space-y-4"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t.upload.selectHeading}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.upload.selectSubheading}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t.upload.companyLabel}</label>
            <select
              value={companyIdValue}
              onChange={(e) => setCompanyIdValue(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t.upload.selectCompany}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {!isVendor && (
            <div>
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
          <Button onClick={continueFromSelect} className="w-full gap-2">
            {t.upload.continue} <ArrowRight className="h-4 w-4" />
          </Button>
        </motion.div>
      )}

      {/* Drop Zone */}
      {stage === 'drop' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg px-3 py-2">
            <span>{t.upload.billTo}: <strong className="text-gray-700 dark:text-gray-200">{selectedCompanyName}</strong></span>
            {selectedVendorName && <span>· {t.upload.vendorTag}: <strong className="text-gray-700 dark:text-gray-200">{selectedVendorName}</strong></span>}
            <button onClick={() => setStage('select')} className="ml-auto text-blue-600 hover:underline">{t.upload.change}</button>
          </div>
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
        </motion.div>
      )}

      {/* Processing State */}
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

          {file && (
            <div className="flex items-center gap-2 mb-6 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="ml-auto text-xs">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
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

      {/* Review Stage */}
      {stage === 'review' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Overall confidence / OCR-failed banner */}
          {ocrFailed ? (
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

          {/* Editable Fields */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t.upload.reviewAndEdit}</h3>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t.upload.billTo}: {selectedCompanyName}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{field.label}</label>
                  <Input
                    value={editableValues[field.key] ?? ''}
                    onChange={(e) =>
                      setEditableValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="h-10 text-sm"
                  />
                  {!ocrFailed && <ConfidenceBar confidence={field.confidence} />}
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
                          Rp {Number(item.total).toLocaleString('id-ID')}
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
            <Button onClick={confirmAndSubmit} className="flex-1 gap-2">
              <CheckCircle className="h-4 w-4" />
              {t.upload.confirmAndSubmit}
            </Button>
            <Button variant="outline" onClick={resetWizard}>
              {t.upload.uploadAgain}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Done */}
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
