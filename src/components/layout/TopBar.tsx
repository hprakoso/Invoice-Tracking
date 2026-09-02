'use client'

import { signOut, useSession } from 'next-auth/react'
import { Bell, LogOut, User, Moon, Sun, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MobileSidebar } from './Sidebar'
import { useNotificationStream } from '@/hooks/useNotificationStream'
import { useTheme } from '@/hooks/useTheme'
import { useI18n } from '@/hooks/useI18n'
import type { Dictionary } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const PAGE_TITLE_KEYS: Record<string, keyof Dictionary['nav']> = {
  '/': 'dashboard',
  '/invoices': 'invoices',
  '/invoices/upload': 'uploadInvoice',
  '/reminders': 'reminders',
  '/chat': 'aiAssistant',
  '/audit': 'auditLog',
  '/admin/users': 'userManagement',
  '/admin/vendors': 'vendors',
  '/admin/companies': 'companies',
  '/admin/reminders': 'reminderSettings',
  '/vendor/profile': 'companyProfile',
}

interface Notification {
  id: string
  title: string
  body: string
  type: string
  isRead: boolean
  createdAt: string
}

// Liquid icon-button pill — translucent hover, ambient primary glow.
const iconBtn =
  'rounded-full text-muted-foreground hover:bg-(--glass-bg-strong) hover:text-foreground hover:shadow-[0_0_14px_-6px_var(--glow-primary)] dark:hover:bg-(--glass-bg-strong) transition-colors'

// Accent dot per notification type — token tints where the theme defines them,
// fixed hues for the amber/orange reminder family (theme-independent semantics).
const NOTIF_DOTS: Record<string, string> = {
  invoice_submitted: 'bg-secondary shadow-[0_0_8px_var(--glow-teal)]',
  revision_requested: 'bg-primary shadow-[0_0_8px_var(--glow-primary)]',
  status_changed: 'bg-primary/70 shadow-[0_0_8px_var(--glow-primary)]',
  due_soon: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]',
  overdue: 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.45)]',
}

export function TopBar() {
  const { data: session } = useSession()
  const { unreadCount, clearUnread } = useNotificationStream()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const { t, locale, toggle: toggleLocale } = useI18n()

  useEffect(() => {
    if (open) {
      fetch('/api/notifications?unread=true')
        .then(r => r.json())
        .then(data => setNotifications(Array.isArray(data) ? data.slice(0, 5) : []))
        .catch(() => {})
    }
  }, [open])

  const markAllRead = async () => {
    const res = await fetch('/api/notifications', { method: 'PATCH' })
    if (!res.ok) return
    setNotifications([])
    clearUnread()
  }

  const roleColors: Record<string, string> = {
    ADMIN:      'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
    GA_STAFF:   'border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300',
    GA_MANAGER: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    VENDOR:     'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  }

  const role = (session?.user as { role?: string })?.role
  const pathname = usePathname()
  const { theme, toggle, mounted } = useTheme()
  const titleKey = Object.entries(PAGE_TITLE_KEYS)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([path]) => pathname === path || pathname.startsWith(path + '/'))?.[1]
  const pageTitle = titleKey ? t.nav[titleKey] : t.nav.brand

  return (
    <header className="glass-panel sticky top-0 z-20 flex h-14 items-center gap-3 border-x-0 border-t-0 px-4">
      <MobileSidebar />

      <p className="lg:hidden text-sm font-semibold text-foreground truncate flex-1">{pageTitle}</p>
      <div className="hidden lg:block flex-1" />

      {/* Language Toggle */}
      <Button
        variant="ghost"
        size="icon"
        aria-label={t.topbar.switchLanguage}
        onClick={toggleLocale}
        className={`${iconBtn} gap-1`}
      >
        <Languages className="h-5 w-5" />
        <span className="text-[10px] font-bold uppercase text-primary">{locale}</span>
      </Button>

      {/* Theme Toggle */}
      {mounted && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={theme === 'light' ? t.topbar.switchToDark : t.topbar.switchToLight}
          onClick={toggle}
          className={iconBtn}
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </Button>
      )}

      {/* Notification Bell */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label={unreadCount > 0 ? t.topbar.unreadNotifications.replace('{count}', String(unreadCount)) : t.topbar.notifications} className={`relative inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:bg-(--glass-bg-strong) hover:text-foreground hover:shadow-[0_0_14px_-6px_var(--glow-primary)] transition-colors`}>
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            // ring-background keeps the red dot crisp against the translucent glass
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold ring-2 ring-background shadow-[0_0_10px_rgba(239,68,68,0.6)]">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="glass-panel-strong bg-transparent w-80 gap-0 overflow-hidden rounded-2xl p-0 ring-0 shadow-[inset_0_1px_0_0_var(--glass-highlight),var(--glass-shadow)]">
          <div className="flex items-center justify-between border-b border-(--glass-border) px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{t.topbar.notifications}</p>
            {notifications.length > 0 && (
              <button onClick={markAllRead} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20">
                {t.topbar.markAllRead}
              </button>
            )}
          </div>
          <div className="liquid-scrollbar max-h-64 overflow-y-auto p-2">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Bell className="h-5 w-5 opacity-40" />
                <p className="text-sm">{t.topbar.noNewNotifications}</p>
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id} className="mb-1.5 rounded-2xl border border-(--glass-border) bg-(--glass-bg)/60 px-3 py-2.5 transition-all last:mb-0 hover:border-primary/20 hover:bg-(--glass-bg-strong) hover:shadow-[0_0_18px_-6px_var(--glow-primary)]">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${NOTIF_DOTS[n.type] ?? 'bg-muted-foreground/40'}`} />
                    <p className="truncate text-xs font-semibold text-foreground">{n.title}</p>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{n.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-(--glass-border) px-4 py-2">
            <Link href="/reminders" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10">
              {t.topbar.viewAll}
            </Link>
          </div>
        </PopoverContent>
      </Popover>

      {/* User */}
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${role ? roleColors[role] : 'border-(--glass-border) bg-(--glass-bg-strong) text-muted-foreground'}`}>
          <User className="h-3 w-3" />
          <span className="hidden sm:inline">{session?.user?.name?.split(' ')[0]}</span>
          <span className="sm:hidden">{role}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label={t.topbar.logout} onClick={() => signOut({ callbackUrl: '/login' })} className={iconBtn}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
