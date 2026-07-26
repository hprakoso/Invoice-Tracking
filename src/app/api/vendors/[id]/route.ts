import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { updateVendorSchema, validationErrorResponse } from '@/lib/validations'

// name/npwp are locked to ADMIN — both are used to match tax documents, and a
// vendor changing them unilaterally would break that audit trail. Everyone
// else editing (self-service VENDOR, or ADMIN/GA_STAFF/GA_MANAGER managing
// any vendor) gets the rest of the profile.
const SELF_SERVICE_FIELDS = [
  'contactName', 'contactEmail', 'bankName', 'bankAccount',
  'address', 'city', 'phone', 'bankAccountHolder', 'bankBranch',
] as const

function allowedVendorFields(role: string, isOwner: boolean): string[] {
  if (role === 'ADMIN') return [...SELF_SERVICE_FIELDS, 'name', 'npwp', 'isActive']
  if (role === 'GA_STAFF' || role === 'GA_MANAGER') return [...SELF_SERVICE_FIELDS, 'isActive']
  if (role === 'VENDOR' && isOwner) return [...SELF_SERVICE_FIELDS]
  return []
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params
  if (session.user.role === 'VENDOR' && id !== session.user.vendorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { contacts: true },
  })
  if (!vendor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(vendor)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const { id } = await params
  const parsed = updateVendorSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)
  const data = parsed.data

  const current = await prisma.vendor.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = session.user.role === 'VENDOR' && session.user.vendorId === id
  const allowed = allowedVendorFields(session.user.role, isOwner)
  const filtered = Object.fromEntries(
    Object.entries(data).filter(([key, value]) => allowed.includes(key) && value !== undefined),
  )

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const vendor = await prisma.vendor.update({ where: { id }, data: filtered })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'vendor.updated',
      entityType: 'vendor',
      entityId: id,
      metadata: { fields: Object.keys(filtered) },
    },
  })

  return NextResponse.json(vendor)
}
