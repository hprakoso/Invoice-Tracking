/**
 * Shared formatting utilities used across all dashboard pages.
 * Centralised here so locale/currency changes only need to be made once.
 */

import { NON_OPEN_STATUSES } from './invoiceStatus'

/** Format a number or numeric string as Indonesian Rupiah (e.g. "Rp 1.500.000"). */
export function formatIDR(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const num = Number(v)
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(num)
}

/**
 * Parse an amount written the way Indonesian users (and Indonesian invoices)
 * write it: `.` groups thousands and `,` marks decimals.
 *
 *   '1.500.000'    -> 1500000
 *   'Rp 1.500.000' -> 1500000
 *   '1.500.000,50' -> 1500000.5
 *   '1500000'      -> 1500000
 *   'N/A'          -> null
 *
 * Replaces `parseFloat(raw.replace(/[^0-9.]/g, ''))`, which kept the dots — so
 * a user correcting a total to '1.500.000' stored **1.5**, roughly one
 * millionth of the real amount, with nothing anywhere flagging it.
 *
 * Returns null (not 0, not NaN) when there is no usable number, so callers can
 * tell "absent" from "zero" instead of coercing a genuine 0 away.
 */
export function parseAmountID(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null

  const cleaned = raw.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(cleaned)) return null

  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  const groupsOfThree = (s: string, sep: string) =>
    s.split(sep).length - 1 > 1 || s.length - s.lastIndexOf(sep) - 1 === 3

  let normalised: string
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    normalised =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // Repeated commas can only be thousands grouping; a single one is decimal.
    normalised = cleaned.split(',').length - 1 > 1
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(',', '.')
  } else if (lastDot >= 0) {
    // '12.500.000' and '1.500' are grouped thousands; '1.5' is a decimal.
    normalised = groupsOfThree(cleaned, '.') ? cleaned.replace(/\./g, '') : cleaned
  } else {
    normalised = cleaned
  }

  const value = Number(normalised)
  return Number.isFinite(value) ? value : null
}

/** Format an ISO date string as a localised Indonesian date (e.g. "15 Jan 2026"). */
export function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Format an ISO date string with time (e.g. "15 Jan 2026, 10:30"). */
export function formatDateTime(d: string): string {
  return new Date(d).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Return a human-readable relative time string (e.g. "5 mnt lalu"). */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Baru saja'
  if (mins < 60) return `${mins} mnt lalu`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  return `${days} hari lalu`
}

/**
 * Start of today in Jakarta (WIB = UTC+7, no DST), expressed as the UTC-midnight
 * instant that `invoices.due_date` stores for that calendar date.
 *
 * Every overdue check goes through this instead of comparing a due date against
 * `new Date()`. Due dates are stored as UTC midnight of a calendar day, so a
 * raw `dueDate < now` comparison flipped an invoice to "overdue" at 00:00 UTC —
 * 07:00 WIB **on its own due day**, mid-morning for the people using the app.
 */
export function jakartaDayStart(now: Date = new Date()): Date {
  const wib = new Date(now.getTime() + 7 * 3_600_000)
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()))
}

/**
 * Return true when an invoice's due date has passed and its status is still
 * active. An invoice due *today* is not overdue.
 *
 * `status` is required: an omitted status used to fall through and tag settled
 * invoices as overdue.
 */
export function isOverdue(
  dueDate: string | Date | null | undefined,
  status: string,
  now: Date = new Date(),
): boolean {
  if (!dueDate) return false
  if ((NON_OPEN_STATUSES as readonly string[]).includes(status)) return false
  return new Date(dueDate) < jakartaDayStart(now)
}
