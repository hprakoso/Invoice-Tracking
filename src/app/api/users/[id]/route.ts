import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { z } from 'zod'

const patchUserSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'FINANCE', 'VIEWER', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']).optional(),
  isActive: z.boolean().optional(),
  vendorId: z.string().uuid().optional().nullable(),
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

  const current = await prisma.user.findUnique({ where: { id }, select: { role: true, vendorId: true } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nextRole = data.role ?? current.role
  const nextVendorId = data.vendorId !== undefined ? data.vendorId : current.vendorId
  if (nextRole === 'VENDOR' && !nextVendorId) {
    return NextResponse.json({ error: 'vendorId is required for VENDOR role' }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role: data.role, isActive: data.isActive, vendorId: nextRole === 'VENDOR' ? nextVendorId : null },
    select: { id: true, name: true, email: true, role: true, vendorId: true, isActive: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'user.role_updated',
      entityType: 'user',
      entityId: id,
      metadata: { from: current.role, to: user.role },
    },
  })

  return NextResponse.json(user)
}
