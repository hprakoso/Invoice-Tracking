'use client'
import { motion } from 'framer-motion'
import { useCountUp } from '@/hooks/useCountUp'
import { formatAxisIDR } from './chartShared'

interface KPICardProps {
  title: string
  value: number
  format?: 'number' | 'currency'
  subtitle?: string
  /** 'danger' tints the figure with --destructive — the only semantic color in the strip. */
  tone?: 'default' | 'danger'
  /** Cell chrome (hairline borders between strip cells) — applied by the page grid. */
  className?: string
  /** Makes the cell a filter toggle. Omitted -> the cell stays a plain figure. */
  onSelect?: () => void
  /** Whether this card's filter is the one currently applied. */
  selected?: boolean
}

// Abbreviation comes from formatAxisIDR, the one abbreviator, rather than a
// second implementation. The local copy used toFixed, so the KPI strip rendered
// "Rp 1.5M" while the chart axes right below it rendered "Rp 1,5M" for the same
// amount — and in id-ID a dot is the *thousands* separator, so the strip's
// version was genuinely ambiguous to the audience it was written for.
function formatValue(val: number, format: 'number' | 'currency') {
  return format === 'currency' ? formatAxisIDR(val) : val.toLocaleString('id-ID')
}

/**
 * One cell of the KPI summary strip. Pure typographic hierarchy —
 * small-caps label → large tabular figure → quiet context line.
 * Borders are drawn by the surrounding grid (see page.tsx usage).
 */
export function KPICard({ title, value, format = 'number', subtitle, tone = 'default', className, onSelect, selected = false }: KPICardProps) {
  const animated = useCountUp(value)

  const body = (
    <>
      <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">{title}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl ${tone === 'danger' ? 'text-destructive' : 'text-foreground'}`}>
        {formatValue(animated, format)}
      </p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </>
  )

  const cell = `px-4 py-4 sm:px-6 sm:py-5 ${className ?? ''}`

  if (!onSelect) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className={cell}>
        {body}
      </motion.div>
    )
  }

  // A selectable card is a real <button aria-pressed>, so it is keyboard
  // reachable and announced as a toggle rather than being a div with onClick.
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`${cell} cursor-pointer text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
        selected ? 'bg-foreground/[0.06] dark:bg-foreground/10' : 'hover:bg-foreground/[0.03]'
      }`}
    >
      {body}
    </motion.button>
  )
}
