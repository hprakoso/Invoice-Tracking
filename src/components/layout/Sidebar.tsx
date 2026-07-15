'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, FileText, Upload, Users, MessageSquare,
  Bell, ClipboardList, Menu, X, FileStack, ChevronRight
} from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'GA_STAFF', 'GA_MANAGER', 'FINANCE', 'VIEWER', 'VENDOR'], indent: false },
  { href: '/invoices', label: 'Invoices', icon: FileText, roles: ['ADMIN', 'MANAGER', 'GA_STAFF', 'GA_MANAGER', 'FINANCE', 'VIEWER', 'VENDOR'], indent: false },
  { href: '/invoices/upload', label: 'Upload Invoice', icon: Upload, roles: ['ADMIN', 'FINANCE', 'VENDOR', 'GA_STAFF'], indent: true },
  { href: '/reminders', label: 'Reminders', icon: Bell, roles: ['ADMIN', 'MANAGER', 'GA_MANAGER', 'FINANCE'], indent: false },
  { href: '/chat', label: 'AI Assistant', icon: MessageSquare, roles: ['ADMIN', 'MANAGER', 'GA_STAFF', 'GA_MANAGER', 'FINANCE', 'VIEWER'], indent: false },
  { href: '/audit', label: 'Audit Log', icon: ClipboardList, roles: ['ADMIN', 'MANAGER', 'GA_MANAGER', 'FINANCE'], indent: false },
  { href: '/admin/users', label: 'User Management', icon: Users, roles: ['ADMIN'], indent: false },
]

function NavItem({ href, label, icon: Icon, active, indent }: { href: string; label: string; icon: React.ElementType; active: boolean; indent: boolean }) {
  return (
    <Link href={href} className={indent ? 'pl-4 block' : 'block'}>
      <motion.div
        whileHover={{ x: 4 }}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
          active
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
          indent && 'text-[13px]'
        )}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span>{label}</span>
        {active && <ChevronRight className="h-3 w-3 ml-auto" />}
      </motion.div>
    </Link>
  )
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = (session?.user as { role?: string })?.role ?? 'VIEWER'

  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(role))

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b dark:border-gray-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <FileStack className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">Invoice Intelligence</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">AI-Powered AP System</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map(item => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            indent={item.indent}
            active={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/') && !NAV_ITEMS.some(n => n.href !== item.href && pathname === n.href))}
          />
        ))}
      </nav>

      {/* Role badge */}
      <div className="px-4 py-3 border-t dark:border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300">
            {session?.user?.name?.charAt(0) ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate" title={session?.user?.name}>{session?.user?.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{role}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-56 xl:w-64 lg:fixed lg:inset-y-0 border-r dark:border-gray-800 bg-white dark:bg-gray-900 z-30">
      <SidebarContent />
    </aside>
  )
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64">
        <SidebarContent onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
