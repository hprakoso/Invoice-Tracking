'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Bell,
  Clock,
  AlertTriangle,
  CheckCircle,
  CheckCheck,
  FileText,
  RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type NotifType = 'due_soon' | 'overdue' | 'approval_required' | string

interface Notification {
  id: string
  title: string
  body: string
  type: NotifType
  isRead: boolean
  createdAt: string
  invoiceId: string | null
  invoice: { invoiceNumber: string } | null
}

type FilterTab = 'all' | 'unread' | 'due_soon' | 'overdue'

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  due_soon: {
    icon: <Clock className="h-4 w-4" />,
    color: 'bg-yellow-100 text-yellow-600',
    label: 'Segera Jatuh Tempo',
  },
  overdue: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'bg-red-100 text-red-600',
    label: 'Terlambat',
  },
  approval_required: {
    icon: <FileText className="h-4 w-4" />,
    color: 'bg-blue-100 text-blue-600',
    label: 'Perlu Persetujuan',
  },
}

function getTypeMeta(type: string) {
  return (
    TYPE_META[type] ?? {
      icon: <Bell className="h-4 w-4" />,
      color: 'bg-gray-100 text-gray-600',
      label: 'Notifikasi',
    }
  )
}

import { timeAgo } from '@/lib/format'

function ReminderCard({
  notif,
  onRead,
}: {
  notif: Notification
  onRead: (id: string) => void
}) {
  const meta = getTypeMeta(notif.type)

  const markRead = async () => {
    const res = await fetch(`/api/notifications/${notif.id}/read`, { method: 'PATCH' })
    if (res.ok) onRead(notif.id)
  }

  return (
    <div
      className={`flex gap-4 items-start rounded-xl border dark:border-gray-700 px-5 py-4 transition-all ${
        notif.isRead ? 'bg-white dark:bg-gray-800 opacity-70' : 'bg-white dark:bg-gray-800 shadow-sm'
      }`}
    >
      {/* Type icon */}
      <div
        className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center ${meta.color}`}
      >
        {meta.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p
              className={`text-sm leading-snug ${
                notif.isRead ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100 font-semibold'
              }`}
            >
              {notif.title}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{notif.body}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {timeAgo(notif.createdAt)}
            </span>
            {!notif.isRead && (
              <span className="h-2 w-2 rounded-full bg-blue-500" />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}
          >
            {meta.icon}
            {meta.label}
          </span>
          {notif.invoice && notif.invoiceId && (
            <Link
              href={`/invoices/${notif.invoiceId}`}
              className="text-xs text-blue-600 hover:underline font-mono"
            >
              {notif.invoice.invoiceNumber}
            </Link>
          )}
          {!notif.isRead && (
            <button
              onClick={markRead}
              className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Tandai dibaca
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'unread', label: 'Belum Dibaca' },
  { id: 'due_soon', label: 'Segera Jatuh Tempo' },
  { id: 'overdue', label: 'Terlambat' },
]

export default function RemindersPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((data) => {
        setNotifications(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    )
  }

  const markAllRead = async () => {
    const res = await fetch('/api/notifications', { method: 'PATCH' })
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      toast.success('Semua notifikasi ditandai dibaca')
    }
  }

  const filtered = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.isRead
    if (activeTab === 'due_soon') return n.type === 'due_soon'
    if (activeTab === 'overdue') return n.type === 'overdue'
    return true
  })

  const unreadCount = notifications.filter((n) => !n.isRead).length

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Notifikasi &amp; Pengingat</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Pantau jatuh tempo invoice dan status persetujuan
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button size="sm" onClick={markAllRead} className="gap-1.5">
              <CheckCheck className="h-3.5 w-3.5" />
              Tandai Semua Dibaca
            </Button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-xl p-1 flex-wrap">
        {TABS.map((tab) => {
          const count =
            tab.id === 'all'
              ? notifications.length
              : tab.id === 'unread'
              ? unreadCount
              : notifications.filter((n) => n.type === tab.id).length

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-fit px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.id
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Bell className="h-12 w-12 mb-3 text-gray-200" />
          <p className="text-base font-medium text-gray-500">
            {activeTab === 'unread'
              ? 'Tidak ada notifikasi yang belum dibaca'
              : 'Tidak ada notifikasi'}
          </p>
          <p className="text-sm mt-1">
            {activeTab === 'unread'
              ? 'Semua sudah dibaca. Kerja bagus!'
              : 'Notifikasi akan muncul di sini'}
          </p>
        </div>
      ) : (
        <motion.div layout className="space-y-3">
          <AnimatePresence initial={false}>
            {filtered.map((notif) => (
              <motion.div
                key={notif.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ReminderCard notif={notif} onRead={handleRead} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Summary footer */}
      {!loading && notifications.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center pb-4">
          {notifications.length} total notifikasi · {unreadCount} belum dibaca
        </p>
      )}
    </div>
  )
}
