'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Upload,
  CheckCircle,
  XCircle,
  Eye,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface AuditLog {
  id: string
  action: string
  entityType: string
  entityId: string
  createdAt: string
  metadata: Record<string, unknown> | null
  user: { name: string; role: string } | null
}

interface AuditResponse {
  logs: AuditLog[]
  total: number
  page: number
  pages: number
}

const ACTION_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  'invoice.created': {
    icon: <Upload className="h-3.5 w-3.5" />,
    color: 'bg-blue-100 text-blue-600',
    label: 'Invoice Dibuat',
  },
  'invoice.uploaded': {
    icon: <Upload className="h-3.5 w-3.5" />,
    color: 'bg-blue-100 text-blue-600',
    label: 'File Diupload',
  },
  'invoice.approved_step_1': {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    color: 'bg-green-100 text-green-600',
    label: 'Disetujui Finance',
  },
  'invoice.approved_step_2': {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    color: 'bg-emerald-100 text-emerald-600',
    label: 'Disetujui Manager',
  },
  'invoice.rejected': {
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: 'bg-red-100 text-red-600',
    label: 'Ditolak',
  },
  'invoice.updated': {
    icon: <Edit className="h-3.5 w-3.5" />,
    color: 'bg-yellow-100 text-yellow-600',
    label: 'Diperbarui',
  },
  'invoice.deleted': {
    icon: <Trash2 className="h-3.5 w-3.5" />,
    color: 'bg-red-100 text-red-500',
    label: 'Dihapus',
  },
  'invoice.viewed': {
    icon: <Eye className="h-3.5 w-3.5" />,
    color: 'bg-gray-100 text-gray-500',
    label: 'Dilihat',
  },
}

function getActionMeta(action: string) {
  return (
    ACTION_META[action] ?? {
      icon: <Activity className="h-3.5 w-3.5" />,
      color: 'bg-gray-100 text-gray-500',
      label: action,
    }
  )
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  FINANCE: 'bg-green-100 text-green-700',
  VIEWER: 'bg-gray-100 text-gray-600',
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const load = useCallback(
    (p: number) => {
      setLoading(true)
      fetch(`/api/audit?page=${p}`)
        .then((r) => r.json())
        .then((d) => {
          setData(d)
          setLoading(false)
        })
        .catch(() => setLoading(false))
    },
    []
  )

  useEffect(() => {
    load(page)
  }, [load, page])

  const logs = data?.logs ?? []
  const pages = data?.pages ?? 1
  const total = data?.total ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Semua aktivitas tercatat · {total} entri
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-full">
          <Shield className="h-3.5 w-3.5" />
          Read-only
        </div>
      </div>

      {/* Log list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Activity className="h-10 w-10 mb-2 text-gray-200" />
          <p className="text-sm">Belum ada aktivitas tercatat</p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white border rounded-xl overflow-hidden divide-y"
        >
          {logs.map((log, i) => {
            const meta = getActionMeta(log.action)
            return (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div
                  className={`mt-0.5 flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center ${meta.color}`}
                >
                  {meta.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">{meta.label}</span>
                    <span className="text-xs text-gray-400 font-mono truncate max-w-[120px]">
                      {log.entityId.slice(0, 8)}…
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {log.user ? (
                      <>
                        <span className="text-xs text-gray-500">{log.user.name}</span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                            ROLE_COLORS[log.user.role] ?? 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {log.user.role}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400 italic">System</span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-gray-400 flex-shrink-0 text-right whitespace-nowrap">
                  {formatDateTime(log.createdAt)}
                </p>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Hal. {page} dari {pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="gap-1"
            >
              Berikutnya
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
