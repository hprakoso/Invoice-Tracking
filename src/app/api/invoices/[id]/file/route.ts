import { NextRequest, NextResponse } from 'next/server'
import { requireInvoiceAccess } from '@/lib/auth/helpers'
import { getFileBuffer, mimeTypeFor } from '@/lib/services/fileService'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // VENDOR can only access files from their own invoices — enforced once in
  // requireInvoiceAccess, shared with the OCR and upload routes.
  const { error, invoice } = await requireInvoiceAccess(id)
  if (error || !invoice) return error

  if (!invoice.filePath) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buffer = await getFileBuffer(invoice.filePath).catch(() => null)
  if (!buffer) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const contentType = mimeTypeFor(invoice.fileType)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
