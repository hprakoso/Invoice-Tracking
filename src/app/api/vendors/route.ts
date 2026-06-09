import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'

export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, npwp: true, contactEmail: true, bankName: true },
  })

  return NextResponse.json(vendors)
}
