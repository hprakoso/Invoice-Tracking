import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KPICard } from '../KPICard'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
  },
}))

vi.mock('@/hooks/useCountUp', () => ({
  useCountUp: (n: number) => n,
}))

describe('KPICard', () => {
  const base = { title: 'Total Invoice', value: 42 }

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

  // id-ID decimal separator, matching the chart axes and tooltips on the same
  // screen. This asserted 'Rp 2.5M' while the charts rendered 'Rp 2,5M' for the
  // same amount — and a dot is the *thousands* separator in id-ID, so the old
  // output read as an entirely different number to the intended audience.
  it('formats currency in billions the same way the chart axes do', () => {
    render(<KPICard {...base} value={2_500_000_000} format="currency" />)
    expect(screen.getByText('Rp 2,5M')).toBeInTheDocument()
  })

  it('applies danger tone to the figure', () => {
    const { container } = render(<KPICard {...base} tone="danger" />)
    expect(container.querySelector('p:nth-of-type(2)')?.className).toContain('text-destructive')
  })

  it('keeps default tone foreground-colored', () => {
    const { container } = render(<KPICard {...base} />)
    expect(container.querySelector('p:nth-of-type(2)')?.className).toContain('text-foreground')
  })

  it('appends cell chrome classes passed via className', () => {
    const { container } = render(<KPICard {...base} className="border-l border-border/60" />)
    expect(container.firstElementChild?.className).toContain('border-l')
  })

  // The KPI strip doubles as the dashboard's filter control.
  describe('as a filter toggle', () => {
    it('stays a plain cell, not a control, without onSelect', () => {
      render(<KPICard {...base} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('becomes a pressable button when given onSelect', () => {
      const onSelect = vi.fn()
      render(<KPICard {...base} onSelect={onSelect} />)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(button)
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('marks the selected card as pressed', () => {
      render(<KPICard {...base} onSelect={() => {}} selected />)
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
    })

    it('still renders its figure while acting as a filter', () => {
      render(<KPICard {...base} onSelect={() => {}} selected />)
      expect(screen.getByText('42')).toBeInTheDocument()
    })
  })
})
