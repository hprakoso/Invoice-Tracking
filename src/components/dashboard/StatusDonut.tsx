'use client'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: '#60a5fa',
  REVISION: '#fbbf24',
  CANCELLED: '#94a3b8',
  REJECTED: '#f87171',
  VOID: '#64748b',
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Diajukan',
  REVISION: 'Revisi',
  CANCELLED: 'Dibatalkan',
  REJECTED: 'Ditolak',
  VOID: 'Void',
}

interface StatusBreakdown {
  status: string
  count: number
}

export function StatusDonut({ data }: { data: StatusBreakdown[] }) {
  const chartData = data.map(d => ({
    name: STATUS_LABELS[d.status] ?? d.status,
    value: d.count,
    color: STATUS_COLORS[d.status] ?? '#94a3b8',
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(value, name) => [value, name]} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => <span className="text-xs text-gray-600 dark:text-gray-300">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
