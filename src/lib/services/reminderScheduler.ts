import { prisma } from '@/lib/db/prisma'
import type { InvoiceStatus, Role } from '@prisma/client'

const OPEN_STATUSES: InvoiceStatus[] = ['SUBMITTED', 'REVISION']
const RECIPIENT_ROLES: Role[] = ['GA_STAFF', 'GA_MANAGER']

export async function checkDueDates() {
  const now = new Date()
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // Invoices due within 3 days (not yet notified today)
  const dueSoon = await prisma.invoice.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      dueDate: { gte: now, lte: threeDaysFromNow },
    },
    include: { vendor: { select: { name: true } } },
  })

  // Overdue invoices
  const overdue = await prisma.invoice.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      dueDate: { lt: now },
    },
    include: { vendor: { select: { name: true } } },
  })

  const recipients = await prisma.user.findMany({
    where: { role: { in: RECIPIENT_ROLES }, isActive: true },
    select: { id: true },
  })

  const notifications: {
    userId: string
    invoiceId: string
    type: string
    title: string
    body: string
  }[] = []

  for (const invoice of dueSoon) {
    for (const user of recipients) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          invoiceId: invoice.id,
          type: 'due_soon',
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      })
      if (!alreadyNotified) {
        notifications.push({
          userId: user.id,
          invoiceId: invoice.id,
          type: 'due_soon',
          title: `Invoice ${invoice.invoiceNumber} akan jatuh tempo`,
          body: `Invoice dari ${invoice.vendor.name} jatuh tempo dalam 3 hari.`,
        })
      }
    }
  }

  for (const invoice of overdue) {
    for (const user of recipients) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          invoiceId: invoice.id,
          type: 'overdue',
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      })
      if (!alreadyNotified) {
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

  return { dueSoonCount: dueSoon.length, overdueCount: overdue.length, notificationsCreated: notifications.length }
}
