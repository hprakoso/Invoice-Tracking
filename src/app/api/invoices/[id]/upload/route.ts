import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import type { InvoiceDocumentType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireInvoiceAccess } from '@/lib/auth/helpers'
import { rateLimit } from '@/lib/rate-limit'
import { saveUploadedFile } from '@/lib/services/fileService'
import { classifyDocument } from '@/lib/services/geminiExtraction'
import {
  ACCEPTED_MIME_TYPES,
  MAX_DOCUMENTS_PER_INVOICE,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  hasValidSignature,
} from '@/lib/uploadLimits'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // VENDOR can only upload to their own invoices — same shared guard the file
  // and OCR routes use.
  const { error, session, invoice } = await requireInvoiceAccess(id, ['ADMIN', 'VENDOR', 'GA_STAFF', 'GA_MANAGER'])
  if (error || !session || !invoice) return error

  // Every upload spends one Gemini classification call, and this route had no
  // limiter at all — the only metered AI paths were chat and OCR, so an
  // authenticated user could drive unbounded spend by uploading files. Sized
  // against MAX_DOCUMENTS_PER_INVOICE so a legitimate full submission never
  // rate-limits itself partway through.
  const limit = rateLimit(`upload:${session.user.id}`, MAX_DOCUMENTS_PER_INVOICE * 3, 60_000)
  if (limit) return limit

  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use PDF, JPG, or PNG.' }, { status: 400 })
  }

  // Verify file signature (magic bytes) to prevent MIME spoofing
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!hasValidSignature(file.name, buffer)) {
    return NextResponse.json(
      { error: 'File content does not match its extension. Only valid PDF, JPG, or PNG files are accepted.' },
      { status: 400 },
    )
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `File too large. Maximum ${MAX_FILE_SIZE_LABEL}.` }, { status: 400 })
  }

  // A submission carries several documents now, so the per-invoice count needs
  // its own ceiling: unbounded, it is both a storage and a Gemini-spend hole.
  const existingCount = await prisma.invoiceDocument.count({ where: { invoiceId: id } })
  if (existingCount >= MAX_DOCUMENTS_PER_INVOICE) {
    return NextResponse.json(
      { error: `Maximum ${MAX_DOCUMENTS_PER_INVOICE} documents per invoice.` },
      { status: 400 },
    )
  }

  // One document row per uploaded file, keyed by its own id so several files
  // can coexist under one invoice (the old "{invoiceId}.{ext}" key had exactly
  // one slot and silently overwrote).
  const documentId = randomUUID()
  const { filePath, fileType } = await saveUploadedFile(file, id, documentId, buffer)

  // Every file is classified, including the first. The wizard used to flag one
  // file as `primary` and skip classifying it, because the extraction call that
  // immediately followed classified it for free. Extraction no longer follows
  // immediately — it runs after all uploads, and it is the classification of
  // *all* files that decides which document it should read. So the label has to
  // exist before then.
  let type: InvoiceDocumentType = 'OTHER'
  let classificationConfidence: number | null = null
  try {
    const result = await classifyDocument(buffer, file.type)
    type = result.type
    classificationConfidence = result.confidence
  } catch {
    // Classification is best-effort — a Gemini outage or missing API key
    // must not lose the user's file. It stays OTHER and can be set by hand.
    type = 'OTHER'
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

  // Legacy single-file columns. The OCR route repoints these at whichever
  // document it picks to extract from; this only seeds them, so that an
  // invoice whose OCR never ran still has a readable file for the three
  // remaining mirror readers (the /file endpoint, the detail page's fallback
  // preview, and OCR itself).
  if (!invoice.filePath) {
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
