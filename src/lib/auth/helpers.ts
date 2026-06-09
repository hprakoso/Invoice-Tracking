import { auth } from '@/lib/auth/auth'
import { NextResponse } from 'next/server'
import type { Role } from '@prisma/client'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  }
  return { error: null, session }
}

export async function requireRole(allowedRoles: Role[]) {
  const { error, session } = await requireAuth()
  if (error || !session) return { error: error!, session: null }

  if (!allowedRoles.includes(session.user.role)) {
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      session: null,
    }
  }
  return { error: null, session }
}
