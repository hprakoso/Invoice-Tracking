import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  const status: Record<string, string> = {
    app: 'ok',
    db: 'unknown',
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    status.db = 'ok'
  } catch {
    status.db = 'error'
  }

  const isHealthy = Object.values(status).every((v) => v === 'ok')

  return NextResponse.json(
    { status: isHealthy ? 'ok' : 'degraded', ...status },
    { status: isHealthy ? 200 : 503 },
  )
}
