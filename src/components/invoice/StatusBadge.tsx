'use client'

import { Send, RotateCcw, Ban, XCircle, ShieldOff, CircleCheck, FileEdit } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/useI18n'

const STATUS_CONFIG: Record<string, { className: string; icon: React.ElementType }> = {
  DRAFT:     { className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',        icon: FileEdit },
  SUBMITTED: { className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',      icon: Send },
  PAID:      { className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',  icon: CircleCheck },
  REVISION:  { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',  icon: RotateCcw },
  CANCELLED: { className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',         icon: Ban },
  REJECTED:  { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',          icon: XCircle },
  VOID:      { className: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',     icon: ShieldOff },
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  const config = STATUS_CONFIG[status] ?? { className: 'bg-gray-100 text-gray-600', icon: Ban }
  const label = (t.status as Record<string, string>)[status] ?? status
  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {label}
    </span>
  )
}
