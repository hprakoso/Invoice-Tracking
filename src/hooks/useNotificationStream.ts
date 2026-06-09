'use client'

import { useEffect, useState } from 'react'

export function useNotificationStream(): number {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const es = new EventSource('/api/notifications/stream')

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (typeof data.unreadCount === 'number') {
          setUnreadCount(data.unreadCount)
        }
      } catch {}
    }

    es.onerror = () => {
      es.close()
    }

    return () => es.close()
  }, [])

  return unreadCount
}
