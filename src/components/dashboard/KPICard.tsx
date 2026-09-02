'use client'
import { motion } from 'framer-motion'
import { useCountUp } from '@/hooks/useCountUp'

interface KPICardProps {
  title: string
  value: number
  format?: 'number' | 'currency'
  subtitle?: string
  /** 'danger' tints the figure with --destructive — the only semantic color in the strip. */
  tone?: 'default' | 'danger'
  /** Cell chrome (hairline borders between strip cells) — applied by the page grid. */
  className?: string
}

function formatValue(val: number, format: 'number' | 'currency') {
  if (format === 'currency') {
    if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(1)}M`
    if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(0)}jt`
    return `Rp ${val.toLocaleString('id-ID')}`
  }
  return val.toLocaleString('id-ID')
}

/**
 * One cell of the KPI summary strip. Pure typographic hierarchy —
 * small-caps label → large tabular figure → quiet context line.
 * Borders are drawn by the surrounding grid (see page.tsx usage).
 */
export function KPICard({ title, value, format = 'number', subtitle, tone = 'default', className }: KPICardProps) {
  const animated = useCountUp(value)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`px-4 py-4 sm:px-6 sm:py-5 ${className ?? ''}`}
    >
      <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">{title}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl ${tone === 'danger' ? 'text-destructive' : 'text-foreground'}`}>
        {formatValue(animated, format)}
      </p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </motion.div>
  )
}
