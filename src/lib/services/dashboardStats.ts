import { prisma } from '@/lib/db/prisma'
import type { Prisma, InvoiceStatus } from '@prisma/client'
import { INVOICE_STATUSES, NON_OPEN_STATUSES as SETTLED_STATUSES } from '@/lib/invoiceStatus'
import { jakartaDayStart } from '@/lib/format'

// Re-exported with the Prisma enum type so query builders can use it directly.
// The list itself lives in invoiceStatus.ts — the client-safe module the
// invoice list's overdue tag also reads, so the two can't drift apart.
export const NON_OPEN_STATUSES = SETTLED_STATUSES as readonly string[] as InvoiceStatus[]

// Display order for the per-stage lead-time widget — every stage appears even
// when no invoice has reached it yet, so the pipeline reads as a fixed shape
// rather than a list that grows as data arrives.
const STAGE_ORDER = ['GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY'] as const

export interface StageLeadTimeRow {
  stage: string
  avgDays: number | null
  completed: number
  currentCount: number
}

/**
 * Average time spent in each stage. A stage's duration is the gap to the NEXT
 * recorded stage **for the same invoice**; the last row per invoice is still
 * open, so it counts toward `currentCount` (invoices sitting there now) but
 * not toward the average — folding in-progress time into a "how long does
 * this stage take" figure would understate it.
 *
 * `rows` must be ordered by (invoiceId, changedAt): the invoice grouping is
 * detected by comparing adjacent rows, and ordering by time is what keeps
 * every gap non-negative even if stages were recorded out of workflow order
 * (a correction moving an invoice backwards is still elapsed time somewhere).
 */
export function foldStageLeadTimes(
  rows: { invoiceId: string; stage: string; changedAt: Date }[],
): StageLeadTimeRow[] {
  const totals = new Map<string, { totalMs: number; completed: number; currentCount: number }>()
  const entryFor = (stage: string) => {
    let entry = totals.get(stage)
    if (!entry) {
      entry = { totalMs: 0, completed: 0, currentCount: 0 }
      totals.set(stage, entry)
    }
    return entry
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const next = rows[i + 1]
    const entry = entryFor(row.stage)
    if (!next || next.invoiceId !== row.invoiceId) {
      entry.currentCount += 1
    } else {
      entry.totalMs += next.changedAt.getTime() - row.changedAt.getTime()
      entry.completed += 1
    }
  }

  return STAGE_ORDER.map((stage) => {
    const entry = totals.get(stage)
    const avg = entry && entry.completed > 0 ? entry.totalMs / entry.completed / 86400000 : null
    return {
      stage,
      avgDays: avg === null ? null : Math.round(avg * 10) / 10,
      completed: entry?.completed ?? 0,
      currentCount: entry?.currentCount ?? 0,
    }
  })
}

// UTC month key — matches the codebase's ISO/UTC date handling elsewhere.
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

// Trailing `count` month keys (YYYY-MM) ascending, ending at the anchor's month.
function trailingMonthKeys(anchor: Date, count: number): string[] {
  const y = anchor.getUTCFullYear()
  const m = anchor.getUTCMonth()
  return Array.from({ length: count }, (_, i) => monthKey(new Date(Date.UTC(y, m - count + 1 + i, 1))))
}

// Shared by GET /api/dashboard and GET /api/dashboard/export so the KPI
// cards/charts/table and the Excel export always reflect the same filtered
// view. `session` only needs role + vendorId, kept loose so callers don't
// need to import the full NextAuth session type.
export function buildDashboardFilter(
  searchParams: URLSearchParams,
  session: { user: { role: string; vendorId?: string | null } },
): Prisma.InvoiceWhereInput {
  // Wizard rows that never reached the review step are not invoices yet: they
  // stay out of every KPI, chart, list and export until confirmed. They are
  // still reachable by id, which is where the wizard sends the user.
  const where: Prisma.InvoiceWhereInput = { isDraft: false }

  // VENDOR is always scoped to their own invoices — never client-controlled.
  if (session.user.role === 'VENDOR') {
    // Callers reject an unlinked vendor up front (unlinkedVendorResponse in
    // auth/helpers). This throws rather than falling back to `undefined`, which
    // Prisma drops — that silently turned a broken vendor account into an
    // unscoped query returning every vendor's invoices.
    if (!session.user.vendorId) {
      throw new Error('VENDOR session without vendorId reached buildDashboardFilter')
    }
    where.vendorId = session.user.vendorId
  } else {
    const vendorId = searchParams.get('vendorId')
    if (vendorId) where.vendorId = vendorId
  }

  const search = searchParams.get('search')
  if (search) where.invoiceNumber = { contains: search, mode: 'insensitive' }

  // Validated instead of force-cast: an unknown status used to reach the
  // driver and come back as a 500. Ignored when invalid, same as the
  // amount filters below.
  const status = searchParams.get('status')
  if (status && (INVOICE_STATUSES as readonly string[]).includes(status)) {
    where.status = status as InvoiceStatus
  }

  const companyId = searchParams.get('companyId')
  if (companyId) where.companyId = companyId

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (from || to) {
    where.dueDate = {}
    if (from) where.dueDate.gte = new Date(from)
    if (to) where.dueDate.lte = new Date(to)
  }

  applyInvoiceSearchFilters(searchParams, where)

  return where
}

// Shared by buildDashboardFilter() and GET /api/invoices so both surfaces
// accept the same filters and can't drift apart.
export function applyInvoiceSearchFilters(
  searchParams: URLSearchParams,
  where: Prisma.InvoiceWhereInput,
): Prisma.InvoiceWhereInput {
  const poNumber = searchParams.get('poNumber')
  if (poNumber) where.poNumber = { contains: poNumber, mode: 'insensitive' }

  const picId = searchParams.get('picId')
  if (picId) where.picId = picId

  // Non-numeric input is ignored rather than turned into NaN, which Prisma
  // would reject at the driver with an opaque error.
  const amountMin = Number(searchParams.get('amountMin'))
  const amountMax = Number(searchParams.get('amountMax'))
  const hasMin = searchParams.get('amountMin') !== null && Number.isFinite(amountMin)
  const hasMax = searchParams.get('amountMax') !== null && Number.isFinite(amountMax)
  if (hasMin || hasMax) {
    where.totalAmount = {}
    if (hasMin) where.totalAmount.gte = amountMin
    if (hasMax) where.totalAmount.lte = amountMax
  }

  return where
}

export async function getDashboardStats(filter: Prisma.InvoiceWhereInput) {
  const now = new Date()

  // "Open" metrics (Total Payable, Overdue, Open count, Aging) ALWAYS exclude
  // settled invoices, including when the caller has picked a status filter.
  // Previously the exclusion was dropped as soon as any status was selected, so
  // filtering to PAID reported already-paid invoices as "Overdue" and summed
  // them into "Total Payable" — while the invoice list, filtered the same way,
  // showed no overdue rows at all. One definition now drives both surfaces.
  const openFilter: Prisma.InvoiceWhereInput = {
    ...filter,
    status: filter.status
      ? { equals: filter.status as InvoiceStatus, notIn: NON_OPEN_STATUSES }
      : { notIn: NON_OPEN_STATUSES },
  }

  // Overdue and aging are measured against the start of today in Jakarta, not
  // "now": due dates are calendar dates stored at UTC midnight, so comparing
  // them to an instant made an invoice overdue from 07:00 WIB on its due day.
  const todayStart = jakartaDayStart(now)
  const d30 = new Date(todayStart.getTime() - 30 * 86400000)
  const d60 = new Date(todayStart.getTime() - 60 * 86400000)
  const d90 = new Date(todayStart.getTime() - 90 * 86400000)

  // Trailing-12-month window (UTC) for the monthly trend charts. The window
  // start is the first UTC day of the month 11 months back, so every month key
  // in the window can match a stored createdAt instant.
  const monthKeys = trailingMonthKeys(now, 12)
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))

  const [
    totalInvoices, statusCounts, totalPayable, overdueCount, openCount, agingBuckets, trendRows,
    companyCounts, stageRows,
  ] =
    await Promise.all([
      prisma.invoice.count({ where: filter }),
      prisma.invoice.groupBy({ by: ['status'], _count: { id: true }, where: filter }),
      prisma.invoice.aggregate({ where: openFilter, _sum: { totalAmount: true } }),
      prisma.invoice.count({ where: { ...openFilter, dueDate: { lt: todayStart } } }),
      prisma.invoice.count({ where: openFilter }),
      // Every open invoice lands in exactly one bucket, so the buckets sum to
      // Total Payable. The old first bucket was unbounded above (`gte: d30`),
      // which put invoices that aren't due yet — even ones due next year — in
      // "0–30 hari"; invoices with no due date fell through all four and
      // vanished from the panel while still counting toward the KPI.
      Promise.all([
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: todayStart } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d30, lt: todayStart } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d60, lt: d30 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { gte: d90, lt: d60 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: { lt: d90 } }, _sum: { totalAmount: true } }),
        prisma.invoice.aggregate({ where: { ...openFilter, dueDate: null }, _sum: { totalAmount: true } }),
      ]),
      prisma.invoice.findMany({
        where: { ...filter, createdAt: { gte: windowStart } },
        select: { createdAt: true, status: true, totalAmount: true },
      }),
      prisma.invoice.groupBy({
        by: ['companyId'],
        _count: { id: true },
        _sum: { totalAmount: true },
        where: filter,
      }),
      // Stage durations can't be expressed as a Prisma aggregate (they need
      // the gap between consecutive rows), so the rows are folded in JS below.
      // ponytail: loads every stage row for the filtered set — fine at this
      // scale (a few rows per invoice); move to a SQL window function (LEAD)
      // if the invoice count ever makes this the slow query on the page.
      prisma.invoiceStageHistory.findMany({
        where: { invoice: filter },
        select: { invoiceId: true, stage: true, changedAt: true },
        orderBy: [{ invoiceId: 'asc' }, { changedAt: 'asc' }],
      }),
    ])

  const monthlyTrend = monthKeys.map((month) => ({ month, totalAmount: 0, count: 0 }))
  // Pipeline-health trend: of invoices created in month X, how many are
  // currently freshly-entered (RECEIVED) vs already paid (PAID) — a
  // snapshot proxy, not a true historical flow-rate. Collapsed to these 2
  // series (not all 17 statuses) since that's all the trend chart plots;
  // the full per-status breakdown lives in `statusBreakdown` below.
  const statusByMonth = monthKeys.map((month) => ({ month, entered: 0, accepted: 0 }))
  const trendIndex = new Map(monthKeys.map((month, i) => [month, i]))
  for (const inv of trendRows) {
    const i = trendIndex.get(monthKey(inv.createdAt))
    if (i === undefined) continue
    monthlyTrend[i].totalAmount += inv.totalAmount.toNumber()
    monthlyTrend[i].count += 1
    if (inv.status === 'RECEIVED') statusByMonth[i].entered += 1
    // CLOSED counts as accepted too: it's the status *after* PAID, so counting
    // only PAID meant closing a paid invoice retroactively removed it from the
    // accepted series and the line shrank as work was completed. prisma/seed.ts
    // has always used this same PAID-or-CLOSED definition.
    else if (inv.status === 'PAID' || inv.status === 'CLOSED') statusByMonth[i].accepted += 1
  }

  // Company names come from a second query — groupBy can't include a relation.
  const companyIds = companyCounts.map((c) => c.companyId).filter((id): id is string => id !== null)
  const companyNames = new Map(
    companyIds.length > 0
      ? (await prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, name: true },
        })).map((c) => [c.id, c.name])
      : [],
  )
  const companyBreakdown = companyCounts
    .map((c) => ({
      companyId: c.companyId,
      // Invoices with no company still count — they're shown as "unassigned"
      // rather than silently dropped, since a missing bill-to is worth seeing.
      companyName: c.companyId ? (companyNames.get(c.companyId) ?? null) : null,
      count: c._count.id,
      totalAmount: Number(c._sum?.totalAmount ?? 0),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)

  const stageLeadTimes = foldStageLeadTimes(stageRows)

  return {
    totalInvoices,
    companyBreakdown,
    stageLeadTimes,
    totalPayable: Number(totalPayable._sum?.totalAmount ?? 0),
    overdueCount,
    openCount,
    statusBreakdown: statusCounts.map((s) => ({ status: s.status, count: s._count.id })),
    // `overdue` marks the buckets that are actually past due, so the panel's
    // overdue total agrees with the Overdue KPI. It used to be derived
    // positionally (`slice(1)`, i.e. only >30 days late), so an invoice 10 days
    // overdue showed as "Overdue: 1" on the card and "Rp 0" in the panel.
    agingBuckets: [
      { label: 'Belum jatuh tempo', amount: Number(agingBuckets[0]._sum?.totalAmount ?? 0), overdue: false },
      { label: '0–30 hari', amount: Number(agingBuckets[1]._sum?.totalAmount ?? 0), overdue: true },
      { label: '31–60 hari', amount: Number(agingBuckets[2]._sum?.totalAmount ?? 0), overdue: true },
      { label: '61–90 hari', amount: Number(agingBuckets[3]._sum?.totalAmount ?? 0), overdue: true },
      { label: '> 90 hari', amount: Number(agingBuckets[4]._sum?.totalAmount ?? 0), overdue: true },
      { label: 'Tanpa jatuh tempo', amount: Number(agingBuckets[5]._sum?.totalAmount ?? 0), overdue: false },
    ],
    monthlyTrend,
    statusByMonth,
  }
}
