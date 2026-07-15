import { Send, RotateCcw, Ban, XCircle, ShieldOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  SUBMITTED: { label: 'Diajukan',   className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',           icon: Send },
  REVISION:  { label: 'Revisi',     className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',       icon: RotateCcw },
  CANCELLED: { label: 'Dibatalkan', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',              icon: Ban },
  REJECTED:  { label: 'Ditolak',    className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',               icon: XCircle },
  VOID:      { label: 'Void',       className: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',          icon: ShieldOff },
}

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600', icon: Ban }
  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {config.label}
    </span>
  )
}
