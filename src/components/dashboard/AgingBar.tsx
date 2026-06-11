'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface AgingBucket {
  label: string
  amount: number
}

function formatIDR(val: number) {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}M`
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(0)}jt`
  return val.toLocaleString('id-ID')
}

const BUCKET_COLORS = ['#34d399', '#fbbf24', '#fb923c', '#f87171']

export function AgingBar({ data }: { data: AgingBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={formatIDR} tick={{ fontSize: 11 }} width={50} />
        <Tooltip
          formatter={(value) => {
            const num = typeof value === 'number' ? value : Number(value)
            return [`Rp ${num.toLocaleString('id-ID')}`, 'Amount']
          }}
          labelStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={BUCKET_COLORS[i % BUCKET_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
