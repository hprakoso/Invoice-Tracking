'use client'
import { Fragment } from 'react'
import { Workflow } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { useI18n } from '@/hooks/useI18n'
import { StatusBadge } from '@/components/invoice/StatusBadge'
import { ChartEmpty } from './ChartEmpty'
import { formatMonthAxis, formatMonthFull } from './chartShared'
import { MAIN_FLOW_STATUSES, EXCEPTION_STATUSES, NON_OPEN_STATUSES } from '@/lib/invoiceStatus'

export interface StatusMonthPoint {
  month: string
  entered: number
  accepted: number
}

export interface StatusBreakdownItem {
  status: string
  count: number
}

// Linear main-flow order — the pipeline strip renders in exactly this
// sequence. Exception states branch off this flow and aren't part of it —
// shown separately below as a compact chip row instead.
//
// Both lists come from the shared status module rather than being re-declared
// here: local copies meant a status added to the workflow got a badge and a
// label but silently vanished from this chart.
const FLOW_ORDER = MAIN_FLOW_STATUSES
type FlowKey = (typeof FLOW_ORDER)[number]

// Sequential reading, healthy → settled: violet (masuk) fading toward teal
// (dibayar/selesai) across the 9 main-flow steps.
const FLOW_COLORS: Record<FlowKey, string> = {
  RECEIVED: 'var(--chart-1)',
  REGISTERED: 'color-mix(in oklab, var(--chart-1) 80%, var(--chart-2))',
  DOC_VERIFICATION: 'color-mix(in oklab, var(--chart-1) 60%, var(--chart-2))',
  FINANCE_VERIFICATION: 'color-mix(in oklab, var(--chart-1) 40%, var(--chart-2))',
  READY_FOR_PAYMENT: '#f59e0b',
  TREASURY_PROCESS: 'color-mix(in oklab, #f59e0b 50%, var(--chart-2))',
  PAYMENT_SCHEDULED: 'color-mix(in oklab, var(--chart-2) 70%, #f59e0b)',
  PAID: 'var(--chart-2)',
  CLOSED: 'color-mix(in oklab, var(--chart-2) 70%, var(--muted-foreground))',
}

function flowLabels(t: ReturnType<typeof useI18n>['t']): Record<FlowKey, string> {
  const status = t.status as Record<string, string>
  return Object.fromEntries(FLOW_ORDER.map((k) => [k, status[k]])) as Record<FlowKey, string>
}

function FlowTooltip({ active, payload }: TooltipContentProps) {
  const { t } = useI18n()
  if (!active || !payload?.length) return null
  const point = payload[0].payload as StatusMonthPoint
  const gap = point.entered - point.accepted
  return (
    <div className="rounded-xl border border-border bg-popover/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur">
      <p className="font-medium text-foreground">{formatMonthFull(point.month)}</p>
      <p className="mt-1.5 flex items-center justify-between gap-6">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-1)' }} aria-hidden="true" />
          {t.dashboard.flowEntered}
        </span>
        <span className="font-medium tabular-nums text-foreground">{point.entered}</span>
      </p>
      <p className="flex items-center justify-between gap-6">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-2)' }} aria-hidden="true" />
          {t.dashboard.flowAccepted}
        </span>
        <span className="font-medium tabular-nums text-foreground">{point.accepted}</span>
      </p>
      <p className="mt-1.5 flex items-center justify-between gap-6 border-t border-border pt-1.5">
        <span className="text-muted-foreground">{t.dashboard.flowGap}</span>
        <span className="font-semibold tabular-nums text-foreground">{gap > 0 ? `+${gap}` : gap}</span>
      </p>
    </div>
  )
}

/**
 * Verification flow panel:
 * 1. Pipeline strip — current count per workflow status (from statusBreakdown),
 *    read left-to-right as the linear process.
 * 2. Area chart — monthly entered (verificationProcess) vs accepted (invoiceAccepted);
 *    the gap between the lines is work still in flight.
 */
export function StatusFlowChart({
  data,
  breakdown,
}: {
  data: StatusMonthPoint[]
  breakdown: StatusBreakdownItem[]
}) {
  const { t } = useI18n()
  const labels = flowLabels(t)

  const breakdownByKey = FLOW_ORDER.reduce(
    (acc, k) => {
      acc[k] = 0
      return acc
    },
    {} as Record<FlowKey, number>,
  )
  for (const item of breakdown) {
    if ((FLOW_ORDER as readonly string[]).includes(item.status)) {
      breakdownByKey[item.status as FlowKey] += item.count
    }
  }

  // Exception statuses aren't part of the linear pipeline strip — shown as a
  // separate chip row below it so the full 17-status breakdown stays visible
  // somewhere, not just the 9 main-flow steps.
  const exceptionItems = breakdown.filter(
    (item): item is StatusBreakdownItem => (EXCEPTION_STATUSES as readonly string[]).includes(item.status) && item.count > 0,
  )

  const total = FLOW_ORDER.reduce((sum, k) => sum + breakdownByKey[k], 0)
  // "Belum selesai" counts every non-settled invoice, exception states
  // included — the same rule the Open Invoices KPI on this page uses. Summing
  // only the main-flow steps meant invoices parked in DOC_INCOMPLETE,
  // PAYMENT_HOLD, WAITING_* etc. were missing here, so the two figures
  // disagreed whenever anything sat off the happy path.
  const open = breakdown
    .filter(item => !(NON_OPEN_STATUSES as readonly string[]).includes(item.status))
    .reduce((sum, item) => sum + item.count, 0)
  const monthlyHasData = data.length > 0 && data.some(p => p.entered > 0 || p.accepted > 0)
  const hasData = total > 0 || monthlyHasData

  if (!hasData) {
    return (
      <ChartEmpty
        icon={<Workflow className="h-5 w-5" />}
        title={t.dashboard.noInvoiceData}
        hint={t.dashboard.statusFlowSubtitle}
      />
    )
  }

  const enteredTotal = data.reduce((sum, p) => sum + p.entered, 0)
  const acceptedTotal = data.reduce((sum, p) => sum + p.accepted, 0)

  return (
    <div>
      {/* Pipeline strip — current state, not last month */}
      <div className="flex items-center gap-1.5">
        {FLOW_ORDER.map((k, i) => (
          <Fragment key={k}>
            {i > 0 && (
              <span className="flex-shrink-0 text-muted-foreground/50" aria-hidden="true">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            )}
            <div
              className="flex-1 rounded-xl border px-3 py-2.5"
              style={{
                borderColor: `color-mix(in oklab, ${FLOW_COLORS[k]} 45%, transparent)`,
                background: `color-mix(in oklab, ${FLOW_COLORS[k]} 8%, transparent)`,
              }}
            >
              <p className="text-[10px] font-medium leading-tight text-muted-foreground">{labels[k]}</p>
              <p className="mt-0.5 text-lg leading-none font-bold tabular-nums" style={{ color: FLOW_COLORS[k] }}>
                {breakdownByKey[k]}
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                {total > 0 ? Math.round((breakdownByKey[k] / total) * 100) : 0}%
              </p>
            </div>
          </Fragment>
        ))}
      </div>

      {exceptionItems.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {exceptionItems.map((item) => (
            <span key={item.status} className="inline-flex items-center gap-1">
              <StatusBadge status={item.status} />
              <span className="text-[10px] tabular-nums text-muted-foreground">×{item.count}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {t.dashboard.statusFlowOpenCount.replace('{count}', String(open))}
        </span>
        <span className="inline-flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-1)' }} aria-hidden="true" />
            {t.dashboard.flowEntered} · {enteredTotal}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--chart-2)' }} aria-hidden="true" />
            {t.dashboard.flowAccepted} · {acceptedTotal}
          </span>
        </span>
      </div>

      <div className="mt-2 h-48 sm:h-56" aria-label={t.dashboard.statusFlowChartAria}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="aqFlowIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="aqFlowOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
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
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={30}
              tickMargin={6}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              content={props => <FlowTooltip {...props} />}
              cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="entered"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#aqFlowIn)"
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="accepted"
              stroke="var(--chart-2)"
              strokeWidth={2}
              fill="url(#aqFlowOut)"
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
