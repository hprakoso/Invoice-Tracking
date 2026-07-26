import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { updateCompanySchema, validationErrorResponse } from '@/lib/validations'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF'])
  if (error || !session) return error

  const { id } = await params
  const parsed = updateCompanySchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)

  const current = await prisma.company.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const company = await prisma.company.update({ where: { id }, data: parsed.data })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'company.updated',
      entityType: 'company',
      entityId: id,
      metadata: { fields: Object.keys(parsed.data) },
    },
  })

  return NextResponse.json(company)
}

// Soft delete — invoices already pointing at this company keep a valid
// reference; it just stops showing up as a selectable option going forward.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF'])
  if (error || !session) return error

  const { id } = await params
  const current = await prisma.company.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.company.update({ where: { id }, data: { isActive: false } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'company.deactivated',
      entityType: 'company',
      entityId: id,
    },
  })

  return NextResponse.json({ ok: true })
}
