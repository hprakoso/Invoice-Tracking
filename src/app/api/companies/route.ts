import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireRole } from '@/lib/auth/helpers'
import { createCompanySchema, validationErrorResponse } from '@/lib/validations'

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const includeInactive = req.nextUrl.searchParams.get('includeInactive') === 'true'

  const companies = await prisma.company.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(companies)
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF'])
  if (error || !session) return error

  const parsed = createCompanySchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)
  const data = parsed.data

  const company = await prisma.company.create({ data })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'company.created',
      entityType: 'company',
      entityId: company.id,
      metadata: { name: company.name },
    },
  })

  return NextResponse.json(company, { status: 201 })
}
