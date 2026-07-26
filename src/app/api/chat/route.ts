import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/helpers'
import { rateLimit } from '@/lib/rate-limit'
import { runChat } from '@/lib/services/geminiChat'

export async function POST(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN', 'GA_MANAGER'])
  if (error || !session) return error

  const limit = rateLimit(`chat:${session.user.id}`, 10, 60_000)
  if (limit) return limit

  const body = await req.json()

  try {
    const answer = await runChat(body.message, body.history ?? [])
    return NextResponse.json({ answer })
  } catch {
    return NextResponse.json(
      { answer: 'Maaf, layanan AI sedang tidak tersedia. Silakan coba lagi.' },
      { status: 200 }
    )
  }
}
