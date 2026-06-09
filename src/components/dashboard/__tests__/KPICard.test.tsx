import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileText, DollarSign, AlertTriangle, Clock } from 'lucide-react'
import { KPICard } from '../KPICard'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@/hooks/useCountUp', () => ({
  useCountUp: (n: number) => n,
}))

describe('KPICard', () => {
  const base = {
    title: 'Total Invoice',
    value: 42,
    icon: <FileText className="h-5 w-5" />,
    color: 'blue' as const,
  }

  it('renders the title', () => {
    render(<KPICard {...base} />)
    expect(screen.getByText('Total Invoice')).toBeInTheDocument()
  })

  it('renders a numeric value', () => {
    render(<KPICard {...base} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders subtitle when provided', () => {
    render(<KPICard {...base} subtitle="Belum dibayar" />)
    expect(screen.getByText('Belum dibayar')).toBeInTheDocument()
  })

  it('omits subtitle when not provided', () => {
    render(<KPICard {...base} />)
    expect(screen.queryByText('Belum dibayar')).not.toBeInTheDocument()
  })

  it('formats currency in millions', () => {
    render(<KPICard {...base} value={5_000_000} format="currency" />)
    expect(screen.getByText('Rp 5jt')).toBeInTheDocument()
  })

  it('formats currency in billions', () => {
    render(<KPICard {...base} value={2_500_000_000} format="currency" />)
    expect(screen.getByText('Rp 2.5M')).toBeInTheDocument()
  })

  it('accepts ReactNode icon without crashing — RSC boundary fix', () => {
    const icons = [
      <FileText key="f" className="h-5 w-5" />,
      <DollarSign key="d" className="h-5 w-5" />,
      <AlertTriangle key="a" className="h-5 w-5" />,
      <Clock key="c" className="h-5 w-5" />,
    ]
    for (const icon of icons) {
      const { unmount } = render(<KPICard {...base} icon={icon} />)
      expect(screen.getByText('Total Invoice')).toBeInTheDocument()
      unmount()
    }
  })

  it.each([
    ['blue', 'text-blue-600'],
    ['green', 'text-green-600'],
    ['red', 'text-red-600'],
    ['orange', 'text-orange-600'],
  ] as const)('applies %s colour class to icon wrapper', (color, cls) => {
    const { container } = render(<KPICard {...base} color={color} />)
    expect(container.querySelector('span')?.className).toContain(cls)
  })
})
