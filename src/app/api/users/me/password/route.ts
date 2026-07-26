import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { changePasswordSchema, validationErrorResponse } from '@/lib/validations'

export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const parsed = changePasswordSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)
  const { currentPassword, newPassword } = parsed.data

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 12),
      mustChangePassword: false,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'user.password_changed',
      entityType: 'user',
      entityId: user.id,
    },
  })

  return NextResponse.json({ ok: true })
}
