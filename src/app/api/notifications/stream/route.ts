import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'

export async function GET(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const encoder = new TextEncoder()
  const userId = session.user.id

  const stream = new ReadableStream({
    async start(controller) {
      const send = (count: number) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ unreadCount: count })}\n\n`)
        )
      }

      // Send immediately on connect
      const initial = await prisma.notification.count({
        where: { userId, isRead: false },
      })
      send(initial)

      // Poll every 15 seconds (simple approach for demo)
      let lastCount = initial
      const interval = setInterval(async () => {
        try {
          const count = await prisma.notification.count({
            where: { userId, isRead: false },
          })
          if (count !== lastCount) {
            lastCount = count
            send(count)
          }
        } catch {
          clearInterval(interval)
          controller.close()
        }
      }, 15000)

      // Clean up when client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
