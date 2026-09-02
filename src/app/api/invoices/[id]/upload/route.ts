import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import type { InvoiceDocumentType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { saveUploadedFile } from '@/lib/services/fileService'
import { classifyDocument } from '@/lib/services/geminiExtraction'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireRole(['ADMIN', 'VENDOR', 'GA_STAFF', 'GA_MANAGER'])
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

  // One document row per uploaded file, keyed by its own id so several files
  // can coexist under one invoice (the old "{invoiceId}.{ext}" key had exactly
  // one slot and silently overwrote).
  const documentId = randomUUID()
  const { filePath, fileType } = await saveUploadedFile(file, id, documentId, buffer)

  // `primary` marks the file the wizard drives OCR from; it's classified by
  // the full extraction call later, so classifying it again here would be a
  // wasted request. Everything else gets the cheap classify-only call.
  const isPrimary = formData.get('primary') === 'true'
  let type: InvoiceDocumentType = 'OTHER'
  let classificationConfidence: number | null = null
  if (!isPrimary) {
    try {
      const result = await classifyDocument(buffer, file.type)
      type = result.type
      classificationConfidence = result.confidence
    } catch {
      // Classification is best-effort — a Gemini outage or missing API key
      // must not lose the user's file. It stays OTHER and can be set by hand.
      type = 'OTHER'
    }
  }

  const document = await prisma.invoiceDocument.create({
    data: {
      id: documentId,
      invoiceId: id,
      type,
      filePath,
      fileType,
      originalName: file.name,
      classificationConfidence,
      uploadedById: session.user.id,
    },
  })

  // Legacy single-file columns still point at the primary document so the
  // pre-multi-file read paths keep working until they're removed.
  if (isPrimary) {
    await prisma.invoice.update({ where: { id }, data: { filePath, fileType } })
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.file_uploaded',
      entityType: 'invoice',
      entityId: id,
      metadata: { documentId, fileName: file.name, fileType, type, classificationConfidence },
    },
  })

  return NextResponse.json(document)
}
