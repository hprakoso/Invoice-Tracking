import { Loader2, Eye, Clock, CheckCircle2, XCircle, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  PENDING_OCR:      { label: 'Memproses',  className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',                       icon: Loader2 },
  PENDING_REVIEW:   { label: 'Review',     className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',                  icon: Eye },
  PENDING_APPROVAL: { label: 'Approval',   className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',                     icon: Clock },
  APPROVED:         { label: 'Disetujui',  className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',          icon: CheckCircle2 },
  REJECTED:         { label: 'Ditolak',    className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',                         icon: XCircle },
  PAID:             { label: 'Dibayar',    className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',              icon: CreditCard },
}

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600', icon: Clock }
  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {config.label}
    </span>
  )
}
