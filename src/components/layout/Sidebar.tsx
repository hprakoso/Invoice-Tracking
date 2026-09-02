'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, FileText, Upload, Users, MessageSquare,
  Bell, ClipboardList, Menu, X, Droplets, Building2, Settings, Briefcase
} from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/useI18n'
import type { Dictionary } from '@/lib/i18n'

const ALL_ROLES = ['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']

const NAV_ITEMS: { href: string; labelKey: keyof Dictionary['nav']; icon: React.ElementType; roles: string[]; indent: boolean }[] = [
  { href: '/', labelKey: 'dashboard', icon: LayoutDashboard, roles: ALL_ROLES, indent: false },
  { href: '/invoices', labelKey: 'invoices', icon: FileText, roles: ALL_ROLES, indent: false },
  { href: '/invoices/upload', labelKey: 'uploadInvoice', icon: Upload, roles: ['ADMIN', 'VENDOR', 'GA_STAFF', 'GA_MANAGER'], indent: true },
  // Notification feed is filtered server-side by userId — every role sees only their own.
  { href: '/reminders', labelKey: 'reminders', icon: Bell, roles: ALL_ROLES, indent: false },
  { href: '/chat', labelKey: 'aiAssistant', icon: MessageSquare, roles: ['ADMIN', 'GA_MANAGER'], indent: false },
  { href: '/audit', labelKey: 'auditLog', icon: ClipboardList, roles: ['ADMIN', 'GA_MANAGER'], indent: false },
  { href: '/admin/users', labelKey: 'userManagement', icon: Users, roles: ['ADMIN'], indent: false },
  { href: '/admin/vendors', labelKey: 'vendors', icon: Briefcase, roles: ['ADMIN', 'GA_STAFF', 'GA_MANAGER'], indent: false },
  { href: '/admin/companies', labelKey: 'companies', icon: Building2, roles: ['ADMIN', 'GA_STAFF'], indent: false },
  { href: '/admin/reminders', labelKey: 'reminderSettings', icon: Settings, roles: ['ADMIN'], indent: false },
  { href: '/vendor/profile', labelKey: 'companyProfile', icon: Briefcase, roles: ['VENDOR'], indent: false },
]

function NavItem({ href, label, icon: Icon, active, indent }: { href: string; label: string; icon: React.ElementType; active: boolean; indent: boolean }) {
  return (
    <Link href={href} className={indent ? 'pl-4 block' : 'block'}>
      <motion.div
        whileHover={{ x: 4 }}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium border transition-colors cursor-pointer',
          active
            ? 'bg-primary/15 text-primary border-primary/25 shadow-[0_0_24px_var(--glow-primary)]'
            : 'text-muted-foreground border-transparent hover:bg-(--glass-bg-strong) hover:text-foreground',
          indent && 'text-[13px]'
        )}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span>{label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--glow-primary)]" />}
      </motion.div>
    </Link>
  )
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string })?.role
  const { t } = useI18n()

  // Don't fall back to a role while the session is still loading — that
  // would render nav items the user may not actually be permitted to see.
  const visibleItems = status === 'authenticated' && role
    ? NAV_ITEMS.filter(item => item.roles.includes(role))
    : []

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-(--glass-border)">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 shadow-[0_0_20px_var(--glow-primary)]">
          <Droplets className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight text-foreground">{t.nav.brand}</p>
          <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{t.nav.brandTagline}</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Nav */}
      <nav className="liquid-scrollbar flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map(item => (
          <NavItem
            key={item.href}
            href={item.href}
            label={t.nav[item.labelKey]}
            icon={item.icon}
            indent={item.indent}
            active={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/') && !NAV_ITEMS.some(n => n.href !== item.href && pathname === n.href))}
          />
        ))}
      </nav>

      {/* Role badge */}
      <div className="px-4 py-3 border-t border-(--glass-border)">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-primary/25 bg-gradient-to-br from-primary/30 to-secondary/20 text-xs font-bold text-primary">
            {session?.user?.name?.charAt(0) ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground" title={session?.user?.name}>{session?.user?.name}</p>
            <p className="text-[11px] text-muted-foreground">{role}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="glass-panel hidden lg:flex lg:flex-col lg:w-56 xl:w-64 lg:fixed lg:inset-y-0 z-30 border-y-0 border-l-0 border-r">
      <SidebarContent />
    </aside>
  )
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:bg-(--glass-bg-strong) hover:text-foreground transition-colors"
        aria-label={t.nav.openMenu}
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      {/* Inline glass recipe — the sheet's base bg-popover is solid, so this
          overrides it to keep the mobile drawer translucent like the desktop one. */}
      <SheetContent
        side="left"
        className="p-0 w-72 border-r-0"
        style={{
          background: 'var(--glass-bg-strong)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
          borderRight: '1px solid var(--glass-border)',
          boxShadow: 'inset 0 1px 0 0 var(--glass-highlight), var(--glass-shadow)',
        }}
      >
        <SidebarContent onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
