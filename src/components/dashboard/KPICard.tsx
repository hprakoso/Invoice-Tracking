'use client'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useCountUp } from '@/hooks/useCountUp'

interface KPICardProps {
  title: string
  value: number
  icon: ReactNode
  color: 'blue' | 'green' | 'red' | 'orange'
  format?: 'number' | 'currency'
  subtitle?: string
}

const colorMap = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    icon: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    value: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-100 dark:border-blue-900/50',
    accent: 'border-l-blue-500 dark:border-l-blue-400',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    icon: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-100 dark:border-emerald-900/50',
    accent: 'border-l-emerald-500 dark:border-l-emerald-400',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    icon: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    value: 'text-red-700 dark:text-red-300',
    border: 'border-red-100 dark:border-red-900/50',
    accent: 'border-l-red-500 dark:border-l-red-400',
  },
  orange: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    icon: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
    value: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-100 dark:border-amber-900/50',
    accent: 'border-l-amber-500 dark:border-l-amber-400',
  },
}

function formatValue(val: number, format: 'number' | 'currency') {
  if (format === 'currency') {
    if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(1)}M`
    if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(0)}jt`
    return `Rp ${val.toLocaleString('id-ID')}`
  }
  return val.toLocaleString('id-ID')
}

export function KPICard({ title, value, icon, color, format = 'number', subtitle }: KPICardProps) {
  const animated = useCountUp(value)
  const c = colorMap[color]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`rounded-xl border-l-4 border ${c.accent} ${c.border} ${c.bg} p-4 sm:p-5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{title}</p>
          <p className={`text-2xl sm:text-3xl font-bold mt-1.5 ${c.value}`}>
            {formatValue(animated, format)}
          </p>
          {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <span className={`rounded-lg p-2.5 flex-shrink-0 inline-flex items-center justify-center ${c.icon}`} aria-hidden="true">
          {icon}
        </span>
      </div>
    </motion.div>
  )
}
