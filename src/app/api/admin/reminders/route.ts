import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'

export async function GET() {
  const { error } = await requireRole(['ADMIN'])
  if (error) return error

  const settings = await prisma.reminderSetting.findMany({ orderBy: { type: 'asc' } })
  return NextResponse.json(settings)
}
