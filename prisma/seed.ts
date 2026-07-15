import { PrismaClient, Role, InvoiceStatus } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo'

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
    prisma.user.create({
      data: {
        email: 'gastaff2@demo.com',
        name: 'Putri Anggraini',
        role: Role.GA_STAFF,
        passwordHash: demoHash,
      },
    }),
  ])

  const [admin, manager, finance, viewer, gaStaff, gaManager, gaStaff2] = users
  void admin
  void viewer
  void gaManager
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

  // Create 20 invoices across the 5 statuses. sendDate = vendor sent hardcopy,
  // deliveredDate/pic = GA Staff who received it (null on a few SUBMITTED rows
  // to demo "not yet received"). createdBy varies across VENDOR/GA_STAFF/FINANCE.
  const invoiceData = [
    // SUBMITTED (10), mix of on-time / due-soon / overdue for the reminder scheduler
    { vendor: vendors[0], num: 'INV-2024-001', status: InvoiceStatus.SUBMITTED, total: 45000000, tax: 4500000, created: daysAgo(10), due: daysFromNow(20), confidence: 94, creator: 'vendor', pic: gaStaff, sent: daysAgo(11), delivered: daysAgo(9) },
    { vendor: vendors[1], num: 'INV-2024-002', status: InvoiceStatus.SUBMITTED, total: 120000000, tax: 12000000, created: daysAgo(8), due: daysFromNow(22), confidence: 88, creator: 'vendor', pic: gaStaff2, sent: daysAgo(9), delivered: daysAgo(7) },
    { vendor: vendors[2], num: 'INV-2024-003', status: InvoiceStatus.SUBMITTED, total: 28500000, tax: 2850000, created: daysAgo(6), due: daysFromNow(24), confidence: 91, creator: 'gastaff', pic: gaStaff, sent: daysAgo(6), delivered: daysAgo(6) },
    { vendor: vendors[3], num: 'INV-2024-004', status: InvoiceStatus.SUBMITTED, total: 75000000, tax: 7500000, created: daysAgo(4), due: daysFromNow(2), confidence: 96, creator: 'vendor', pic: null, sent: daysAgo(4), delivered: null },
    { vendor: vendors[4], num: 'INV-2024-005', status: InvoiceStatus.SUBMITTED, total: 55000000, tax: 5500000, created: daysAgo(3), due: daysFromNow(1), confidence: 89, creator: 'finance', pic: gaStaff2, sent: daysAgo(3), delivered: daysAgo(2) },
    { vendor: vendors[5], num: 'INV-2024-006', status: InvoiceStatus.SUBMITTED, total: 33000000, tax: 3300000, created: daysAgo(2), due: daysFromNow(10), confidence: 92, creator: 'vendor', pic: null, sent: daysAgo(2), delivered: null },
    { vendor: vendors[0], num: 'INV-2024-007', status: InvoiceStatus.SUBMITTED, total: 88000000, tax: 8800000, created: daysAgo(45), due: daysAgo(15), confidence: 87, creator: 'vendor', pic: gaStaff, sent: daysAgo(45), delivered: daysAgo(44) },
    { vendor: vendors[1], num: 'INV-2024-008', status: InvoiceStatus.SUBMITTED, total: 57000000, tax: 5700000, created: daysAgo(40), due: daysAgo(10), confidence: 93, creator: 'gastaff', pic: gaStaff, sent: daysAgo(40), delivered: daysAgo(40) },
    { vendor: vendors[2], num: 'INV-2024-009', status: InvoiceStatus.SUBMITTED, total: 500000000, tax: 50000000, created: daysAgo(35), due: daysAgo(5), confidence: 95, creator: 'vendor', pic: gaStaff2, sent: daysAgo(36), delivered: daysAgo(34) },
    { vendor: vendors[3], num: 'INV-2024-010', status: InvoiceStatus.SUBMITTED, total: 78000000, tax: 7800000, created: daysAgo(25), due: daysFromNow(2), confidence: 91, creator: 'vendor', pic: gaStaff, sent: daysAgo(25), delivered: daysAgo(23) },
    // REVISION (3) -- sent back for correction
    { vendor: vendors[4], num: 'INV-2024-011', status: InvoiceStatus.REVISION, total: 22000000, tax: 2200000, created: daysAgo(12), due: daysFromNow(18), confidence: 78, creator: 'vendor', pic: gaStaff, sent: daysAgo(12), delivered: daysAgo(11) },
    { vendor: vendors[5], num: 'INV-2024-012', status: InvoiceStatus.REVISION, total: 98000000, tax: 9800000, created: daysAgo(9), due: daysFromNow(14), confidence: 83, creator: 'gastaff', pic: gaStaff2, sent: daysAgo(9), delivered: daysAgo(9) },
    { vendor: vendors[0], num: 'INV-2024-013', status: InvoiceStatus.REVISION, total: 310000000, tax: 31000000, created: daysAgo(7), due: daysFromNow(21), confidence: 90, creator: 'vendor', pic: gaStaff, sent: daysAgo(7), delivered: daysAgo(6) },
    // REJECTED (3)
    { vendor: vendors[1], num: 'INV-2024-014', status: InvoiceStatus.REJECTED, total: 15000000, tax: 1500000, created: daysAgo(20), due: daysFromNow(5), confidence: 62, creator: 'vendor', pic: gaStaff, sent: daysAgo(20), delivered: daysAgo(19) },
    { vendor: vendors[2], num: 'INV-2024-015', status: InvoiceStatus.REJECTED, total: 42000000, tax: 4200000, created: daysAgo(18), due: daysFromNow(30), confidence: 70, creator: 'vendor', pic: gaStaff2, sent: daysAgo(18), delivered: daysAgo(17) },
    { vendor: vendors[3], num: 'INV-2024-016', status: InvoiceStatus.REJECTED, total: 18500000, tax: 1850000, created: daysAgo(16), due: daysFromNow(28), confidence: 65, creator: 'gastaff', pic: gaStaff, sent: daysAgo(16), delivered: daysAgo(16) },
    // CANCELLED (2)
    { vendor: vendors[4], num: 'INV-2024-017', status: InvoiceStatus.CANCELLED, total: 25000000, tax: 2500000, created: daysAgo(30), due: daysAgo(2), confidence: 88, creator: 'vendor', pic: gaStaff, sent: daysAgo(30), delivered: daysAgo(29) },
    { vendor: vendors[5], num: 'INV-2024-018', status: InvoiceStatus.CANCELLED, total: 33500000, tax: 3350000, created: daysAgo(22), due: daysFromNow(8), confidence: 80, creator: 'vendor', pic: gaStaff2, sent: daysAgo(22), delivered: daysAgo(21) },
    // VOID (2)
    { vendor: vendors[0], num: 'INV-2024-019', status: InvoiceStatus.VOID, total: 145000000, tax: 14500000, created: daysAgo(50), due: daysAgo(20), confidence: 85, creator: 'finance', pic: gaStaff, sent: daysAgo(50), delivered: daysAgo(49) },
    { vendor: vendors[1], num: 'INV-2024-020', status: InvoiceStatus.VOID, total: 130000000, tax: 13000000, created: daysAgo(38), due: daysAgo(8), confidence: 94, creator: 'vendor', pic: gaStaff2, sent: daysAgo(38), delivered: daysAgo(37) },
  ]

  const invoices = []
  for (const d of invoiceData) {
    const creator = d.creator === 'gastaff' ? gaStaff : finance
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
        sendDate: d.sent,
        deliveredDate: d.delivered,
        picId: d.pic?.id ?? null,
        createdById: creator.id,
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

  // Create due-soon and overdue notifications for Finance + GA Staff
  const overdueInvoices = invoices.filter((inv) =>
    ['INV-2024-007', 'INV-2024-008', 'INV-2024-009'].includes(inv.invoiceNumber),
  )
  const dueSoonInvoices = invoices.filter((inv) =>
    ['INV-2024-004', 'INV-2024-005', 'INV-2024-010'].includes(inv.invoiceNumber),
  )

  for (const inv of overdueInvoices) {
    for (const userId of [finance.id, gaStaff.id]) {
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
    for (const userId of [finance.id, gaStaff.id]) {
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
  finance@demo.com    / demo123  (Finance - records final outcome)
  viewer@demo.com     / demo123  (Viewer)
  gastaff@demo.com    / demo123  (GA Staff - receives hardcopies, PIC)
  gastaff2@demo.com   / demo123  (GA Staff - receives hardcopies, PIC)
  gamanager@demo.com  / demo123  (GA Manager - deprecated)
  vendor1@demo.com    / demo123  (Vendor: PT Maju Jaya Abadi)
  vendor2@demo.com    / demo123  (Vendor: CV Teknologi Nusantara)
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
