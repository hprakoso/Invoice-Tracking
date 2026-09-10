import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { z } from 'zod'

const patchUserSchema = z.object({
  role: z.enum(['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']).optional(),
  isActive: z.boolean().optional(),
  vendorId: z.string().uuid().optional().nullable(),
  // Login identity. A vendor may never change its own — there is no
  // self-service route that writes users.email for any role — so an admin
  // making the change here is the only path, which is what makes the
  // restriction workable rather than a dead end.
  email: z.string().email().optional(),
  // An admin-issued replacement password. Never the account's final secret:
  // it re-arms mustChangePassword below, so the user is forced to set a
  // private one at their next sign-in and no admin holds a live credential.
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const { id } = await params
  const parsed = patchUserSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
  }
  const data = parsed.data

  const current = await prisma.user.findUnique({ where: { id }, select: { role: true, vendorId: true, email: true } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nextRole = data.role ?? current.role
  const nextVendorId = data.vendorId !== undefined ? data.vendorId : current.vendorId
  if (nextRole === 'VENDOR' && !nextVendorId) {
    return NextResponse.json({ error: 'vendorId is required for VENDOR role' }, { status: 400 })
  }

  const emailChanged = !!data.email && data.email !== current.email

  let user
  try {
    user = await prisma.user.update({
      where: { id },
      data: {
        role: data.role,
        isActive: data.isActive,
        vendorId: nextRole === 'VENDOR' ? nextVendorId : null,
        email: data.email,
        // Setting a password here always forces the recipient to replace it at
        // their next sign-in, for every role. The value an admin types is a
        // handover secret, not the account's password.
        ...(data.password
          ? { passwordHash: await bcrypt.hash(data.password, 12), mustChangePassword: true }
          : {}),
      },
      select: { id: true, name: true, email: true, role: true, vendorId: true, isActive: true },
    })
  } catch (e) {
    // users.email is @unique — report the collision instead of a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }
    throw e
  }

  // Credential changes are logged separately from role changes: they are the
  // events an audit actually cares about, and the old single 'user.role_updated'
  // entry would have described a password reset as a role change. The new
  // password is of course never logged.
  const actions: { action: string; metadata: Prisma.InputJsonValue }[] = []
  if (data.role && data.role !== current.role) {
    actions.push({ action: 'user.role_updated', metadata: { from: current.role, to: user.role } })
  }
  if (emailChanged) {
    actions.push({ action: 'user.email_changed', metadata: { from: current.email, to: user.email } })
  }
  if (data.password) {
    actions.push({ action: 'user.password_reset', metadata: { role: user.role, mustChangePassword: true } })
  }
  if (data.isActive !== undefined) {
    actions.push({ action: 'user.active_changed', metadata: { isActive: data.isActive } })
  }
  // A PATCH that changed only vendorId still leaves a trace.
  if (actions.length === 0) {
    actions.push({ action: 'user.updated', metadata: { fields: Object.keys(data) } })
  }

  await prisma.auditLog.createMany({
    data: actions.map((a) => ({
      userId: session.user.id,
      action: a.action,
      entityType: 'user',
      entityId: id,
      metadata: a.metadata,
    })),
  })

  return NextResponse.json(user)
}
