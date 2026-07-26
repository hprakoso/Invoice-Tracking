import { prisma } from '@/lib/db/prisma'
import type { InvoiceStatus, Role } from '@prisma/client'

const OPEN_STATUSES: InvoiceStatus[] = ['SUBMITTED', 'REVISION']

export async function checkDueDates() {
  const [dueSoonSetting, overdueSetting] = await Promise.all([
    prisma.reminderSetting.findUnique({ where: { type: 'due_soon' } }),
    prisma.reminderSetting.findUnique({ where: { type: 'overdue' } }),
  ])

  const now = new Date()
  const notifications: {
    userId: string
    invoiceId: string
    type: string
    title: string
    body: string
  }[] = []

  let dueSoonCount = 0
  let overdueCount = 0

  if (dueSoonSetting?.isActive && dueSoonSetting.inAppEnabled) {
    const days = dueSoonSetting.daysBefore ?? 3
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    const dueSoon = await prisma.invoice.findMany({
      where: { status: { in: OPEN_STATUSES }, dueDate: { gte: now, lte: threshold } },
      include: { vendor: { select: { name: true } } },
    })
    dueSoonCount = dueSoon.length
    const recipients = await recipientsForRoles(dueSoonSetting.recipientRoles)
    for (const invoice of dueSoon) {
      for (const user of recipients) {
        if (await alreadyNotifiedToday(user.id, invoice.id, 'due_soon')) continue
        notifications.push({
          userId: user.id,
          invoiceId: invoice.id,
          type: 'due_soon',
          title: `Invoice ${invoice.invoiceNumber} akan jatuh tempo`,
          body: `Invoice dari ${invoice.vendor.name} jatuh tempo dalam ${days} hari.`,
        })
      }
    }
  }

  if (overdueSetting?.isActive && overdueSetting.inAppEnabled) {
    const overdue = await prisma.invoice.findMany({
      where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
      include: { vendor: { select: { name: true } } },
    })
    overdueCount = overdue.length
    const recipients = await recipientsForRoles(overdueSetting.recipientRoles)
    for (const invoice of overdue) {
      for (const user of recipients) {
        if (await alreadyNotifiedToday(user.id, invoice.id, 'overdue')) continue
        notifications.push({
          userId: user.id,
          invoiceId: invoice.id,
          type: 'overdue',
          title: `Invoice ${invoice.invoiceNumber} sudah jatuh tempo`,
          body: `Invoice dari ${invoice.vendor.name} telah melewati jatuh tempo.`,
        })
      }
    }
  }

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications })
  }

  return { dueSoonCount, overdueCount, notificationsCreated: notifications.length }
}

async function recipientsForRoles(recipientRoles: unknown) {
  const roles = Array.isArray(recipientRoles) ? (recipientRoles as Role[]) : []
  if (roles.length === 0) return []
  return prisma.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } })
}

async function alreadyNotifiedToday(userId: string, invoiceId: string, type: string) {
  const existing = await prisma.notification.findFirst({
    where: { userId, invoiceId, type, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  })
  return !!existing
}
