'use client'

import { signOut, useSession } from 'next-auth/react'
import { Bell, LogOut, User, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MobileSidebar } from './Sidebar'
import { useNotificationStream } from '@/hooks/useNotificationStream'
import { useTheme } from '@/hooks/useTheme'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/invoices': 'Invoices',
  '/invoices/upload': 'Upload Invoice',
  '/reminders': 'Reminders',
  '/chat': 'AI Assistant',
  '/audit': 'Audit Log',
  '/admin/users': 'User Management',
}

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
    ADMIN:      'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    MANAGER:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    FINANCE:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    GA_STAFF:   'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    GA_MANAGER: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    VENDOR:     'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    VIEWER:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  }

  const role = (session?.user as { role?: string })?.role ?? 'VIEWER'
  const pathname = usePathname()
  const { theme, toggle, mounted } = useTheme()
  const pageTitle = Object.entries(PAGE_TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => pathname === path || pathname.startsWith(path + '/'))?.[1] ?? 'Invoice Intelligence'

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-white dark:bg-gray-900 dark:border-gray-800 px-4">
      <MobileSidebar />

      <p className="lg:hidden text-sm font-semibold text-gray-800 dark:text-gray-100 truncate flex-1">{pageTitle}</p>
      <div className="hidden lg:block flex-1" />

      {/* Theme Toggle */}
      {mounted && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={toggle}
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </Button>
      )}

      {/* Notification Bell */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'} className="relative inline-flex items-center justify-center h-9 w-9 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <p className="text-sm font-semibold">Notifications</p>
            {notifications.length > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">No new notifications</p>
            ) : (
              notifications.map(n => (
                <div key={n.id} className="px-4 py-3 border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-800">
                  <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{n.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{n.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-2 border-t">
            <Link href="/reminders" className="text-xs text-blue-600 hover:underline" onClick={() => setOpen(false)}>
              View all notifications →
            </Link>
          </div>
        </PopoverContent>
      </Popover>

      {/* User */}
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${roleColors[role]}`}>
          <User className="h-3 w-3" />
          <span className="hidden sm:inline">{session?.user?.name?.split(' ')[0]}</span>
          <span className="sm:hidden">{role}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Logout" onClick={() => signOut({ callbackUrl: '/login' })}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
