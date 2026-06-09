import { cn } from '@/lib/utils'

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING_OCR: { label: 'OCR', className: 'bg-gray-100 text-gray-600' },
  PENDING_REVIEW: { label: 'Review', className: 'bg-yellow-100 text-yellow-700' },
  PENDING_APPROVAL: { label: 'Approval', className: 'bg-blue-100 text-blue-700' },
  APPROVED: { label: 'Disetujui', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Ditolak', className: 'bg-red-100 text-red-700' },
  PAID: { label: 'Dibayar', className: 'bg-purple-100 text-purple-700' },
}

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      {config.label}
    </span>
  )
}
