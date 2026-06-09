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
  status: 'PENDING_APPROVAL',
  totalAmount: '5000000',
  dueDate: '2026-07-01',
  invoiceDate: '2026-06-01',
  currency: 'IDR',
  ocrConfidence: null,
  vendor: { id: 'v1', name: 'PT Maju Jaya' },
  createdBy: { id: 'u1', name: 'Admin' },
  items: [],
  approvals: [],
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

  it('does not crash when approvals is an empty array', () => {
    expect(() =>
      render(
        <InvoiceDetailDrawer
          invoice={{ ...baseInvoice, approvals: [] }}
          onClose={() => {}}
          onRefresh={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('does not crash when approvals is undefined — regression for TypeError at line 206', () => {
    const invoiceWithoutApprovals = { ...baseInvoice, approvals: undefined as unknown as [] }
    expect(() =>
      render(
        <InvoiceDetailDrawer
          invoice={invoiceWithoutApprovals}
          onClose={() => {}}
          onRefresh={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('shows approval step labels', () => {
    render(
      <InvoiceDetailDrawer invoice={baseInvoice} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(screen.getByText('Finance Review')).toBeInTheDocument()
    expect(screen.getByText('Manager Approval')).toBeInTheDocument()
  })

  it('shows approver name when step 1 is approved', () => {
    const invoice = {
      ...baseInvoice,
      approvals: [
        { id: 'a1', step: 1, status: 'APPROVED', comment: null, actionedAt: '2026-06-05T10:00:00Z', approver: { id: 'u2', name: 'Siti', role: 'FINANCE' } },
      ],
    }
    render(
      <InvoiceDetailDrawer invoice={invoice} onClose={() => {}} onRefresh={() => {}} />
    )
    expect(screen.getByText('Siti')).toBeInTheDocument()
  })
})
