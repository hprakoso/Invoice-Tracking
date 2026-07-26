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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { filePath: true, fileType: true, vendorId: true },
  })

  // VENDOR can only access files from their own invoices
  if (session.user.role === 'VENDOR' && invoice?.vendorId !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!invoice?.filePath) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buffer = await getFileBuffer(invoice.filePath).catch(() => null)
  if (!buffer) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const contentType = MIME_MAP[invoice.fileType ?? ''] ?? 'application/octet-stream'

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
