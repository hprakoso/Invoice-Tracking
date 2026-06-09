/**
 * Shared formatting utilities used across all dashboard pages.
 * Centralised here so locale/currency changes only need to be made once.
 */

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

/** Return true when an invoice's due date has passed and its status is still active. */
export function isOverdue(dueDate: string | null | undefined, status?: string): boolean {
  if (!dueDate) return false
  if (status && ['PAID', 'REJECTED'].includes(status)) return false
  return new Date(dueDate) < new Date()
}
