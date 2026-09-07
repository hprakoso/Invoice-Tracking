import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

function createPrismaClient() {
  // Port 5433 — what docker-compose publishes and what prisma.config.ts falls
  // back to. This said 5434, so a deployment that forgot DATABASE_URL failed
  // against a port nothing has ever listened on, and the error pointed
  // triage at the wrong place.
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo'

  // Strip sslmode/sslaccept from URL — explicit ssl option below takes precedence
  const url = new URL(connectionString)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('sslaccept')

  const ssl = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false'
    ? { rejectUnauthorized: false }
    : undefined

  const pool = new Pool({ connectionString: url.toString(), ssl })
  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
