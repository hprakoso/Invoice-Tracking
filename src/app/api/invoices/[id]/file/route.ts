import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

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
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { filePath: true, fileType: true },
  })

  if (!invoice?.filePath || !existsSync(invoice.filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buffer = await readFile(invoice.filePath)
  const contentType = MIME_MAP[invoice.fileType ?? ''] ?? 'application/octet-stream'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
