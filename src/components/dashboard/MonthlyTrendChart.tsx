'use client'
import { TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatIDR } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { ChartEmpty } from './ChartEmpty'
import { formatAxisIDR, formatMonthAxis, formatMonthFull } from './chartShared'

export interface MonthlyPoint {
  month: string
  totalAmount: number
  count: number
}

function TrendTooltip({ active, payload }: TooltipContentProps) {
  const { t } = useI18n()
  if (!active || !payload?.length) return null
  const point = payload[0].payload as MonthlyPoint
  return (
    <div className="rounded-xl border border-border bg-popover/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur">
      <p className="font-medium text-foreground">{formatMonthFull(point.month)}</p>
      <p className="mt-1.5 flex items-baseline justify-between gap-6">
        <span className="text-muted-foreground">{t.dashboard.tooltipTotalAmount}</span>
        <span className="font-semibold tabular-nums text-foreground">{formatIDR(point.totalAmount)}</span>
      </p>
      <p className="flex items-baseline justify-between gap-6">
        <span className="text-muted-foreground">{t.dashboard.tooltipInvoiceCount}</span>
        <span className="font-medium tabular-nums text-foreground">{t.dashboard.monthlyTrendCount.replace('{count}', String(point.count))}</span>
      </p>
    </div>
  )
}

/** Hero chart — trailing 12 months of invoice totals. */
export function MonthlyTrendChart({ data }: { data: MonthlyPoint[] }) {
  const { t } = useI18n()
  const hasData = data.length > 0 && data.some(p => p.totalAmount > 0)

  if (!hasData) {
    return (
      <ChartEmpty
        icon={<TrendingUp className="h-5 w-5" />}
        title={t.dashboard.noInvoiceData}
        hint={t.dashboard.monthlyTrendEmptyHint}
      />
    )
  }

  return (
    <div className="h-72 sm:h-80" aria-label={t.dashboard.monthlyTrendChartAria}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="aqTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonthAxis}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={20}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
          <YAxis
            tickFormatter={formatAxisIDR}
            tickLine={false}
            axisLine={false}
            width={64}
            tickMargin={6}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            content={props => <TrendTooltip {...props} />}
            cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="totalAmount"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#aqTrendFill)"
            activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
