import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth()
  if (error || !session) return error!

  const { id } = await params

  await prisma.notification.update({
    where: { id, userId: session.user.id },
    data: { isRead: true, readAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
