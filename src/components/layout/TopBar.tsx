'use client'

import { signOut, useSession } from 'next-auth/react'
import { Bell, LogOut, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MobileSidebar } from './Sidebar'
import { useNotificationStream } from '@/hooks/useNotificationStream'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Notification {
  id: string
  title: string
  body: string
  type: string
  isRead: boolean
  createdAt: string
}

export function TopBar() {
  const { data: session } = useSession()
  const unreadCount = useNotificationStream()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) {
      fetch('/api/notifications?unread=true')
        .then(r => r.json())
        .then(data => setNotifications(Array.isArray(data) ? data.slice(0, 5) : []))
        .catch(() => {})
    }
  }, [open])

  const markAllRead = async () => {
    await fetch('/api/notifications', { method: 'PATCH' })
    setNotifications([])
  }

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    MANAGER: 'bg-blue-100 text-blue-700',
    FINANCE: 'bg-green-100 text-green-700',
    VIEWER: 'bg-gray-100 text-gray-700',
  }

  const role = (session?.user as { role?: string })?.role ?? 'VIEWER'

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-white px-4">
      <MobileSidebar />

      <div className="flex-1" />

      {/* Notification Bell */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="relative inline-flex items-center justify-center h-9 w-9 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <p className="text-sm font-semibold">Notifikasi</p>
            {notifications.length > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">
                Tandai semua dibaca
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Tidak ada notifikasi baru</p>
            ) : (
              notifications.map(n => (
                <div key={n.id} className="px-4 py-3 border-b last:border-0 hover:bg-gray-50">
                  <p className="text-xs font-medium text-gray-900">{n.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-2 border-t">
            <Link href="/reminders" className="text-xs text-blue-600 hover:underline" onClick={() => setOpen(false)}>
              Lihat semua notifikasi →
            </Link>
          </div>
        </PopoverContent>
      </Popover>

      {/* User */}
      <div className="flex items-center gap-2">
        <div className={`hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${roleColors[role]}`}>
          <User className="h-3 w-3" />
          {session?.user?.name?.split(' ')[0]}
        </div>
        <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: '/login' })}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
