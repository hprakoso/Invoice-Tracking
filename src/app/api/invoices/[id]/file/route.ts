import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

// Absolute path to the allowed upload directory.
// All served files MUST live under this prefix to prevent path-traversal attacks.
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'invoices')

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

  // Confine the path to the upload directory — prevents directory traversal
  const resolvedPath = path.resolve(invoice.filePath)
  if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep) && resolvedPath !== UPLOAD_DIR) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!existsSync(resolvedPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buffer = await readFile(resolvedPath)
  const contentType = MIME_MAP[invoice.fileType ?? ''] ?? 'application/octet-stream'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
