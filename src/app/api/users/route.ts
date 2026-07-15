import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { createUserSchema, validationErrorResponse } from '@/lib/validations'

export async function GET(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'FINANCE'])
  if (error || !session) return error

  const role = req.nextUrl.searchParams.get('role')

  const users = await prisma.user.findMany({
    where: role ? { role: role as never } : undefined,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true, vendorId: true, isActive: true },
  })

  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const parsed = createUserSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)
  const data = parsed.data

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      role: data.role,
      vendorId: data.role === 'VENDOR' ? data.vendorId : null,
      passwordHash: await bcrypt.hash(data.password, 12),
    },
    select: { id: true, name: true, email: true, role: true, vendorId: true, isActive: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    },
  })

  return NextResponse.json(user, { status: 201 })
}
