import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000'

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const body = await req.json()

  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: body.message, history: body.history ?? [] }),
      signal: AbortSignal.timeout(30000),
    })

    if (!aiRes.ok) {
      return NextResponse.json(
        { answer: 'Maaf, layanan AI sedang tidak tersedia. Silakan coba lagi.' },
        { status: 200 }
      )
    }

    const data = await aiRes.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { answer: 'Maaf, layanan AI sedang tidak tersedia. Silakan coba lagi.' },
      { status: 200 }
    )
  }
}
