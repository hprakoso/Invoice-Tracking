import { PrismaClient, Role, InvoiceStatus, ApprovalStatus } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://invoice_user:invoice_pass@localhost:5434/invoice_demo'

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed script blocked in production environment.')
    process.exit(1)
  }

  console.log('Seeding database...')

  // Clean existing data
  await prisma.notification.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.approvalWorkflow.deleteMany()
  await prisma.invoiceItem.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.vendor.deleteMany()
  await prisma.user.deleteMany()

  const demoHash = await hashPassword('demo123')

  // Create demo users
  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@demo.com',
        name: 'Budi Santoso',
        role: Role.ADMIN,
        passwordHash: demoHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'manager@demo.com',
        name: 'Siti Rahayu',
        role: Role.MANAGER,
        passwordHash: demoHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'finance@demo.com',
        name: 'Agus Wijaya',
        role: Role.FINANCE,
        passwordHash: demoHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'viewer@demo.com',
        name: 'Dewi Lestari',
        role: Role.VIEWER,
        passwordHash: demoHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'gastaff@demo.com',
        name: 'Rina Kusuma',
        role: Role.GA_STAFF,
        passwordHash: demoHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'gamanager@demo.com',
        name: 'Hendra Wijaya',
        role: Role.GA_MANAGER,
        passwordHash: demoHash,
      },
    }),
  ])

  const [admin, manager, finance, viewer, gaStaff, gaManager] = users
  void admin
  void viewer
  void gaStaff
  console.log('Users created')

  // Create vendors
  const vendors = await Promise.all([
    prisma.vendor.create({
      data: {
        name: 'PT Maju Jaya Abadi',
        npwp: '01.234.567.8-901.000',
        contactName: 'Hendra Kusuma',
        contactEmail: 'hendra@majujaya.co.id',
        bankName: 'Bank BCA',
        bankAccount: '1234567890',
      },
    }),
    prisma.vendor.create({
      data: {
        name: 'CV Teknologi Nusantara',
        npwp: '02.345.678.9-012.000',
        contactName: 'Rina Susanti',
        contactEmail: 'rina@teknologi-nusantara.id',
        bankName: 'Bank Mandiri',
        bankAccount: '9876543210',
      },
    }),
    prisma.vendor.create({
      data: {
        name: 'PT Solusi Digital Indonesia',
        npwp: '03.456.789.0-123.000',
        contactName: 'Doni Prasetyo',
        contactEmail: 'doni@solusidigital.id',
        bankName: 'Bank BNI',
        bankAccount: '1122334455',
      },
    }),
    prisma.vendor.create({
      data: {
        name: 'UD Karya Gemilang',
        npwp: '04.567.890.1-234.000',
        contactName: 'Yanti Permata',
        contactEmail: 'yanti@karyagemilang.com',
        bankName: 'Bank BRI',
        bankAccount: '5566778899',
      },
    }),
    prisma.vendor.create({
      data: {
        name: 'PT Inovasi Teknologi Bangsa',
        npwp: '05.678.901.2-345.000',
        contactName: 'Fajar Nugroho',
        contactEmail: 'fajar@inovasiteknologi.id',
        bankName: 'Bank CIMB Niaga',
        bankAccount: '6677889900',
      },
    }),
    prisma.vendor.create({
      data: {
        name: 'CV Mandiri Sejahtera',
        npwp: '06.789.012.3-456.000',
        contactName: 'Wulan Sari',
        contactEmail: 'wulan@mandrisejahtera.co.id',
        bankName: 'Bank Permata',
        bankAccount: '0011223344',
      },
    }),
  ])
  console.log('Vendors created')

  // Create vendor users linked to specific vendors
  await Promise.all([
    prisma.user.create({
      data: {
        email: 'vendor1@demo.com',
        name: 'Hendra Kusuma (Maju Jaya)',
        role: Role.VENDOR,
        passwordHash: demoHash,
        vendorId: vendors[0].id,
      },
    }),
    prisma.user.create({
      data: {
        email: 'vendor2@demo.com',
        name: 'Rina Susanti (Teknologi Nusantara)',
        role: Role.VENDOR,
        passwordHash: demoHash,
        vendorId: vendors[1].id,
      },
    }),
  ])
  console.log('Vendor users created')

  const now = new Date()
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000)
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000)

  // Create 20 invoices across all statuses
  const invoiceData = [
    // PAID invoices (4)
    { vendor: vendors[0], num: 'INV-2024-001', status: InvoiceStatus.PAID, total: 45000000, tax: 4500000, created: daysAgo(60), due: daysAgo(30), confidence: 94 },
    { vendor: vendors[1], num: 'INV-2024-002', status: InvoiceStatus.PAID, total: 120000000, tax: 12000000, created: daysAgo(55), due: daysAgo(25), confidence: 88 },
    { vendor: vendors[2], num: 'INV-2024-003', status: InvoiceStatus.PAID, total: 28500000, tax: 2850000, created: daysAgo(45), due: daysAgo(15), confidence: 91 },
    { vendor: vendors[3], num: 'INV-2024-004', status: InvoiceStatus.PAID, total: 75000000, tax: 7500000, created: daysAgo(40), due: daysAgo(10), confidence: 96 },
    // APPROVED invoices (3)
    { vendor: vendors[4], num: 'INV-2024-005', status: InvoiceStatus.APPROVED, total: 55000000, tax: 5500000, created: daysAgo(30), due: daysFromNow(5), confidence: 89 },
    { vendor: vendors[5], num: 'INV-2024-006', status: InvoiceStatus.APPROVED, total: 33000000, tax: 3300000, created: daysAgo(25), due: daysFromNow(10), confidence: 92 },
    { vendor: vendors[0], num: 'INV-2024-007', status: InvoiceStatus.APPROVED, total: 88000000, tax: 8800000, created: daysAgo(20), due: daysFromNow(15), confidence: 87 },
    // REJECTED invoice (1)
    { vendor: vendors[1], num: 'INV-2024-008', status: InvoiceStatus.REJECTED, total: 15000000, tax: 1500000, created: daysAgo(15), due: daysFromNow(5), confidence: 62 },
    // PENDING_APPROVAL invoices (2 -- for live demo)
    { vendor: vendors[2], num: 'INV-2024-009', status: InvoiceStatus.PENDING_APPROVAL, total: 67500000, tax: 6750000, created: daysAgo(5), due: daysFromNow(10), confidence: 91 },
    { vendor: vendors[3], num: 'INV-2024-010', status: InvoiceStatus.PENDING_APPROVAL, total: 145000000, tax: 14500000, created: daysAgo(3), due: daysFromNow(7), confidence: 85 },
    // PENDING_REVIEW invoices (3)
    { vendor: vendors[4], num: 'INV-2024-011', status: InvoiceStatus.PENDING_REVIEW, total: 22000000, tax: 2200000, created: daysAgo(2), due: daysFromNow(20), confidence: 78 },
    { vendor: vendors[5], num: 'INV-2024-012', status: InvoiceStatus.PENDING_REVIEW, total: 98000000, tax: 9800000, created: daysAgo(1), due: daysFromNow(14), confidence: 83 },
    { vendor: vendors[0], num: 'INV-2024-013', status: InvoiceStatus.PENDING_REVIEW, total: 310000000, tax: 31000000, created: daysAgo(1), due: daysFromNow(21), confidence: 90 },
    // PENDING_OCR invoices (2)
    { vendor: vendors[1], num: 'INV-2024-014', status: InvoiceStatus.PENDING_OCR, total: 42000000, tax: 4200000, created: daysAgo(0), due: daysFromNow(30), confidence: null },
    { vendor: vendors[2], num: 'INV-2024-015', status: InvoiceStatus.PENDING_OCR, total: 18500000, tax: 1850000, created: daysAgo(0), due: daysFromNow(28), confidence: null },
    // OVERDUE invoices (3 -- for reminder demo)
    { vendor: vendors[3], num: 'INV-2024-016', status: InvoiceStatus.APPROVED, total: 57000000, tax: 5700000, created: daysAgo(45), due: daysAgo(15), confidence: 93 },
    { vendor: vendors[4], num: 'INV-2024-017', status: InvoiceStatus.APPROVED, total: 25000000, tax: 2500000, created: daysAgo(40), due: daysAgo(10), confidence: 88 },
    { vendor: vendors[5], num: 'INV-2024-018', status: InvoiceStatus.PENDING_APPROVAL, total: 500000000, tax: 50000000, created: daysAgo(35), due: daysAgo(5), confidence: 95 },
    // Due soon (2 -- for reminder demo)
    { vendor: vendors[0], num: 'INV-2024-019', status: InvoiceStatus.PENDING_APPROVAL, total: 78000000, tax: 7800000, created: daysAgo(25), due: daysFromNow(2), confidence: 91 },
    { vendor: vendors[1], num: 'INV-2024-020', status: InvoiceStatus.APPROVED, total: 130000000, tax: 13000000, created: daysAgo(28), due: daysFromNow(1), confidence: 94 },
  ]

  const invoices = []
  for (const d of invoiceData) {
    const inv = await prisma.invoice.create({
      data: {
        vendorId: d.vendor.id,
        invoiceNumber: d.num,
        invoiceDate: d.created,
        dueDate: d.due,
        currency: 'IDR',
        subtotal: d.total - d.tax,
        taxAmount: d.tax,
        totalAmount: d.total,
        status: d.status,
        ocrConfidence: d.confidence,
        createdById: finance.id,
        items: {
          create: [
            {
              description: 'Jasa Konsultasi IT',
              quantity: 1,
              unitPrice: Math.round((d.total - d.tax) * 0.6),
              total: Math.round((d.total - d.tax) * 0.6),
              sortOrder: 1,
            },
            {
              description: 'Lisensi Software',
              quantity: 1,
              unitPrice: Math.round((d.total - d.tax) * 0.4),
              total: Math.round((d.total - d.tax) * 0.4),
              sortOrder: 2,
            },
          ],
        },
      },
    })
    invoices.push(inv)

    // Create approval workflow records for relevant statuses
    if (
      ([InvoiceStatus.PAID, InvoiceStatus.APPROVED, InvoiceStatus.REJECTED, InvoiceStatus.PENDING_APPROVAL] as InvoiceStatus[]).includes(
        d.status,
      )
    ) {
      // Step 1: GA Manager review
      await prisma.approvalWorkflow.create({
        data: {
          invoiceId: inv.id,
          step: 1,
          approverId: gaManager.id,
          status:
            d.status === InvoiceStatus.REJECTED ? ApprovalStatus.REJECTED : ApprovalStatus.APPROVED,
          comment:
            d.status === InvoiceStatus.REJECTED
              ? 'Dokumen tidak lengkap, perlu revisi.'
              : 'Data telah diverifikasi dan sesuai.',
          actionedAt:
            d.status === InvoiceStatus.REJECTED
              ? daysAgo(14)
              : daysAgo(Math.floor(Math.random() * 5) + 1),
        },
      })

      // Step 2: Finance final approval (only for approved/paid)
      if (([InvoiceStatus.PAID, InvoiceStatus.APPROVED] as InvoiceStatus[]).includes(d.status)) {
        await prisma.approvalWorkflow.create({
          data: {
            invoiceId: inv.id,
            step: 2,
            approverId: finance.id,
            status: ApprovalStatus.APPROVED,
            comment: 'Disetujui untuk pembayaran.',
            actionedAt: daysAgo(Math.floor(Math.random() * 3) + 1),
          },
        })
      }

      // Pending step 2 for PENDING_APPROVAL
      if (d.status === InvoiceStatus.PENDING_APPROVAL) {
        await prisma.approvalWorkflow.create({
          data: {
            invoiceId: inv.id,
            step: 2,
            status: ApprovalStatus.PENDING,
          },
        })
      }
    }
  }
  console.log('Invoices created')

  // Create audit log entries
  for (const inv of invoices.slice(0, 10)) {
    await prisma.auditLog.create({
      data: {
        userId: finance.id,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: inv.id,
        invoiceId: inv.id,
        metadata: { invoiceNumber: inv.invoiceNumber },
      },
    })
  }
  console.log('Audit logs created')

  // Create due-soon and overdue notifications for Finance + Manager
  const overdueInvoices = invoices.filter((inv) =>
    ['INV-2024-016', 'INV-2024-017', 'INV-2024-018'].includes(inv.invoiceNumber),
  )
  const dueSoonInvoices = invoices.filter((inv) =>
    ['INV-2024-019', 'INV-2024-020'].includes(inv.invoiceNumber),
  )

  for (const inv of overdueInvoices) {
    for (const userId of [finance.id, gaManager.id]) {
      await prisma.notification.create({
        data: {
          userId,
          invoiceId: inv.id,
          type: 'overdue',
          title: `Invoice ${inv.invoiceNumber} sudah jatuh tempo`,
          body: `Invoice senilai Rp ${Number(inv.totalAmount).toLocaleString('id-ID')} dari vendor belum dibayar.`,
        },
      })
    }
  }

  for (const inv of dueSoonInvoices) {
    for (const userId of [finance.id, gaManager.id]) {
      await prisma.notification.create({
        data: {
          userId,
          invoiceId: inv.id,
          type: 'due_soon',
          title: `Invoice ${inv.invoiceNumber} akan jatuh tempo`,
          body: `Invoice senilai Rp ${Number(inv.totalAmount).toLocaleString('id-ID')} jatuh tempo dalam 2 hari.`,
        },
      })
    }
  }
  console.log('Notifications created')

  console.log('Seed complete!')
  console.log(`
Demo Accounts:
  admin@demo.com      / demo123  (Admin)
  manager@demo.com    / demo123  (Manager - deprecated)
  finance@demo.com    / demo123  (Finance - final approval)
  viewer@demo.com     / demo123  (Viewer)
  gastaff@demo.com    / demo123  (GA Staff - review)
  gamanager@demo.com  / demo123  (GA Manager - step 1 approval)
  vendor1@demo.com    / demo123  (Vendor: PT Maju Jaya Abadi)
  vendor2@demo.com    / demo123  (Vendor: CV Teknologi Nusantara)
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
