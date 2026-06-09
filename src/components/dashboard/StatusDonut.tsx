'use client'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const STATUS_COLORS: Record<string, string> = {
  PENDING_OCR: '#94a3b8',
  PENDING_REVIEW: '#fbbf24',
  PENDING_APPROVAL: '#60a5fa',
  APPROVED: '#34d399',
  REJECTED: '#f87171',
  PAID: '#a78bfa',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_OCR: 'OCR',
  PENDING_REVIEW: 'Review',
  PENDING_APPROVAL: 'Approval',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  PAID: 'Dibayar',
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
          formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
