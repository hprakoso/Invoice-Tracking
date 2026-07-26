import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'

function canManage(role: string, isOwner: boolean): boolean {
  return role === 'ADMIN' || role === 'GA_STAFF' || role === 'GA_MANAGER' || (role === 'VENDOR' && isOwner)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id, contactId } = await params
  const isOwner = session.user.role === 'VENDOR' && session.user.vendorId === id
  if (!canManage(session.user.role, isOwner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const contact = await prisma.vendorContact.findUnique({ where: { id: contactId } })
  if (!contact || contact.vendorId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.vendorContact.delete({ where: { id: contactId } })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'vendor.contact_removed',
      entityType: 'vendor',
      entityId: id,
      metadata: { contactName: contact.name },
    },
  })

  return NextResponse.json({ ok: true })
}
