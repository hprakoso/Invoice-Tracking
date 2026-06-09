'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText, Calendar, Building2, DollarSign, CheckCircle, XCircle, Clock } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { Separator } from '@/components/ui/separator'

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: string
  taxAmount?: string | null
  subtotal?: string | null
  dueDate: string | null
  invoiceDate: string | null
  currency: string
  ocrConfidence: number | null
  notes?: string | null
  vendor: { id: string; name: string; npwp?: string | null }
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

function formatIDR(v: string | number | null | undefined) {
  if (v == null) return '—'
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(v))
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
}

function ApprovalStep({ step, approval }: { step: number; approval?: Invoice['approvals'][0] }) {
  const label = step === 1 ? 'Finance Review' : 'Manager Approval'
  const icon = !approval || approval.status === 'PENDING'
    ? <Clock className="h-4 w-4 text-gray-400" />
    : approval.status === 'APPROVED'
      ? <CheckCircle className="h-4 w-4 text-green-500" />
      : <XCircle className="h-4 w-4 text-red-500" />

  const badgeStatus = !approval || approval.status === 'PENDING'
    ? 'PENDING_REVIEW'
    : approval.status === 'APPROVED'
      ? 'APPROVED'
      : 'REJECTED'

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {approval && approval.status !== 'PENDING' && (
          <>
            <p className="text-xs text-gray-500">{approval.approver?.name ?? 'Unknown'}</p>
            {approval.comment && <p className="text-xs text-gray-500 italic mt-0.5">&ldquo;{approval.comment}&rdquo;</p>}
            {approval.actionedAt && (
              <p className="text-xs text-gray-400">{formatDate(approval.actionedAt)}</p>
            )}
          </>
        )}
        {(!approval || approval.status === 'PENDING') && (
          <p className="text-xs text-gray-400">Menunggu...</p>
        )}
      </div>
      <StatusBadge status={badgeStatus} />
    </div>
  )
}

interface Props {
  invoice: Invoice | null
  onClose: () => void
  onRefresh?: () => void
}

export function InvoiceDetailDrawer({ invoice, onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {invoice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 z-40"
          />
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AnimatePresence>
        {invoice && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full sm:w-[480px] xl:w-[540px] bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <div>
                <p className="text-sm text-gray-500">Detail Invoice</p>
                <h2 className="text-base font-bold text-gray-900 font-mono">{invoice.invoiceNumber}</h2>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={invoice.status} />
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                  <X className="h-4 w-4 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Vendor */}
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Building2 className="h-3 w-3" /> Vendor
                </p>
                <p className="text-sm font-semibold text-gray-900">{invoice.vendor?.name}</p>
                {invoice.vendor?.npwp && <p className="text-xs text-gray-500">NPWP: {invoice.vendor.npwp}</p>}
              </div>

              <Separator />

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                    <Calendar className="h-3 w-3" /> Tanggal Invoice
                  </p>
                  <p className="text-sm font-medium text-gray-700">{formatDate(invoice.invoiceDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                    <Calendar className="h-3 w-3" /> Jatuh Tempo
                  </p>
                  <p className="text-sm font-medium text-gray-700">{formatDate(invoice.dueDate)}</p>
                </div>
              </div>

              <Separator />

              {/* Financial Summary */}
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <DollarSign className="h-3 w-3" /> Ringkasan Keuangan
                </p>
                <div className="space-y-2 bg-gray-50 rounded-lg p-3">
                  {invoice.subtotal && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span className="text-gray-700">{formatIDR(invoice.subtotal)}</span>
                    </div>
                  )}
                  {invoice.taxAmount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">PPN (11%)</span>
                      <span className="text-gray-700">{formatIDR(invoice.taxAmount)}</span>
                    </div>
                  )}
                  <Separator className="my-1" />
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-gray-700">Total</span>
                    <span className="text-blue-700">{formatIDR(invoice.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              {invoice.items.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <FileText className="h-3 w-3" /> Item
                  </p>
                  <div className="space-y-2">
                    {invoice.items.map(item => (
                      <div key={item.id} className="flex justify-between gap-2 text-sm">
                        <span className="text-gray-600 flex-1 min-w-0 truncate">{item.description}</span>
                        <span className="text-gray-700 font-medium whitespace-nowrap">{formatIDR(item.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Approval Timeline */}
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Alur Persetujuan</p>
                <div className="space-y-3">
                  <ApprovalStep step={1} approval={invoice.approvals.find(a => a.step === 1)} />
                  <ApprovalStep step={2} approval={invoice.approvals.find(a => a.step === 2)} />
                </div>
              </div>

              {/* OCR Confidence */}
              {invoice.ocrConfidence != null && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Akurasi OCR</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          invoice.ocrConfidence >= 80
                            ? 'bg-green-500'
                            : invoice.ocrConfidence >= 50
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                        style={{ width: `${invoice.ocrConfidence}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{invoice.ocrConfidence.toFixed(0)}%</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              {invoice.notes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Catatan</p>
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{invoice.notes}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
