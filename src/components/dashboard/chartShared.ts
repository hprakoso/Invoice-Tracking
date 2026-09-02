/**
 * Shared chart constants + formatters for the dashboard charts.
 * Colors stay token-driven (var(--chart-*)) so dark/light both resolve;
 * amber is the one deliberate exception — it reads as "in flight"/warning
 * everywhere else in the app (StatusBadge, PIC stage chips).
 */

// healthy → danger: teal (0–30) → amber (31–60) → orange (61–90) → red (>90)
export const AGING_COLORS = ['var(--chart-2)', '#f59e0b', '#f97316', 'var(--destructive)']

/** Compact IDR for axis ticks, e.g. "Rp 1,5M" / "Rp 250jt" — full precision lives in tooltips. */
export function formatAxisIDR(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000_000) return `Rp ${(v / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`
  return `Rp ${v.toLocaleString('id-ID')}`
}

/** 'YYYY-MM' → short month tick ("Jan", with "Jan 26" on January + range start). */
export function formatMonthAxis(month: string, index: number) {
  const d = new Date(`${month}-01T00:00:00Z`)
  const label = d.toLocaleDateString('id-ID', { month: 'short' })
  if (d.getUTCMonth() === 0 || index === 0) return `${label} ${String(d.getUTCFullYear()).slice(2)}`
  return label
}

/** 'YYYY-MM' → "Januari 2026" for tooltips. */
export function formatMonthFull(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}
