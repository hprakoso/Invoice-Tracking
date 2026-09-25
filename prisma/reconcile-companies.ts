/**
 * Reconcile the sample/UAT Company master down to the two real bill-to
 * entities, without wiping anything else.
 *
 * WHY THIS EXISTS, SEPARATELY FROM seed.ts
 * ----------------------------------------
 * `prisma/seed.ts` produces the right two companies, but it only ever runs
 * against a *fresh* database: it `deleteMany()`s every table first. Nothing in
 * the deployment runs it — the runtime image is `CMD ["node", "server.js"]`,
 * `render.yaml` sets no build/start/pre-deploy command, and `db:seed` is a
 * manual npm script. So an environment that was seeded once, before the company
 * list changed, keeps its old rows forever and re-deploying changes nothing.
 *
 * Re-seeding such an environment is not an option mid-UAT: it would destroy
 * every invoice, user and document the testers have produced.
 *
 * This script is the targeted alternative. It is idempotent — running it on an
 * already-correct database reports "nothing to do" and writes nothing.
 *
 * DELIBERATELY NOT WIRED INTO ANYTHING AUTOMATIC. It is not a migration and it
 * is not called at application startup, because deleting Company rows is only
 * ever correct for sample data. Run it explicitly:
 *
 *     npm run db:reconcile-companies
 *
 * Add `--dry-run` to print the plan without writing.
 */
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Mirrors prisma/seed.ts and src/lib/db/prisma.ts — Supabase's pooler ignores
// sslmode URL params under the Prisma v7 adapter-pg driver adapter.
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo'
const url = new URL(connectionString)
url.searchParams.delete('sslmode')
url.searchParams.delete('sslaccept')
const ssl =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url.toString(), ssl })) })

/**
 * The approved bill-to entities. Kept byte-identical to `companySpecs` in
 * prisma/seed.ts so a fresh seed and a reconciled database agree; if that list
 * changes, change it here too.
 */
const APPROVED = [
  { name: 'PT. Berau Coal Energy Tbk.', npwp: '31.234.567.8-901.000', address: 'Jl. Jend. Sudirman Kav. 52-53', city: 'Jakarta', email: 'ap@beraucoalenergy.co.id' },
  { name: 'PT. Borneo Indobara', npwp: '32.345.678.9-012.000', address: 'Jl. Basuki Rahmat No. 88', city: 'Banjarmasin', email: 'finance@borneoindobara.co.id' },
]

const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log(dryRun ? 'Reconciling companies (DRY RUN — no writes)...' : 'Reconciling companies...')

  // 1. Make sure both approved rows exist and are active. Matched by name,
  //    which is what identifies a company to a human; ids are generated per
  //    environment and cannot be matched on.
  const approved = []
  for (const spec of APPROVED) {
    const existing = await prisma.company.findFirst({ where: { name: spec.name } })
    if (existing) {
      if (!existing.isActive && !dryRun) {
        await prisma.company.update({ where: { id: existing.id }, data: { isActive: true } })
        console.log(`  reactivated: ${spec.name}`)
      } else if (!existing.isActive) {
        console.log(`  would reactivate: ${spec.name}`)
      }
      approved.push(existing)
    } else if (dryRun) {
      console.log(`  would create: ${spec.name}`)
    } else {
      approved.push(await prisma.company.create({ data: spec }))
      console.log(`  created: ${spec.name}`)
    }
  }

  if (approved.length < APPROVED.length) {
    console.log('  (dry run) cannot plan remapping until the approved rows exist — rerun without --dry-run')
    return
  }

  // 2. Everything else is legacy sample data. Ordered by name so the remap
  //    below is deterministic and a re-run produces the same result.
  const legacy = await prisma.company.findMany({
    where: { id: { notIn: approved.map((c) => c.id) } },
    orderBy: { name: 'asc' },
  })

  if (legacy.length === 0) {
    console.log('  nothing to do — only the approved companies are present')
    await report()
    return
  }

  // 3. Re-point their invoices before deleting anything, so no FK is orphaned.
  //    `invoices.company_id` is the ONLY foreign key into companies (verified
  //    against prisma/schema.prisma), so this is the complete dependency set.
  //
  //    The remap is round-robin across the approved list by the legacy row's
  //    sorted position. seed.ts spreads invoices over the companies at random
  //    with no per-invoice meaning, so there is no business rule to preserve —
  //    only the property that invoices end up distributed rather than all piled
  //    onto one company. Nothing but `company_id` is touched: vendor, amounts,
  //    dates and status are left exactly as they are.
  for (const [i, old] of legacy.entries()) {
    const target = approved[i % approved.length]
    const count = await prisma.invoice.count({ where: { companyId: old.id } })
    if (dryRun) {
      console.log(`  would remap ${count} invoice(s): "${old.name}" -> "${target.name}", then delete "${old.name}"`)
      continue
    }
    if (count > 0) {
      await prisma.invoice.updateMany({ where: { companyId: old.id }, data: { companyId: target.id } })
    }
    await prisma.company.delete({ where: { id: old.id } })
    console.log(`  remapped ${count} invoice(s): "${old.name}" -> "${target.name}", deleted "${old.name}"`)
  }

  if (!dryRun) await report()
}

async function report() {
  const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } })
  const orphans = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM invoices i
    WHERE i.company_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = i.company_id)`
  const vendors = await prisma.vendor.count()

  console.log('')
  console.log(`Companies: ${companies.length}`)
  for (const c of companies) console.log(`- ${c.name}${c.isActive ? '' : '  (INACTIVE)'}`)
  console.log(`Orphan Company FKs: ${Number(orphans[0]?.count ?? 0)}`)
  console.log(`Vendors (untouched): ${vendors}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
