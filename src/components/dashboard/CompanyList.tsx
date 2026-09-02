'use client'
import { Building2 } from 'lucide-react'
import { formatIDR } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { formatAxisIDR } from './chartShared'
import { ChartEmpty } from './ChartEmpty'

export interface CompanyBreakdownItem {
  companyId: string | null
  companyName: string | null
  count: number
  totalAmount: number
}

// Deliberately not AGING_COLORS (which encodes healthy→danger): company is a
// nominal dimension, so a severity ramp would imply a ranking that isn't
// there. One neutral brand tone, weight carried by bar length instead.
const BAR_COLOR = 'var(--chart-1)'

/** Total invoiced value per bill-to entity, largest first. */
export function CompanyList({ data }: { data: CompanyBreakdownItem[] }) {
  const { t } = useI18n()

  if (data.length === 0) {
    return (
      <ChartEmpty
        icon={<Building2 className="h-5 w-5" />}
        title={t.dashboard.byCompanyEmptyTitle}
        hint={t.dashboard.byCompanyEmptyHint}
      />
    )
  }

  const max = Math.max(...data.map((c) => c.totalAmount), 0)

  return (
    <div role="list" className="space-y-2.5">
      {data.map((c) => {
        const label = c.companyName ?? t.dashboard.byCompanyUnassigned
        const share = max > 0 ? Math.round((c.totalAmount / max) * 100) : 0
        return (
          <div
            key={c.companyId ?? 'unassigned'}
            role="listitem"
            className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-card/60"
            aria-label={`${label}: ${formatIDR(c.totalAmount)}`}
          >
            <div className="w-28 flex-shrink-0 sm:w-36">
              <p className="truncate text-xs font-medium text-foreground" title={label}>{label}</p>
              <p className="mt-0.5 text-[9.5px] tabular-nums text-muted-foreground">
                {t.dashboard.byCompanyCount.replace('{count}', String(c.count))}
              </p>
            </div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${share}%`, background: BAR_COLOR }}
              />
            </div>
            <div className="w-24 flex-shrink-0 text-right sm:w-28">
              <p className="text-sm leading-tight font-semibold tabular-nums text-foreground">
                {formatAxisIDR(c.totalAmount)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
