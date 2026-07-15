import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { getDashboardStats } from '@/lib/services/dashboardStats'

export async function GET() {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const vendorFilter = session.user.role === 'VENDOR'
    ? { vendorId: session.user.vendorId ?? undefined }
    : {}

  const [stats, invoices] = await Promise.all([
    getDashboardStats(vendorFilter),
    prisma.invoice.findMany({
      where: vendorFilter,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } }, createdBy: { select: { name: true } }, pic: { select: { name: true } } },
    }),
  ])

  const wb = new ExcelJS.Workbook()

  const summary = wb.addWorksheet('KPI Summary')
  summary.addRows([
    ['Total Invoices', stats.totalInvoices],
    ['Total Payable (open)', stats.totalPayable],
    ['Overdue Count', stats.overdueCount],
    ['Open (Awaiting Action)', stats.openCount],
    [],
    ['Status', 'Count'],
    ...stats.statusBreakdown.map((s) => [s.status, s.count]),
    [],
    ['Aging Bucket', 'Amount'],
    ...stats.agingBuckets.map((b) => [b.label, b.amount]),
  ])

  const sheet = wb.addWorksheet('Invoices')
  sheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNumber', width: 20 },
    { header: 'Vendor', key: 'vendor', width: 24 },
    { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 14 },
    { header: 'Send Date', key: 'sendDate', width: 14 },
    { header: 'Delivered Date', key: 'deliveredDate', width: 14 },
    { header: 'PIC', key: 'pic', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Subtotal', key: 'subtotal', width: 16 },
    { header: 'Tax Amount', key: 'taxAmount', width: 16 },
    { header: 'Total Amount', key: 'totalAmount', width: 16 },
    { header: 'Created By', key: 'createdBy', width: 20 },
    { header: 'Created At', key: 'createdAt', width: 14 },
    { header: 'Notes', key: 'notes', width: 30 },
  ]
  for (const inv of invoices) {
    sheet.addRow({
      invoiceNumber: inv.invoiceNumber,
      vendor: inv.vendor.name,
      invoiceDate: inv.invoiceDate?.toISOString().slice(0, 10) ?? '',
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? '',
      sendDate: inv.sendDate?.toISOString().slice(0, 10) ?? '',
      deliveredDate: inv.deliveredDate?.toISOString().slice(0, 10) ?? '',
      pic: inv.pic?.name ?? '',
      status: inv.status,
      currency: inv.currency,
      subtotal: inv.subtotal ? Number(inv.subtotal) : '',
      taxAmount: inv.taxAmount ? Number(inv.taxAmount) : '',
      totalAmount: Number(inv.totalAmount),
      createdBy: inv.createdBy.name,
      createdAt: inv.createdAt.toISOString().slice(0, 10),
      notes: inv.notes ?? '',
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `dashboard-export-${new Date().toISOString().slice(0, 10)}.xlsx`

  return new NextResponse(new Blob([buffer]), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
