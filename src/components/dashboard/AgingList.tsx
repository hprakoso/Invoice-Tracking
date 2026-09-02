'use client'
import { useState } from 'react'
import { Hourglass } from 'lucide-react'
import { formatIDR } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { AGING_COLORS, formatAxisIDR } from './chartShared'
import { ChartEmpty } from './ChartEmpty'

export interface AgingBucket {
  label: string
  amount: number
}

/**
 * Horizontal aging bar list — one row per due-date bucket.
 * Row shows amount + share of open total; bars run teal → amber → orange → red
 * (healthy → danger). Buckets past 30 days are marked overdue, the last one "tertua".
 */
export function AgingList({ data, openCount }: { data: AgingBucket[]; openCount: number }) {
  const { t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)

  const total = data.reduce((sum, b) => sum + b.amount, 0)
  const hasData = data.length > 0 && data.some(b => b.amount > 0)

  if (!hasData) {
    return (
      <ChartEmpty
        icon={<Hourglass className="h-5 w-5" />}
        title={t.dashboard.agingEmptyTitle}
        hint={t.dashboard.agingEmptyHint}
      />
    )
  }

  // Buckets after the first (0–30 hari) are past the 30-day overdue threshold.
  const overdueAmount = data.slice(1).reduce((sum, b) => sum + b.amount, 0)
  const overdueShare = total > 0 ? Math.round((overdueAmount / total) * 100) : 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
          {t.dashboard.agingOverdueChip}: {formatAxisIDR(overdueAmount)} · {overdueShare}%
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t.dashboard.agingOpenCount.replace('{count}', String(openCount))}
        </span>
      </div>

      <div role="list" className="space-y-2.5">
        {data.map((bucket, i) => {
          const share = total > 0 ? Math.round((bucket.amount / total) * 100) : 0
          const isOverdue = i > 0
          const isOldest = i === data.length - 1
          const color = AGING_COLORS[i % AGING_COLORS.length]
          return (
            <div
              key={bucket.label}
              role="listitem"
              className="group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-card/60"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              aria-label={`${bucket.label}: ${formatIDR(bucket.amount)}`}
            >
              <div className="w-20 flex-shrink-0 sm:w-24">
                <p className="text-xs font-medium text-foreground">{bucket.label}</p>
                {isOverdue && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[9.5px] font-medium text-destructive">
                    <span className="h-1 w-1 rounded-full bg-destructive" aria-hidden="true" />
                    {t.dashboard.agingOverdueLabel}
                  </p>
                )}
                {isOldest && !isOverdue && (
                  <p className="mt-0.5 text-[9.5px] text-muted-foreground">{t.dashboard.agingOldestLabel}</p>
                )}
              </div>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${share}%`, background: color }}
                />
              </div>
              <div className="w-24 flex-shrink-0 text-right sm:w-32">
                <p className="text-sm leading-tight font-semibold tabular-nums text-foreground">
                  {formatAxisIDR(bucket.amount)}
                </p>
                <p className="text-[10px] tabular-nums text-muted-foreground">{share}%</p>
              </div>

              {hover === i && (
                <div className="pointer-events-none absolute top-0 right-0 z-10 translate-y-[-110%] rounded-lg border border-border bg-popover/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
                  {formatIDR(bucket.amount)} · {share}% {t.dashboard.tooltipShareOfOpen}
                  {isOverdue && <span className="text-destructive"> · {t.dashboard.agingOverdueDetail}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
