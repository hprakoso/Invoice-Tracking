import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import { createVendorSchema, validationErrorResponse } from '@/lib/validations'

export async function GET() {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  // VENDOR only ever needs (and may see) their own vendor record.
  if (session.user.role === 'VENDOR') {
    if (!session.user.vendorId) return NextResponse.json([])
    const own = await prisma.vendor.findUnique({ where: { id: session.user.vendorId } })
    return NextResponse.json(own ? [own] : [])
  }

  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, npwp: true, contactEmail: true, bankName: true },
  })

  return NextResponse.json(vendors)
}

export async function POST(req: Request) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const parsed = createVendorSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)

  const vendor = await prisma.vendor.create({ data: parsed.data })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'vendor.created',
      entityType: 'vendor',
      entityId: vendor.id,
      metadata: { name: vendor.name },
    },
  })

  return NextResponse.json(vendor, { status: 201 })
}
