'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { motion } from 'framer-motion'
import { Upload, FileText, Image as ImageIcon, CheckCircle, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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

type UploadStage = 'drop' | 'uploading' | 'ocr' | 'review' | 'done'

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
  const [stage, setStage] = useState<UploadStage>('drop')
  const [file, setFile] = useState<File | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [fields, setFields] = useState<ExtractedField[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [overallConfidence, setOverallConfidence] = useState(0)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [editableValues, setEditableValues] = useState<Record<string, string>>({})

  const onDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0]
    if (!f) return
    setFile(f)
    await runOCR(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function runOCR(uploadFile: File) {
    setStage('uploading')
    setStatusMsg('Fetching vendor data...')
    setFields([])
    setLineItems([])

    try {
      // 0. Fetch first vendor as placeholder (vendorId is required in schema)
      const vendorsRes = await fetch('/api/vendors?limit=1')
      if (!vendorsRes.ok) throw new Error('Failed to fetch vendor data')
      const vendors = await vendorsRes.json()
      const placeholderVendorId: string | null =
        Array.isArray(vendors) && vendors.length > 0 ? vendors[0].id : null
      if (!placeholderVendorId) throw new Error('No vendors available. Please add a vendor first.')

      // 1. Create invoice record
      setStatusMsg('Creating invoice record...')
      const createRes = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: placeholderVendorId,
          invoiceNumber: `DRAFT-${Date.now()}`,
          totalAmount: 0,
        }),
      })
      if (!createRes.ok) throw new Error('Failed to create invoice record')
      const invoice = await createRes.json()
      const id: string = invoice.id
      setInvoiceId(id)

      // 2. Upload file
      setStatusMsg('Uploading file...')
      const formData = new FormData()
      formData.append('file', uploadFile)
      const uploadRes = await fetch(`/api/invoices/${id}/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!uploadRes.ok) throw new Error('Failed to upload file')

      // 3. SSE OCR stream
      setStage('ocr')
      setStatusMsg('Starting OCR...')

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
        toast.success('OCR complete! Please review and confirm the data.')
      })

      es.addEventListener('error', (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data ?? '{}')
          setStatusMsg(d.message ?? 'OCR failed')
        } catch {
          setStatusMsg('OCR failed')
        }
        setStage('review')
        es.close()
        toast.error('OCR failed. Please enter the data manually.')
      })

      es.onerror = () => {
        setStage('review')
        es.close()
        toast.error('Connection to AI service lost. Please check the data manually.')
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

    await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
        status: 'PENDING_APPROVAL',
      }),
    })

    setStage('done')
    toast.success('Invoice confirmed and submitted for approval!')
    setTimeout(() => router.push('/invoices'), 1500)
  }

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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Upload Invoice</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">AI will extract data automatically</p>
        </div>
      </div>

      {/* Drop Zone */}
      {stage === 'drop' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
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
              {isDragActive ? 'Drop the file here...' : 'Drag & drop invoice file'}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">or click to browse files</p>
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
                Extracted Data
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
          {/* Overall confidence banner */}
          <div
            className={`rounded-xl px-4 py-3 flex items-center gap-3 ${
              overallConfidence >= 80
                ? 'bg-green-50 border border-green-200'
                : 'bg-yellow-50 border border-yellow-200'
            }`}
          >
            {overallConfidence >= 80 ? (
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-700">
                {overallConfidence >= 80 ? 'Extraction successful!' : 'Please verify the data'}
              </p>
              <p className="text-xs text-gray-500">
                Overall accuracy: {overallConfidence.toFixed(0)}%
              </p>
            </div>
          </div>

          {/* Editable Fields */}
          <div className="bg-white rounded-xl border p-4 sm:p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Verify &amp; Edit Data</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                  <Input
                    value={editableValues[field.key] ?? ''}
                    onChange={(e) =>
                      setEditableValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="h-10 text-sm"
                  />
                  <ConfidenceBar confidence={field.confidence} />
                </div>
              ))}
            </div>

            {/* Line Items */}
            {lineItems.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Invoice Items
                  </p>
                  <div className="space-y-1">
                    {lineItems.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600 flex-1 min-w-0 truncate">
                          {item.description}
                        </span>
                        <span className="text-gray-700 font-medium ml-4">
                          Rp {Number(item.total).toLocaleString('id-ID')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={confirmAndSubmit} className="flex-1 gap-2">
              <CheckCircle className="h-4 w-4" />
              Confirm &amp; Submit for Approval
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStage('drop')
                setFile(null)
                setFields([])
                setLineItems([])
                setInvoiceId(null)
                setEditableValues({})
                setOverallConfidence(0)
              }}
            >
              Upload Again
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
          <h2 className="text-xl font-bold text-gray-900">Invoice Submitted Successfully!</h2>
          <p className="text-gray-500 mt-2">Redirecting to invoice list...</p>
        </motion.div>
      )}
    </div>
  )
}
