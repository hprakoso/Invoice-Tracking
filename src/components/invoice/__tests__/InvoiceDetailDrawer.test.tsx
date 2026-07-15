import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InvoiceDetailDrawer } from '../InvoiceDetailDrawer'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const baseInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-001',
  status: 'SUBMITTED',
  totalAmount: '5000000',
  dueDate: '2026-07-01',
  invoiceDate: '2026-06-01',
  sendDate: '2026-05-28',
  deliveredDate: '2026-05-30',
  currency: 'IDR',
  ocrConfidence: null,
  vendor: { id: 'v1', name: 'PT Maju Jaya' },
  createdBy: { id: 'u1', name: 'Admin' },
  pic: { id: 'u2', name: 'Rina Kusuma' },
  items: [],
}

describe('InvoiceDetailDrawer', () => {
  it('renders nothing when invoice is null', () => {
    const { container } = render(
      <InvoiceDetailDrawer invoice={null} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders invoice number when open', () => {
    render(
      <InvoiceDetailDrawer invoice={baseInvoice} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(screen.getByText('INV-001')).toBeInTheDocument()
  })

  it('renders vendor name', () => {
    render(
      <InvoiceDetailDrawer invoice={baseInvoice} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(screen.getByText('PT Maju Jaya')).toBeInTheDocument()
  })

  it('does not crash when pic is null', () => {
    expect(() =>
      render(
        <InvoiceDetailDrawer
          invoice={{ ...baseInvoice, pic: null }}
          onClose={() => {}}
          onRefresh={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('does not crash when sendDate/deliveredDate are undefined', () => {
    const invoiceWithoutDates = { ...baseInvoice, sendDate: undefined, deliveredDate: undefined }
    expect(() =>
      render(
        <InvoiceDetailDrawer
          invoice={invoiceWithoutDates}
          onClose={() => {}}
          onRefresh={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('shows PIC name when assigned', () => {
    render(
      <InvoiceDetailDrawer invoice={baseInvoice} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(screen.getByText('Rina Kusuma')).toBeInTheDocument()
  })

  it('shows placeholder when PIC is unassigned', () => {
    render(
      <InvoiceDetailDrawer invoice={{ ...baseInvoice, pic: null }} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
