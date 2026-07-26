import { NextRequest, NextResponse } from 'next/server'
import { checkDueDates } from '@/lib/services/reminderScheduler'

// Vercel Cron hits this route on the schedule declared in vercel.json.
// Hobby plan caps cron at once/day with up to ~60min jitter — see
// docs/PRODUCTION_PLAN.md §4.2. Guarded by CRON_SECRET so it can't be
// triggered by anyone who finds the URL.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await checkDueDates()
  return NextResponse.json({ ok: true, ...result })
}
