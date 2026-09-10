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
  // This script DELETES every domain table before it writes, so the guard has
  // to be reliable. The old check was `NODE_ENV === 'production'`, which never
  // fired: the script is run as `npx tsx prisma/seed.ts` (package.json db:seed)
  // and nothing in that path sets NODE_ENV, so it was always undefined and the
  // guard was dead code — a `npm run db:seed` with a production DATABASE_URL
  // would have wiped production.
  //
  // The host of the connection string is the honest signal. Set
  // SEED_ALLOW_REMOTE=yes-i-know to seed a non-local database deliberately
  // (a fresh UAT environment being the legitimate case).
  const targetHost = new URL(connectionString).hostname
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(targetHost)
  if (!isLocal && process.env.SEED_ALLOW_REMOTE !== 'yes-i-know') {
    console.error(
      `Refusing to seed a non-local database.\n` +
        `  target host : ${targetHost}\n` +
        `  this script : DELETES every invoice, user, vendor and company first\n` +
        `If that is genuinely what you want (a fresh UAT database), re-run with:\n` +
        `  SEED_ALLOW_REMOTE=yes-i-know npm run db:seed`,
    )
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

  // UAT logins for the three non-admin roles. Without these the seed produced
  // exactly one account (ADMIN), so a tester had no way to reach the vendor
  // portal, the GA queue, or any role-gated screen at all — the two throwaway
  // root scripts that used to create them are gitignored and meant to be
  // deleted. The vendor account is linked to the first seeded vendor, which is
  // what makes cross-tenant scoping testable.
  //
  // Safe to keep in the tracked seed because this whole script is destructive
  // by construction (it deleteMany()s every table at the top) and must never be
  // pointed at production — see docs/UAT_AND_CUTOVER.md.
  const demoPassword = process.env.DEMO_PASSWORD ?? 'demo1234'

  // The four accounts a demo or UAT session actually runs on, all sharing
  // DEMO_PASSWORD so one credential covers the whole walkthrough. The
  // bootstrap admin above is deliberately NOT one of them — it carries
  // ADMIN_PASSWORD, a different and much longer secret, which is why the login
  // page's dev buttons used to offer an account whose password nobody running
  // the demo had.
  //
  // Vendor A and Vendor B sit on DIFFERENT vendors on purpose: that pair is the
  // only way to exercise cross-tenant isolation (open A's invoice id while
  // signed in as B and confirm the 403).
  type DemoAccount = {
    email: string
    name: string
    role: Role
    vendorId: string | null
    isActive?: boolean
    mustChangePassword?: boolean
  }

  const DEMO_ACCOUNTS: DemoAccount[] = [
    { email: 'admin@sip.id', name: 'Admin (Demo)', role: Role.ADMIN, vendorId: null },
    { email: 'gastaff@sip.id', name: 'GA Staff (Demo)', role: Role.GA_STAFF, vendorId: null },
    { email: 'vendor@sip.id', name: `Vendor A (${vendorSpecs[0].name})`, role: Role.VENDOR, vendorId: vendors[0].id },
    { email: 'vendor2@sip.id', name: `Vendor B (${vendorSpecs[1].name})`, role: Role.VENDOR, vendorId: vendors[1].id },
  ]

  // Extra accounts that exist to give a UAT scenario a starting row, not to be
  // logged into casually.
  const EXTRA_UAT_ACCOUNTS: DemoAccount[] = [
    { email: 'gamanager@sip.id', name: 'GA Manager (Demo)', role: Role.GA_MANAGER, vendorId: null },
    { email: 'nonaktif@sip.id', name: 'User Nonaktif (Demo)', role: Role.GA_STAFF, vendorId: null, isActive: false },
    { email: 'gantipassword@sip.id', name: 'Wajib Ganti Password (Demo)', role: Role.GA_STAFF, vendorId: null, mustChangePassword: true },
  ]

  const demoUsers = [...DEMO_ACCOUNTS, ...EXTRA_UAT_ACCOUNTS]
  const createdDemoUsers: Record<string, { id: string }> = {}
  for (const u of demoUsers) {
    createdDemoUsers[u.email] = await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        role: u.role,
        vendorId: u.vendorId,
        passwordHash: await hashPassword(demoPassword),
        // Demo/UAT accounts default to false — i.e. "already past first login"
        // — so one shared credential covers the whole walkthrough without every
        // sign-in being interrupted by a forced change. For a VENDOR that also
        // means the seeded account sits in its normal steady state: unable to
        // rotate its own password, which is the real rule (see
        // canChangeOwnPassword). gantipassword@sip.id is the account that
        // demonstrates the forced-change screen. Real vendor accounts are
        // created through POST /api/users, where the schema default (true)
        // applies, and migration 20260910000000 re-arms pre-existing ones.
        mustChangePassword: u.mustChangePassword ?? false,
        isActive: u.isActive ?? true,
      },
    })
  }
  const gaStaff = createdDemoUsers['gastaff@sip.id']
  const gaManager = createdDemoUsers['gamanager@sip.id']
  console.log(`Demo accounts: ${DEMO_ACCOUNTS.map((u) => u.email).join(', ')}`)
  console.log(`Extra UAT accounts: ${EXTRA_UAT_ACCOUNTS.map((u) => u.email).join(', ')}`)

  // One inactive vendor and one inactive company, so the isActive toggles, the
  // active-only vendor dropdown and the dashboard's includeInactive=true
  // company fetch all have a real row to act on.
  await prisma.vendor.update({ where: { id: vendors[vendors.length - 1].id }, data: { isActive: false } })
  await prisma.company.update({ where: { id: companies[companies.length - 1].id }, data: { isActive: false } })

  const now = new Date()
  const curYear = now.getUTCFullYear()
  const curMonth = now.getUTCMonth() // 0-11
  const ADD = 24 * 60 * 60 * 1000
  const monthsAgo = (monthsBack: number, day: number, h = 9, m = 0, s = 0) =>
    new Date(Date.UTC(curYear, curMonth - monthsBack, day, h, m, s))

  // Date-valued columns (invoice/due/send/delivered/paid) hold calendar dates,
  // not instants — the app writes them from 'YYYY-MM-DD' strings, i.e. UTC
  // midnight. The generator used to derive them from `now`, so seeded rows
  // carried the seed run's time-of-day and fell outside date-range filters on
  // their own boundary day. Everything date-valued goes through this.
  const dayOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

  // Weighted status mix across the 17-value workflow — roughly mirrors the
  // old 4-bucket mix (early verification / internal verification / sent for
  // payment / settled), split finer, plus a light sprinkling of exception
  // states so the dashboard/status-badge UI has something of each family to
  // render against.
  // All 17 statuses appear. The previous mix covered only 13, so four badges,
  // their transition edges and their exception chips could never be reached in
  // UAT: RETURNED_TO_VENDOR, WAITING_USER_CONFIRMATION, WAITING_TAX_DOCUMENT
  // and VENDOR_BANK_ISSUE.
  const statusCounts: [InvoiceStatus, number][] = [
    [InvoiceStatus.RECEIVED, 9],
    [InvoiceStatus.REGISTERED, 13],
    [InvoiceStatus.DOC_VERIFICATION, 13],
    [InvoiceStatus.FINANCE_VERIFICATION, 11],
    [InvoiceStatus.READY_FOR_PAYMENT, 7],
    [InvoiceStatus.TREASURY_PROCESS, 7],
    [InvoiceStatus.PAYMENT_SCHEDULED, 6],
    [InvoiceStatus.PAID, 14],
    [InvoiceStatus.CLOSED, 4],
    [InvoiceStatus.DOC_INCOMPLETE, 2],
    [InvoiceStatus.RETURNED_TO_VENDOR, 2],
    [InvoiceStatus.WAITING_USER_CONFIRMATION, 2],
    [InvoiceStatus.WAITING_APPROVAL, 2],
    [InvoiceStatus.WAITING_TAX_DOCUMENT, 2],
    [InvoiceStatus.REJECTED, 2],
    [InvoiceStatus.PAYMENT_HOLD, 2],
    [InvoiceStatus.VENDOR_BANK_ISSUE, 2],
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
      // Both are document-stage off-ramps: the ball is back with the vendor.
      case InvoiceStatus.RETURNED_TO_VENDOR:
      case InvoiceStatus.WAITING_TAX_DOCUMENT:
        return k % 4 === 0 ? PICStage.BUDGET : PICStage.GA
      case InvoiceStatus.FINANCE_VERIFICATION:
      case InvoiceStatus.READY_FOR_PAYMENT:
      case InvoiceStatus.WAITING_APPROVAL:
      case InvoiceStatus.WAITING_USER_CONFIRMATION:
        return k % 3 === 0 ? PICStage.PROC_LEGAL : PICStage.BUDGET
      case InvoiceStatus.TREASURY_PROCESS:
      case InvoiceStatus.PAYMENT_SCHEDULED:
      case InvoiceStatus.PAYMENT_HOLD:
      case InvoiceStatus.VENDOR_BANK_ISSUE:
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
    const generated = monthsAgo(
      11 - bucket,
      1 + Math.floor(rand() * 28),
      8 + Math.floor(rand() * 10),
      Math.floor(rand() * 60),
      Math.floor(rand() * 60),
    )
    // Never in the future. The current-month bucket picks a day between 1 and
    // 28 regardless of today's date, so seeding on the 7th produced invoices
    // "created" on the 8th and the 20th — and, once settled, invoices marked
    // PAID on a date that has not happened yet.
    const createdAt = new Date(Math.min(generated.getTime(), now.getTime()))
    const status = statuses[i]
    const k = (statusIdx[status] = (statusIdx[status] ?? 0) + 1)

    // dueDate rules are deterministic per status ordinal — no rand — so the
    // dashboard's overdue-aging bucket always gets open-status rows.
    //
    // The overdue/due-soon targets are measured from `now` while the invoice
    // date is `createdAt`, so a recently-created invoice could land a due date
    // *before* its own invoice date. That produced 9 impossible rows in the
    // demo database — invoices the dashboard counted as overdue while their
    // detail view showed a due date preceding the invoice date. The clamp below
    // is what keeps the generated data satisfying the new
    // `invoices_due_date_after_invoice_date` CHECK constraint.
    const settled = status === InvoiceStatus.PAID || status === InvoiceStatus.CLOSED || status === InvoiceStatus.REJECTED
    let dueTarget: number
    if (settled) {
      // Capped at today. The term was measured purely from createdAt, so a
      // recently-created settled invoice got a due date — and therefore a
      // paidDate — weeks in the FUTURE. Six rows read as "paid on a date that
      // hasn't happened yet", which a UAT tester rightly files as a bug.
      dueTarget = Math.min(createdAt.getTime() + (30 + (k % 3) * 15) * ADD, now.getTime())
    } else if (k % 3 === 0) {
      dueTarget = now.getTime() - (1 + ((k * 7) % 45)) * ADD // overdue
    } else if (k % 3 === 1) {
      dueTarget = now.getTime() + (2 + ((k * 5) % 12)) * ADD // due soon
    } else {
      dueTarget = now.getTime() + (20 + ((k * 11) % 70)) * ADD // far future
    }
    const dueDate = dayOnly(new Date(Math.max(dueTarget, createdAt.getTime() + ADD)))

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
      // A real GA_STAFF, not the admin: the PIC dropdown is populated from
      // /api/users?role=GA_STAFF, so admin-owned picIds meant filtering by any
      // selectable PIC always returned zero rows.
      picId: !closed && rand() < 0.6 ? gaStaff.id : null,
      ocrConfidence: closed ? 60 + Math.floor(rand() * 40) : 60 + Math.floor(rand() * 40),
      sendDate: dayOnly(new Date(createdAt.getTime() - ADD)),
      deliveredDate: !closed && rand() < 0.7 ? dayOnly(createdAt) : null,
      invoiceDate: dayOnly(createdAt),
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
        // Spread across the internal accounts. Every invoice used to be
        // created by the admin, and GA write permissions hinge on
        // createdById === caller (isEditor), so the wider GA field set could
        // never be reached by a GA tester.
        createdById: [admin.id, gaStaff.id, gaManager.id][seq % 3],
        createdAt: s.createdAt, // explicit — not the DB default(now())
        // Never in the future, never before the invoice was issued.
        paidDate: accepted
          ? dayOnly(new Date(Math.max(
              s.invoiceDate.getTime(),
              Math.min(s.dueDate.getTime() - 3 * ADD, now.getTime()),
            )))
          : null,
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

  // --- UAT boundary cases ---------------------------------------------------
  // The random mix above never lands on the edges that the 2026-09-07 review
  // was actually about, so they are created explicitly and named UAT-* to be
  // obvious in the list. All belong to vendors[0], the vendor@sip.id login, so
  // a tester signed in as that vendor sees them (and vendor2@sip.id must not).
  const jkt = (d: Date) => dayOnly(new Date(d.getTime() + 7 * 3600_000))
  const todayJkt = jkt(now)
  const uatIssued = new Date(todayJkt.getTime() - 10 * ADD)
  const uatCases: {
    n: string; label: string; due: Date | null; status: InvoiceStatus; isDraft?: boolean
  }[] = [
    // Due today must read as NOT overdue — the exact case that started the review.
    { n: 'UAT-DUE-TODAY', label: 'Jatuh tempo hari ini', due: todayJkt, status: InvoiceStatus.REGISTERED },
    // One day either side of the boundary, so the flip is visible in the list.
    { n: 'UAT-DUE-TOMORROW', label: 'Jatuh tempo besok', due: new Date(todayJkt.getTime() + ADD), status: InvoiceStatus.REGISTERED },
    { n: 'UAT-OVERDUE-1D', label: 'Terlambat 1 hari', due: new Date(todayJkt.getTime() - ADD), status: InvoiceStatus.DOC_VERIFICATION },
    // Belongs in the "Tanpa jatuh tempo" aging bucket and no reminder at all.
    { n: 'UAT-NO-DUEDATE', label: 'Tanpa jatuh tempo', due: null, status: InvoiceStatus.RECEIVED },
    // Must be invisible in every KPI, list, export and reminder.
    { n: 'UAT-DRAFT', label: 'Draft wizard terlantar', due: new Date(todayJkt.getTime() - 30 * ADD), status: InvoiceStatus.RECEIVED, isDraft: true },
  ]

  await Promise.all(
    uatCases.map((c, i) => {
      // An invoice is never issued after it falls due — the UAT-DRAFT case
      // (due 30 days ago) would otherwise trip the new CHECK constraint, which
      // is exactly what the constraint is there to prevent.
      const issued = c.due
        ? new Date(Math.min(uatIssued.getTime(), c.due.getTime() - ADD))
        : uatIssued
      return prisma.invoice.create({
        data: {
          vendorId: vendors[0].id,
          companyId: companies[0].id,
          invoiceNumber: c.n,
          poNumber: `PO-${c.n}`,
          invoiceDate: issued,
          dueDate: c.due,
          currency: 'IDR',
          subtotal: 9_009_009,
          taxAmount: 990_991,
          totalAmount: 10_000_000,
          status: c.status,
          picStage: PICStage.GA,
          sendDate: new Date(issued.getTime() - ADD),
          createdById: admin.id,
          createdAt: new Date(issued.getTime() + i * 1000),
          isDraft: c.isDraft ?? false,
          notes: `UAT: ${c.label}`,
          stageHistory: { create: { stage: PICStage.GA, changedById: admin.id, changedAt: issued } },
          items: { create: { description: 'Jasa Konsultasi IT', quantity: 1, unitPrice: 9_009_009, total: 9_009_009, sortOrder: 1 } },
        },
      })
    }),
  )

  console.log(`UAT boundary invoices: ${uatCases.map((c) => c.n).join(', ')} (vendor: ${vendorSpecs[0].name})`)
  console.log('Dummy data created: 3 companies, 6 vendors, 100 invoices (2 items each), stage history')
  const pad = Math.max(adminEmail.length, ...demoUsers.map((u) => u.email.length))
  const row = (email: string, role: string, note: string) =>
    `  ${email.padEnd(pad)}  ${role.padEnd(11)} ${note}`
  console.log(`
Demo accounts — all four share DEMO_PASSWORD (default "demo1234")
${DEMO_ACCOUNTS.map((u) => row(u.email, u.role, u.name)).join('\n')}

Extra UAT accounts (same password, for specific scenarios)
${EXTRA_UAT_ACCOUNTS.map((u) => row(u.email, u.role, u.name)).join('\n')}

Bootstrap admin (separate secret)
${row(adminEmail, 'ADMIN', 'password: ADMIN_PASSWORD env, or its default')}
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
