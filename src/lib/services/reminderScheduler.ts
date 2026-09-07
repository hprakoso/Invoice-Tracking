import { prisma } from '@/lib/db/prisma'
import type { InvoiceStatus, Role } from '@prisma/client'
import { sendEmail, renderEmailLayout } from '@/lib/services/email'
import { OPEN_STATUSES as OPEN_STATUS_NAMES } from '@/lib/invoiceStatus'
import { jakartaDayStart } from '@/lib/format'

// Invoices still "in play" — everything except the settled/dead statuses.
const OPEN_STATUSES = OPEN_STATUS_NAMES as readonly string[] as InvoiceStatus[]

export async function checkDueDates() {
  const [dueSoonSetting, overdueSetting] = await Promise.all([
    prisma.reminderSetting.findUnique({ where: { type: 'due_soon' } }),
    prisma.reminderSetting.findUnique({ where: { type: 'overdue' } }),
  ])

  const now = new Date()
  // Due dates are calendar dates at UTC midnight, so every comparison is made
  // against the start of today in Jakarta. Comparing against `now` excluded an
  // invoice due today from the due-soon window (its midnight is already in the
  // past) and matched it as overdue instead — the "sudah melewati jatuh tempo"
  // email went out on the invoice's own due date.
  const todayStart = jakartaDayStart(now)
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
    const threshold = new Date(todayStart.getTime() + days * 24 * 60 * 60 * 1000)
    const dueSoon = await prisma.invoice.findMany({
      // isDraft excluded: an abandoned wizard row is not something anyone
      // should be chased about.
      where: { isDraft: false, status: { in: OPEN_STATUSES }, dueDate: { gte: todayStart, lte: threshold } },
      include: { vendor: { select: { name: true } } },
    })
    dueSoonCount = dueSoon.length
    const recipients = await recipientsForRoles(dueSoonSetting.recipientRoles)

    if (dueSoonSetting.emailEnabled) {
      await sendDigest(
        recipients,
        extraEmailsOf(dueSoonSetting.extraEmails),
        dueSoon,
        (n) => `${n} invoice akan jatuh tempo dalam ${days} hari`,
        (n) => `${n} invoice akan jatuh tempo dalam ${days} hari`,
      )
    }

    if (dueSoonSetting.inAppEnabled) {
      const notified = await notifiedTodayKeys('due_soon', todayStart)
      for (const user of recipients) {
        for (const invoice of scopedFor(user, dueSoon)) {
          if (notified.has(`${user.id}:${invoice.id}`)) continue
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
      where: { isDraft: false, status: { in: OPEN_STATUSES }, dueDate: { lt: todayStart } },
      include: { vendor: { select: { name: true } } },
    })
    overdueCount = overdue.length
    const recipients = await recipientsForRoles(overdueSetting.recipientRoles)

    if (overdueSetting.emailEnabled) {
      await sendDigest(
        recipients,
        extraEmailsOf(overdueSetting.extraEmails),
        overdue,
        (n) => `${n} invoice sudah jatuh tempo`,
        (n) => `${n} invoice sudah melewati jatuh tempo`,
      )
    }

    if (overdueSetting.inAppEnabled) {
      const notified = await notifiedTodayKeys('overdue', todayStart)
      for (const user of recipients) {
        for (const invoice of scopedFor(user, overdue)) {
          if (notified.has(`${user.id}:${invoice.id}`)) continue
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
  // role/vendorId are selected because VENDOR recipients must be scoped to
  // their own invoices — see scopedFor() and sendDigest().
  return prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true, email: true, role: true, vendorId: true },
  })
}

type Recipient = { id: string; email: string; role: Role; vendorId: string | null }

type InvoiceForDigest = {
  vendorId: string
  invoiceNumber: string
  dueDate: Date | null
  totalAmount: unknown
  vendor: { name: string }
}

/**
 * The invoices a given recipient is allowed to hear about. VENDOR is a
 * selectable recipient role, but the due-soon/overdue queries span every
 * vendor — so an unscoped fan-out told each vendor the invoice numbers and
 * vendor names of all the others.
 */
function scopedFor<T extends { vendorId: string }>(recipient: Recipient, invoices: T[]): T[] {
  if (recipient.role !== 'VENDOR') return invoices
  if (!recipient.vendorId) return []
  return invoices.filter((i) => i.vendorId === recipient.vendorId)
}

/**
 * One digest to the internal recipients (plus any configured extra addresses),
 * and a separate per-vendor digest to each VENDOR recipient containing only
 * that vendor's rows.
 */
async function sendDigest(
  recipients: Recipient[],
  extraEmails: string[],
  invoices: InvoiceForDigest[],
  subject: (count: number) => string,
  heading: (count: number) => string,
) {
  if (invoices.length === 0) return

  const internalTo = [
    ...recipients.filter((r) => r.role !== 'VENDOR').map((r) => r.email),
    ...extraEmails,
  ]
  if (internalTo.length > 0) {
    await sendEmail(internalTo, subject(invoices.length), renderInvoiceListEmail(heading(invoices.length), invoices))
  }

  for (const recipient of recipients.filter((r) => r.role === 'VENDOR')) {
    const own = scopedFor(recipient, invoices)
    if (own.length === 0) continue
    await sendEmail([recipient.email], subject(own.length), renderInvoiceListEmail(heading(own.length), own))
  }
}

export function extraEmailsOf(extraEmails: unknown): string[] {
  return Array.isArray(extraEmails) ? extraEmails.filter((e): e is string => typeof e === 'string') : []
}

export function renderInvoiceListEmail(
  heading: string,
  invoices: { invoiceNumber: string; dueDate: Date | null; totalAmount: unknown; vendor: { name: string } }[],
): string {
  const rows = invoices
    .map(
      (inv) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#18181b;">${inv.invoiceNumber}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#3f3f46;">${inv.vendor.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#3f3f46;">${inv.dueDate?.toISOString().slice(0, 10) ?? '-'}</td>
      </tr>`,
    )
    .join('')
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;border-collapse:collapse;">
    <tr style="background:#fafafa;">
      <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#71717a;">No. Invoice</th>
      <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#71717a;">Vendor</th>
      <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;color:#71717a;">Jatuh Tempo</th>
    </tr>
    ${rows}
  </table>`
  return renderEmailLayout({
    heading,
    bodyHtml: table,
    ctaText: 'Lihat Semua Invoice',
    ctaPath: '/invoices', // due-soon/overdue spans multiple open statuses, not one
  })
}

/**
 * `${userId}:${invoiceId}` pairs already notified for this reminder type today,
 * fetched once per run.
 *
 * Two fixes over the old per-pair `findFirst`: it was issued once per
 * invoice-per-recipient and sequentially awaited inside nested loops (500
 * overdue invoices × 5 recipients = 2,500 round-trips per run), and it compared
 * against a rolling 24h window rather than a calendar day — so a cron firing
 * even a minute earlier than the previous day's run found yesterday's row still
 * inside the window and silently skipped the whole day's reminders.
 */
async function notifiedTodayKeys(type: string, todayStart: Date): Promise<Set<string>> {
  const rows = await prisma.notification.findMany({
    where: { type, createdAt: { gte: todayStart } },
    select: { userId: true, invoiceId: true },
  })
  return new Set(rows.map((r) => `${r.userId}:${r.invoiceId}`))
}
