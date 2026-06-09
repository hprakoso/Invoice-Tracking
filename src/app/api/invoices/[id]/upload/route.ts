import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { saveUploadedFile } from '@/lib/services/fileService'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireRole(['FINANCE', 'ADMIN'])
  if (error || !session) return error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use PDF, JPG, or PNG.' }, { status: 400 })
  }

  const { filePath, fileType } = await saveUploadedFile(file, id)

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      filePath,
      fileType,
      status: 'PENDING_OCR',
    },
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
