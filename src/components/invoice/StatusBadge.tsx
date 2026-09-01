'use client'

import {
  Inbox, FileCheck2, FileSearch, Landmark, Wallet, CalendarClock, CircleCheck, Archive,
  FileWarning, Undo2, HelpCircle, Clock, Receipt, XCircle, PauseCircle, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/useI18n'

// 17-value workflow — grouped by family: main flow progresses violet → teal
// (early intake to settled), exception states are amber/orange (needs
// attention) or red (blocked/rejected), terminal states are green/slate.
const STATUS_CONFIG: Record<string, { className: string; icon: React.ElementType }> = {
  // Main flow (linear, violet -> teal)
  RECEIVED:              { className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',   icon: Inbox },
  REGISTERED:            { className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',   icon: FileCheck2 },
  DOC_VERIFICATION:      { className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',           icon: FileSearch },
  FINANCE_VERIFICATION:  { className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',           icon: Landmark },
  READY_FOR_PAYMENT:     { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',       icon: Wallet },
  TREASURY_PROCESS:      { className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',   icon: Landmark },
  PAYMENT_SCHEDULED:     { className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',           icon: CalendarClock },
  // Terminal
  PAID:                  { className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',       icon: CircleCheck },
  CLOSED:                { className: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',       icon: Archive },
  // Exception (branches off the main flow)
  DOC_INCOMPLETE:            { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',   icon: FileWarning },
  RETURNED_TO_VENDOR:        { className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', icon: Undo2 },
  WAITING_USER_CONFIRMATION: { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',   icon: HelpCircle },
  WAITING_APPROVAL:          { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',   icon: Clock },
  WAITING_TAX_DOCUMENT:      { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',   icon: Receipt },
  REJECTED:                  { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',           icon: XCircle },
  PAYMENT_HOLD:              { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',           icon: PauseCircle },
  VENDOR_BANK_ISSUE:         { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',           icon: AlertTriangle },
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  const config = STATUS_CONFIG[status] ?? { className: 'bg-gray-100 text-gray-600', icon: CircleCheck }
  const label = (t.status as Record<string, string>)[status] ?? status
  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {label}
    </span>
  )
}
