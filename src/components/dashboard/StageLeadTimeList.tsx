'use client'
import { Timer } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { ChartEmpty } from './ChartEmpty'

export interface StageLeadTime {
  stage: string
  /** Null when no invoice has completed this stage yet — shown as "no data", not 0. */
  avgDays: number | null
  completed: number
  currentCount: number
}

/**
 * Average days spent per PIC stage — the aggregate counterpart to the
 * per-invoice SLA timeline on the invoice detail page.
 *
 * Bars are scaled against the slowest stage rather than an absolute target:
 * there are no SLA thresholds stored anywhere, so the only honest comparison
 * is between stages. Amber marks the slowest stage — the current bottleneck.
 */
export function StageLeadTimeList({ data }: { data: StageLeadTime[] }) {
  const { t } = useI18n()

  const withData = data.filter((s) => s.avgDays !== null)
  if (withData.length === 0) {
    return (
      <ChartEmpty
        icon={<Timer className="h-5 w-5" />}
        title={t.dashboard.stageLeadTimeEmptyTitle}
        hint={t.dashboard.stageLeadTimeEmptyHint}
      />
    )
  }

  const max = Math.max(...withData.map((s) => s.avgDays ?? 0))
  const slowest = withData.reduce((a, b) => ((b.avgDays ?? 0) > (a.avgDays ?? 0) ? b : a))

  return (
    <div role="list" className="space-y-2.5">
      {data.map((s) => {
        const isSlowest = s.stage === slowest.stage && s.avgDays !== null
        const share = s.avgDays !== null && max > 0 ? Math.round((s.avgDays / max) * 100) : 0
        return (
          <div
            key={s.stage}
            role="listitem"
            className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-card/60"
            aria-label={`${(t.picStage as Record<string, string>)[s.stage] ?? s.stage}: ${
              s.avgDays === null
                ? t.dashboard.stageLeadTimeNoData
                : t.dashboard.stageLeadTimeDays.replace('{days}', String(s.avgDays))
            }`}
          >
            <div className="w-20 flex-shrink-0 sm:w-24">
              <p className="text-xs font-medium text-foreground">
                {(t.picStage as Record<string, string>)[s.stage] ?? s.stage}
              </p>
              {s.currentCount > 0 && (
                <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                  {t.dashboard.stageLeadTimeHeld.replace('{count}', String(s.currentCount))}
                </p>
              )}
            </div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${share}%`,
                  background: isSlowest ? '#f59e0b' : 'var(--chart-2)',
                }}
              />
            </div>
            <div className="w-20 flex-shrink-0 text-right sm:w-24">
              <p className="text-sm leading-tight font-semibold tabular-nums text-foreground">
                {s.avgDays === null
                  ? '—'
                  : t.dashboard.stageLeadTimeDays.replace('{days}', String(s.avgDays))}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
