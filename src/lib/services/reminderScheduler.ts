import { prisma } from '@/lib/db/prisma'
import type { InvoiceStatus, Role } from '@prisma/client'
import { sendEmail } from '@/lib/services/email'

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

  if (dueSoonSetting?.isActive && (dueSoonSetting.inAppEnabled || dueSoonSetting.emailEnabled)) {
    const days = dueSoonSetting.daysBefore ?? 3
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    const dueSoon = await prisma.invoice.findMany({
      where: { status: { in: OPEN_STATUSES }, dueDate: { gte: now, lte: threshold } },
      include: { vendor: { select: { name: true } } },
    })
    dueSoonCount = dueSoon.length
    const recipients = await recipientsForRoles(dueSoonSetting.recipientRoles)

    if (dueSoonSetting.emailEnabled && dueSoon.length > 0) {
      const to = [...recipients.map((u) => u.email), ...extraEmailsOf(dueSoonSetting.extraEmails)]
      await sendEmail(
        to,
        `${dueSoon.length} invoice akan jatuh tempo dalam ${days} hari`,
        renderInvoiceListEmail(`Invoice berikut akan jatuh tempo dalam ${days} hari:`, dueSoon),
      )
    }

    if (dueSoonSetting.inAppEnabled) {
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
  }

  if (overdueSetting?.isActive && (overdueSetting.inAppEnabled || overdueSetting.emailEnabled)) {
    const overdue = await prisma.invoice.findMany({
      where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
      include: { vendor: { select: { name: true } } },
    })
    overdueCount = overdue.length
    const recipients = await recipientsForRoles(overdueSetting.recipientRoles)

    if (overdueSetting.emailEnabled && overdue.length > 0) {
      const to = [...recipients.map((u) => u.email), ...extraEmailsOf(overdueSetting.extraEmails)]
      await sendEmail(
        to,
        `${overdue.length} invoice sudah jatuh tempo`,
        renderInvoiceListEmail('Invoice berikut sudah melewati jatuh tempo:', overdue),
      )
    }

    if (overdueSetting.inAppEnabled) {
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
  }

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications })
  }

  return { dueSoonCount, overdueCount, notificationsCreated: notifications.length }
}

async function recipientsForRoles(recipientRoles: unknown) {
  const roles = Array.isArray(recipientRoles) ? (recipientRoles as Role[]) : []
  if (roles.length === 0) return []
  return prisma.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true, email: true } })
}

export function extraEmailsOf(extraEmails: unknown): string[] {
  return Array.isArray(extraEmails) ? extraEmails.filter((e): e is string => typeof e === 'string') : []
}

export function renderInvoiceListEmail(
  intro: string,
  invoices: { invoiceNumber: string; dueDate: Date | null; totalAmount: unknown; vendor: { name: string } }[],
): string {
  const rows = invoices
    .map(
      (inv) =>
        `<li>${inv.invoiceNumber} — ${inv.vendor.name} — jatuh tempo ${inv.dueDate?.toISOString().slice(0, 10) ?? '-'}</li>`,
    )
    .join('')
  return `<p>${intro}</p><ul>${rows}</ul>`
}

async function alreadyNotifiedToday(userId: string, invoiceId: string, type: string) {
  const existing = await prisma.notification.findFirst({
    where: { userId, invoiceId, type, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  })
  return !!existing
}
