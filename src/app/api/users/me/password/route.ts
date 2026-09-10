import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { canChangeOwnPassword } from '@/lib/auth/permissions'
import { changePasswordSchema, validationErrorResponse } from '@/lib/validations'

export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const parsed = changePasswordSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)
  const { currentPassword, newPassword } = parsed.data

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A vendor gets exactly one self-service change — the forced one at first
  // login. Afterwards only an admin can issue a new password, which re-arms
  // the flag and grants another single change. Read from the database rather
  // than the session: the JWT is stateless and its copy of the flag can lag an
  // admin reset by up to the token's lifetime.
  if (!canChangeOwnPassword(user.role, user.mustChangePassword)) {
    return NextResponse.json(
      { error: 'Password changes for vendor accounts are handled by the administrator' },
      { status: 403 },
    )
  }

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
