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
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', value: 'text-blue-700', border: 'border-blue-100' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', value: 'text-green-700', border: 'border-green-100' },
  red: { bg: 'bg-red-50', icon: 'text-red-600', value: 'text-red-700', border: 'border-red-100' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600', value: 'text-orange-700', border: 'border-orange-100' },
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
      className={`rounded-xl border ${c.border} ${c.bg} p-4 sm:p-5`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className={`text-2xl sm:text-3xl font-bold mt-1 ${c.value}`}>
            {formatValue(animated, format)}
          </p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
        </div>
        <div className={`rounded-lg p-2 ${c.bg}`}>
          <span className={c.icon} aria-hidden="true">{icon}</span>
        </div>
      </div>
    </motion.div>
  )
}
