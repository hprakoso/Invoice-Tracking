import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { updateDocumentTypeSchema, validationErrorResponse } from '@/lib/validations'

// Manual document-type override. This is the actual guarantee that a
// misclassified document gets corrected — the AI's label is a starting point,
// not the final word (see CLASSIFICATION_CONFIDENCE_FLOOR in
// src/lib/services/geminiExtraction.ts).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF', 'GA_MANAGER'])
  if (error || !session) return error

  const { id, documentId } = await params
  const body = await req.json()

  const parsed = updateDocumentTypeSchema.safeParse(body)
  if (!parsed.success) return validationErrorResponse(parsed.error)

  const existing = await prisma.invoiceDocument.findFirst({
    where: { id: documentId, invoiceId: id },
    select: { id: true, type: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const document = await prisma.invoiceDocument.update({
    where: { id: documentId },
    // classificationConfidence is cleared: it described the AI's certainty in
    // a label that no longer applies, and leaving it would make a
    // human-assigned type look machine-assigned in the UI.
    data: { type: parsed.data.type, classificationConfidence: null },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.document_reclassified',
      entityType: 'invoice',
      entityId: id,
      metadata: { documentId, from: existing.type, to: parsed.data.type },
    },
  })

  return NextResponse.json(document)
}

// Removing a document a user attached by mistake. Hard delete — the storage
// object is intentionally left in place (orphaned but harmless): deleting it
// would make an accidental click unrecoverable, and the row is what every
// read path goes through.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF', 'GA_MANAGER'])
  if (error || !session) return error

  const { id, documentId } = await params

  const existing = await prisma.invoiceDocument.findFirst({
    where: { id: documentId, invoiceId: id },
    select: { id: true, originalName: true, type: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.invoiceDocument.delete({ where: { id: documentId } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'invoice.document_removed',
      entityType: 'invoice',
      entityId: id,
      metadata: { documentId, originalName: existing.originalName, type: existing.type },
    },
  })

  return NextResponse.json({ ok: true })
}
