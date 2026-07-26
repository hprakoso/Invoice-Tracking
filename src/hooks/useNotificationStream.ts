'use client'

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 60_000

export function useNotificationStream(): number {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch('/api/notifications?unread=true')
        if (!res.ok) return
        const data: unknown = await res.json()
        if (!cancelled && Array.isArray(data)) {
          setUnreadCount(data.length)
        }
      } catch {
        // Network error — keep the last known count, try again next tick.
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return unreadCount
}
