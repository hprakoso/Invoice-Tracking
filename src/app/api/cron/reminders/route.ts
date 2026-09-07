import { NextRequest, NextResponse } from 'next/server'
import { checkDueDates } from '@/lib/services/reminderScheduler'

// Vercel Cron hits this route on the schedule declared in vercel.json.
// Hobby plan caps cron at once/day with up to ~60min jitter — see
// docs/PRODUCTION_PLAN.md §4.2. Guarded by CRON_SECRET so it can't be
// triggered by anyone who finds the URL.
export async function GET(req: NextRequest) {
  // Checked separately so an unset CRON_SECRET fails closed. Comparing against
  // `Bearer ${undefined}` would have made the literal header "Bearer undefined"
  // a valid key on any deployment that forgot the env var.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await checkDueDates()
  return NextResponse.json({ ok: true, ...result })
}
