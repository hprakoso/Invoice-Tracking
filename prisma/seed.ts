import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { PrismaClient, Role, InvoiceStatus, PICStage } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo'

// Mirrors src/lib/db/prisma.ts — Supabase's pooler ignores sslmode URL params
// under the Prisma v7 adapter-pg driver adapter, see docs/DATABASE.md.
const url = new URL(connectionString)
url.searchParams.delete('sslmode')
url.searchParams.delete('sslaccept')
const ssl =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined

const pool = new Pool({ connectionString: url.toString(), ssl })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

// Deterministic PRNG (mulberry32) so re-runs yield identical dummy data.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// PIC workflow display order — GA is the first stage after vendor upload.
const STAGE_ORDER: PICStage[] = ['GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY']

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed script blocked in production environment.')
    process.exit(1)
  }

  console.log('Seeding database...')

  // Wipe all domain data in FK-safe order — children before parents.
  // invoiceItem/vendorContact/stageHistory also cascade from their parents,
  // but they are deleted explicitly so the wipe is complete regardless of
  // relation rules.
  await prisma.notification.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.invoiceStageHistory.deleteMany()
  await prisma.invoiceDocument.deleteMany()
  await prisma.invoiceItem.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.reminderSetting.deleteMany()
  await prisma.vendorContact.deleteMany()
  await prisma.user.deleteMany()
  await prisma.vendor.deleteMany()
  await prisma.company.deleteMany()

  // Bootstrap admin — created first so it can own the dummy data below
  // (createdBy / paidBy / stage-history changedBy).
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@vista.id'
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'dJLrXlooGsBsGcNJ'

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      name: 'Administrator',
      role: Role.ADMIN,
      passwordHash: await hashPassword(adminPassword),
      mustChangePassword: false,
    },
  })
  console.log(`Bootstrap admin ready: ${adminEmail}`)

  // Reminder settings — every notification trigger looks its row up by type
  // and silently no-ops when it's missing, so without these rows the whole
  // notification system is dead on a fresh database (it was, until
  // 2026-09-03: the wipe above removed them and nothing recreated them).
  // Defaults are conservative: in-app on, email off, since email delivery
  // needs RESEND_API_KEY and a verified domain.
  await prisma.reminderSetting.createMany({
    data: [
      { type: 'due_soon', daysBefore: 3, recipientRoles: ['GA_STAFF', 'GA_MANAGER'], extraEmails: [], emailEnabled: false },
      { type: 'overdue', daysBefore: null, recipientRoles: ['GA_STAFF', 'GA_MANAGER'], extraEmails: [], emailEnabled: false },
      // Targets the invoice's own vendor; recipientRoles is ignored for this type.
      { type: 'status_changed', daysBefore: null, recipientRoles: [], extraEmails: [], emailEnabled: false },
      { type: 'stage_assigned', daysBefore: null, recipientRoles: ['GA_STAFF', 'GA_MANAGER'], extraEmails: [], emailEnabled: false },
      // Configurable but never fired — see the note on REMINDER_TYPES in
      // src/lib/validations.ts. Seeded inactive so the admin page doesn't
      // present them as working triggers.
      { type: 'invoice_submitted', daysBefore: null, recipientRoles: ['GA_STAFF'], extraEmails: [], emailEnabled: false, isActive: false },
      { type: 'revision_requested', daysBefore: null, recipientRoles: [], extraEmails: [], emailEnabled: false, isActive: false },
    ],
  })

  // --- Dummy data for dashboard charts (invoices + their required parents) ---
  const rand = mulberry32(20260818)

  // Companies (bill-to entities)
  const companySpecs = [
    { name: 'PT Nusantara Gemilang Sejahtera', npwp: '31.234.567.8-901.000', address: 'Jl. Jend. Sudirman Kav. 52-53', city: 'Jakarta', email: 'ap@nusantaragemilang.co.id' },
    { name: 'PT Delta Prima Energi', npwp: '32.345.678.9-012.000', address: 'Jl. Basuki Rahmat No. 88', city: 'Surabaya', email: 'finance@deltaprimaenergi.co.id' },
    { name: 'PT Artha Karya Persada', npwp: '33.456.789.0-123.000', address: 'Jl. Asia Afrika No. 121', city: 'Bandung', email: 'payables@arthakarya.co.id' },
  ]
  const companies: { id: string }[] = []
  for (const c of companySpecs) {
    companies.push(await prisma.company.create({ data: c }))
  }

  // Vendors (invoice senders) — each with one primary contact
  const vendorSpecs = [
    { name: 'PT Maju Jaya Abadi', npwp: '01.234.567.8-901.000', contactName: 'Hendra Kusuma', contactEmail: 'hendra@majujaya.co.id', bankName: 'Bank BCA', bankAccount: '1234567890', bankAccountHolder: 'PT Maju Jaya Abadi', bankBranch: 'Jakarta Pusat', city: 'Jakarta' },
    { name: 'CV Teknologi Nusantara', npwp: '02.345.678.9-012.000', contactName: 'Rina Susanti', contactEmail: 'rina@teknologi-nusantara.id', bankName: 'Bank Mandiri', bankAccount: '9876543210', bankAccountHolder: 'CV Teknologi Nusantara', bankBranch: 'Jakarta Selatan', city: 'Jakarta' },
    { name: 'PT Solusi Digital Indonesia', npwp: '03.456.789.0-123.000', contactName: 'Doni Prasetyo', contactEmail: 'doni@solusidigital.id', bankName: 'Bank BNI', bankAccount: '1122334455', bankAccountHolder: 'PT Solusi Digital Indonesia', bankBranch: 'Bandung', city: 'Bandung' },
    { name: 'UD Karya Gemilang', npwp: '04.567.890.1-234.000', contactName: 'Yanti Permata', contactEmail: 'yanti@karyagemilang.com', bankName: 'Bank BRI', bankAccount: '5566778899', bankAccountHolder: 'UD Karya Gemilang', bankBranch: 'Surabaya', city: 'Surabaya' },
    { name: 'PT Inovasi Teknologi Bangsa', npwp: '05.678.901.2-345.000', contactName: 'Fajar Nugroho', contactEmail: 'fajar@inovasiteknologi.id', bankName: 'Bank CIMB Niaga', bankAccount: '6677889900', bankAccountHolder: 'PT Inovasi Teknologi Bangsa', bankBranch: 'Semarang', city: 'Semarang' },
    { name: 'CV Mandiri Sejahtera', npwp: '06.789.012.3-456.000', contactName: 'Wulan Sari', contactEmail: 'wulan@mandrisejahtera.co.id', bankName: 'Bank Permata', bankAccount: '0011223344', bankAccountHolder: 'CV Mandiri Sejahtera', bankBranch: 'Medan', city: 'Medan' },
  ]
  const vendors: { id: string }[] = []
  for (const v of vendorSpecs) {
    vendors.push(
      await prisma.vendor.create({
        data: {
          name: v.name,
          npwp: v.npwp,
          contactName: v.contactName,
          contactEmail: v.contactEmail,
          bankName: v.bankName,
          bankAccount: v.bankAccount,
          bankAccountHolder: v.bankAccountHolder,
          bankBranch: v.bankBranch,
          city: v.city,
          contacts: {
            create: { name: v.contactName, email: v.contactEmail, role: 'Finance', phone: `08${String(100000000 + Math.floor(rand() * 899999999))}` },
          },
        },
      }),
    )
  }

  const now = new Date()
  const curYear = now.getUTCFullYear()
  const curMonth = now.getUTCMonth() // 0-11
  const ADD = 24 * 60 * 60 * 1000
  const monthsAgo = (monthsBack: number, day: number, h = 9, m = 0, s = 0) =>
    new Date(Date.UTC(curYear, curMonth - monthsBack, day, h, m, s))

  // Weighted status mix across the 17-value workflow — roughly mirrors the
  // old 4-bucket mix (early verification / internal verification / sent for
  // payment / settled), split finer, plus a light sprinkling of exception
  // states so the dashboard/status-badge UI has something of each family to
  // render against.
  const statusCounts: [InvoiceStatus, number][] = [
    [InvoiceStatus.RECEIVED, 10],
    [InvoiceStatus.REGISTERED, 15],
    [InvoiceStatus.DOC_VERIFICATION, 15],
    [InvoiceStatus.FINANCE_VERIFICATION, 12],
    [InvoiceStatus.READY_FOR_PAYMENT, 8],
    [InvoiceStatus.TREASURY_PROCESS, 8],
    [InvoiceStatus.PAYMENT_SCHEDULED, 7],
    [InvoiceStatus.PAID, 15],
    [InvoiceStatus.CLOSED, 4],
    [InvoiceStatus.DOC_INCOMPLETE, 2],
    [InvoiceStatus.WAITING_APPROVAL, 2],
    [InvoiceStatus.REJECTED, 1],
    [InvoiceStatus.PAYMENT_HOLD, 1],
  ]
  const statuses: InvoiceStatus[] = []
  for (const [status, n] of statusCounts) for (let i = 0; i < n; i++) statuses.push(status)
  // Deterministic Fisher–Yates shuffle so the mix is interleaved per run.
  for (let i = statuses.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[statuses[i], statuses[j]] = [statuses[j], statuses[i]]
  }

  // PIC stage per status — GA/BUDGET early, PROC_LEGAL/SSU mid, TREASURY once
  // settled. Every stage appears; PAID/CLOSED/REJECTED all end at TREASURY
  // (settled, whether paid or not — the invoice still passed through there).
  function picStageFor(status: InvoiceStatus, k: number): PICStage {
    switch (status) {
      case InvoiceStatus.RECEIVED:
      case InvoiceStatus.REGISTERED:
      case InvoiceStatus.DOC_VERIFICATION:
      case InvoiceStatus.DOC_INCOMPLETE:
        return k % 4 === 0 ? PICStage.BUDGET : PICStage.GA
      case InvoiceStatus.FINANCE_VERIFICATION:
      case InvoiceStatus.READY_FOR_PAYMENT:
      case InvoiceStatus.WAITING_APPROVAL:
        return k % 3 === 0 ? PICStage.PROC_LEGAL : PICStage.BUDGET
      case InvoiceStatus.TREASURY_PROCESS:
      case InvoiceStatus.PAYMENT_SCHEDULED:
      case InvoiceStatus.PAYMENT_HOLD:
        return k % 3 === 0 ? PICStage.SSU : PICStage.PROC_LEGAL
      case InvoiceStatus.PAID:
      case InvoiceStatus.CLOSED:
      case InvoiceStatus.REJECTED:
        return PICStage.TREASURY
      default:
        return PICStage.GA
    }
  }

  type InvoiceSpec = {
    status: InvoiceStatus
    picStage: PICStage
    createdAt: Date
    dueDate: Date
    totalAmount: number
    subtotal: number
    taxAmount: number
    companyId: string | null
    picId: string | null
    ocrConfidence: number | null
    sendDate: Date | null
    deliveredDate: Date | null
    invoiceDate: Date
  }

  const specs: InvoiceSpec[] = []
  const statusIdx: Record<string, number> = {}
  for (let i = 0; i < statuses.length; i++) {
    // Recent-weighted month bucket: pow(rand, 1.5) skews toward the current
    // month; the first 12 invoices guarantee one row per trailing month so
    // all 12 chart buckets are populated.
    const bucket = i < 12 ? i : 11 - Math.floor(Math.pow(rand(), 1.5) * 12)
    const createdAt = monthsAgo(
      11 - bucket,
      1 + Math.floor(rand() * 28),
      8 + Math.floor(rand() * 10),
      Math.floor(rand() * 60),
      Math.floor(rand() * 60),
    )
    const status = statuses[i]
    const k = (statusIdx[status] = (statusIdx[status] ?? 0) + 1)

    // dueDate rules are deterministic per status ordinal — no rand — so the
    // dashboard's overdue-aging bucket always gets open-status rows.
    const settled = status === InvoiceStatus.PAID || status === InvoiceStatus.CLOSED || status === InvoiceStatus.REJECTED
    let dueDate: Date
    if (settled) {
      dueDate = new Date(createdAt.getTime() + (30 + (k % 3) * 15) * ADD) // settled, due in the past
    } else if (k % 3 === 0) {
      dueDate = new Date(now.getTime() - (1 + ((k * 7) % 45)) * ADD) // overdue
    } else if (k % 3 === 1) {
      dueDate = new Date(now.getTime() + (2 + ((k * 5) % 12)) * ADD) // due soon
    } else {
      dueDate = new Date(now.getTime() + (20 + ((k * 11) % 70)) * ADD) // far future
    }

    const totalAmount = Math.round((5_000_000 + Math.pow(rand(), 1.8) * 495_000_000) / 50_000) * 50_000
    const taxAmount = Math.round(totalAmount * 0.11)
    const subtotal = totalAmount - taxAmount
    const picStage = picStageFor(status, k)
    const closed = settled

    specs.push({
      status,
      picStage,
      createdAt,
      dueDate,
      totalAmount,
      subtotal,
      taxAmount,
      companyId: rand() < 0.8 ? companies[Math.floor(rand() * companies.length)].id : null,
      picId: !closed && rand() < 0.6 ? admin.id : null,
      ocrConfidence: closed ? 60 + Math.floor(rand() * 40) : 60 + Math.floor(rand() * 40),
      sendDate: new Date(createdAt.getTime() - ADD),
      deliveredDate: !closed && rand() < 0.7 ? createdAt : null,
      invoiceDate: createdAt,
    })
  }

  // Sequential per-year invoice and PO numbers (INV-2025-0001 / PO-2025-0001),
  // assigned in createdAt order.
  specs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const seqByYear: Record<number, number> = {}
  const itemDescriptions = [
    'Jasa Konsultasi IT',
    'Lisensi Software',
    'Jasa Perawatan Sistem',
    'Jasa Pengadaan Barang',
    'Jasa Konstruksi',
    'Sewa Peralatan Kantor',
  ]

  const invoiceCreates = specs.map((s) => {
    const year = s.createdAt.getUTCFullYear()
    const seq = (seqByYear[year] = (seqByYear[year] ?? 0) + 1)
    const invoiceNumber = `INV-${year}-${String(seq).padStart(4, '0')}`
    const poNumber = `PO-${year}-${String(seq).padStart(4, '0')}`
    const accepted = s.status === InvoiceStatus.PAID || s.status === InvoiceStatus.CLOSED
    // Stage history: GA at ~createdAt, each later stage +1–4 days on — the
    // recorded timestamps are the SLA source.
    const finalStageIdx = STAGE_ORDER.indexOf(s.picStage)
    const stageHistory = STAGE_ORDER.slice(0, finalStageIdx + 1).map((stage, i) => ({
      stage,
      changedAt: i === 0 ? s.createdAt : new Date(s.createdAt.getTime() + (1 + ((seq + i * 3) % 4)) * i * ADD),
      changedById: admin.id,
    }))
    return prisma.invoice.create({
      data: {
        vendorId: vendors[Math.floor(rand() * vendors.length)].id,
        companyId: s.companyId,
        invoiceNumber,
        poNumber,
        invoiceDate: s.invoiceDate,
        dueDate: s.dueDate,
        currency: 'IDR',
        subtotal: s.subtotal,
        taxAmount: s.taxAmount,
        totalAmount: s.totalAmount,
        status: s.status,
        picStage: s.picStage,
        sendDate: s.sendDate,
        deliveredDate: s.deliveredDate,
        picId: s.picId,
        ocrConfidence: s.ocrConfidence,
        createdById: admin.id,
        createdAt: s.createdAt, // explicit — not the DB default(now())
        paidDate: accepted ? new Date(s.dueDate.getTime() - 3 * ADD) : null,
        paidAmount: accepted ? s.totalAmount : null,
        paidById: accepted ? admin.id : null,
        stageHistory: { create: stageHistory },
        items: {
          create: [
            {
              description: itemDescriptions[Math.floor(rand() * itemDescriptions.length)],
              quantity: 1,
              unitPrice: Math.round(s.subtotal * 0.6),
              total: Math.round(s.subtotal * 0.6),
              sortOrder: 1,
            },
            {
              description: itemDescriptions[Math.floor(rand() * itemDescriptions.length)],
              quantity: 1,
              unitPrice: Math.round(s.subtotal * 0.4),
              total: Math.round(s.subtotal * 0.4),
              sortOrder: 2,
            },
          ],
        },
      },
    })
  })

  // Promise.all (not one $transaction): 100 creates with nested items exceeds
  // the 5s pooler transaction timeout — see P2028. Seed re-runs wipe first, so
  // no atomicity is needed.
  await Promise.all(invoiceCreates)

  console.log('Dummy data created: 3 companies, 6 vendors, 100 invoices (2 items each), stage history')
  console.log(`
Bootstrap Admin:
  ${adminEmail}  (role: ADMIN — password from ADMIN_PASSWORD env or its default)
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
