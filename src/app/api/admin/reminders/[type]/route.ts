import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { updateReminderSettingSchema, validationErrorResponse, REMINDER_TYPES } from '@/lib/validations'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const { type } = await params
  if (!REMINDER_TYPES.includes(type as (typeof REMINDER_TYPES)[number])) {
    return NextResponse.json({ error: 'Unknown reminder type' }, { status: 404 })
  }

  const parsed = updateReminderSettingSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)

  const current = await prisma.reminderSetting.findUnique({ where: { type } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const setting = await prisma.reminderSetting.update({
    where: { type },
    data: { ...parsed.data, updatedById: session.user.id },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'reminder_setting.updated',
      entityType: 'reminder_setting',
      entityId: setting.id,
      metadata: { type, fields: Object.keys(parsed.data) },
    },
  })

  return NextResponse.json(setting)
}
