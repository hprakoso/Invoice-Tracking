import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { vendorContactSchema, validationErrorResponse } from '@/lib/validations'

function canManage(role: string, isOwner: boolean): boolean {
  return role === 'ADMIN' || role === 'GA_STAFF' || role === 'GA_MANAGER' || (role === 'VENDOR' && isOwner)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params
  if (session.user.role === 'VENDOR' && id !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const contacts = await prisma.vendorContact.findMany({ where: { vendorId: id }, orderBy: { name: 'asc' } })
  return NextResponse.json(contacts)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params
  const isOwner = session.user.role === 'VENDOR' && session.user.vendorId === id
  if (!canManage(session.user.role, isOwner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } })
  if (!vendor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = vendorContactSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)

  const contact = await prisma.vendorContact.create({ data: { ...parsed.data, vendorId: id } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'vendor.contact_added',
      entityType: 'vendor',
      entityId: id,
      metadata: { contactName: contact.name },
    },
  })

  return NextResponse.json(contact, { status: 201 })
}
