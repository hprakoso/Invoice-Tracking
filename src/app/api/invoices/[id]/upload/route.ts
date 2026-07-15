import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { saveUploadedFile } from '@/lib/services/fileService'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireRole(['FINANCE', 'ADMIN', 'VENDOR', 'GA_STAFF'])
  if (error || !session) return error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // VENDOR can only upload to their own invoices
  if (session.user.role === 'VENDOR') {
    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { vendorId: true } })
    if (!invoice || invoice.vendorId !== session.user.vendorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use PDF, JPG, or PNG.' }, { status: 400 })
  }

  // Verify file signature (magic bytes) to prevent MIME spoofing
  const buffer = Buffer.from(await file.arrayBuffer())
  const signature = buffer.subarray(0, 8).toString('hex').toUpperCase()

  const magicSignatures: Record<string, string[]> = {
    pdf: ['25504446'],
    jpg: ['FFD8FF'],
    jpeg: ['FFD8FF'],
    png: ['89504E470D0A1A0A'],
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const expectedSig = magicSignatures[ext]
  const matched = expectedSig?.some((sig) => signature.startsWith(sig))

  if (!expectedSig || !matched) {
    return NextResponse.json(
      { error: 'File content does not match its extension. Only valid PDF, JPG, or PNG files are accepted.' },
      { status: 400 },
    )
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large. Maximum 10MB.' }, { status: 400 })
  }

  const { filePath, fileType } = await saveUploadedFile(file, id, buffer)

  const invoice = await prisma.invoice.update({
    where: { id },
    data: { filePath, fileType },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.file_uploaded',
      entityType: 'invoice',
      entityId: id,
      metadata: { fileName: file.name, fileType },
    },
  })

  return NextResponse.json(invoice)
}
