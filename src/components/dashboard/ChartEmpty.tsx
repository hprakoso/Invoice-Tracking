'use client'
import type { ReactNode } from 'react'

interface ChartEmptyProps {
  icon: ReactNode
  title: string
  hint: string
}

/** Designed empty state for charts/tables — on-brand glass ring, no dead space. */
export function ChartEmpty({ icon, title, hint }: ChartEmptyProps) {
  return (
    <div className="flex h-full min-h-44 flex-col items-center justify-center gap-3 px-6 py-10 text-center" role="status">
      <div className="relative" aria-hidden="true">
        <div className="absolute inset-0 rounded-full blur-xl" style={{ background: 'var(--glow-primary)' }} />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          {icon}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
