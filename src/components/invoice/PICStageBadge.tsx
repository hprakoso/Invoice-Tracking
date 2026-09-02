'use client'

import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/useI18n'

// PIC workflow stages in display order (GA is first after upload).
export const PIC_STAGE_ORDER = ['GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY'] as const
export type PICStageKey = (typeof PIC_STAGE_ORDER)[number]

const STAGE_CONFIG: Record<PICStageKey, string> = {
  GA: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  BUDGET: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  PROC_LEGAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  SSU: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  TREASURY: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

/** Read-only PIC workflow stage chip — same visual language as StatusBadge. */
export function PICStageBadge({ stage, className }: { stage: string; className?: string }) {
  const { t } = useI18n()
  const label = (t.picStage as Record<string, string>)[stage] ?? stage
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STAGE_CONFIG[stage as PICStageKey] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
        className,
      )}
    >
      {label}
    </span>
  )
}
