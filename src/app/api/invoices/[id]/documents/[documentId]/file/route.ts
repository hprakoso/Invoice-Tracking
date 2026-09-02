import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { getFileBuffer } from '@/lib/services/fileService'

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

// Per-document sibling of GET /api/invoices/[id]/file (which serves only the
// legacy single Invoice.filePath). Same auth rule: VENDOR reaches its own
// vendor's invoices and nothing else.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id, documentId } = await params

  // Scoped by invoiceId as well as document id, so a document id from another
  // invoice can't be fetched by pairing it with an invoice the caller may see.
  const document = await prisma.invoiceDocument.findFirst({
    where: { id: documentId, invoiceId: id },
    select: { filePath: true, fileType: true, invoice: { select: { vendorId: true } } },
  })

  if (!document) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  if (session.user.role === 'VENDOR' && document.invoice.vendorId !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const buffer = await getFileBuffer(document.filePath).catch(() => null)
  if (!buffer) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': MIME_MAP[document.fileType] ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
