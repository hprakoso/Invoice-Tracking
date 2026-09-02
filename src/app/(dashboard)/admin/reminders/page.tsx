'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/hooks/useI18n'
import type { Dictionary } from '@/lib/i18n'

interface ReminderSetting {
  id: string
  type: string
  isActive: boolean
  daysBefore: number | null
  recipientRoles: string[]
  extraEmails: string[]
  emailEnabled: boolean
  inAppEnabled: boolean
}

type ReminderTypeKey = keyof Dictionary['reminderSettings']

const TYPE_LABELS: Record<string, { titleKey: ReminderTypeKey; descKey: ReminderTypeKey; usesRoles: boolean; usesDays: boolean }> = {
  due_soon: {
    titleKey: 'typeDueSoonTitle',
    descKey: 'typeDueSoonDesc',
    usesRoles: true,
    usesDays: true,
  },
  overdue: {
    titleKey: 'typeOverdueTitle',
    descKey: 'typeOverdueDesc',
    usesRoles: true,
    usesDays: false,
  },
  invoice_submitted: {
    titleKey: 'typeSubmittedTitle',
    descKey: 'typeSubmittedDesc',
    usesRoles: true,
    usesDays: false,
  },
  revision_requested: {
    titleKey: 'typeRevisionTitle',
    descKey: 'typeRevisionDesc',
    usesRoles: false,
    usesDays: false,
  },
  status_changed: {
    titleKey: 'typeStatusChangedTitle',
    descKey: 'typeStatusChangedDesc',
    usesRoles: false,
    usesDays: false,
  },
  // Unlike status_changed (which targets the invoice's own vendor), this one
  // notifies an internal role group — pic_stage is internal routing, never
  // shown to vendors.
  stage_assigned: {
    titleKey: 'typeStageAssignedTitle',
    descKey: 'typeStageAssignedDesc',
    usesRoles: true,
    usesDays: false,
  },
}

const ALL_ROLES = ['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']

function SettingCard({ setting, onSaved }: { setting: ReminderSetting; onSaved: () => void }) {
  const { t } = useI18n()
  const typeMeta = TYPE_LABELS[setting.type]
  const meta = typeMeta
    ? {
        title: t.reminderSettings[typeMeta.titleKey],
        description: t.reminderSettings[typeMeta.descKey],
        usesRoles: typeMeta.usesRoles,
        usesDays: typeMeta.usesDays,
      }
    : { title: setting.type, description: '', usesRoles: true, usesDays: false }
  const [isActive, setIsActive] = useState(setting.isActive)
  const [daysBefore, setDaysBefore] = useState(String(setting.daysBefore ?? 3))
  const [roles, setRoles] = useState<string[]>(setting.recipientRoles)
  const [extraEmails, setExtraEmails] = useState(setting.extraEmails.join(', '))
  const [emailEnabled, setEmailEnabled] = useState(setting.emailEnabled)
  const [inAppEnabled, setInAppEnabled] = useState(setting.inAppEnabled)
  const [saving, setSaving] = useState(false)

  function toggleRole(role: string) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/admin/reminders/${setting.type}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isActive,
        daysBefore: meta.usesDays ? Number(daysBefore) || 3 : undefined,
        recipientRoles: meta.usesRoles ? roles : undefined,
        extraEmails: extraEmails.split(',').map((e) => e.trim()).filter(Boolean),
        emailEnabled,
        inAppEnabled,
      }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(t.reminderSettings.saved)
      onSaved()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? data.details?.join(', ') ?? t.reminderSettings.saveFailed)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{meta.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{meta.description}</p>
        </div>
        <button
          onClick={() => setIsActive((v) => !v)}
          className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
            isActive
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {isActive ? t.reminderSettings.active : t.reminderSettings.inactive}
        </button>
      </div>

      {meta.usesDays && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">{t.reminderSettings.daysBeforeLabel}</label>
          <Input type="number" min={1} max={30} value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} className="w-24" />
        </div>
      )}

      {meta.usesRoles && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">{t.reminderSettings.recipientRolesLabel}</label>
          <div className="flex flex-wrap gap-2">
            {ALL_ROLES.map((role) => (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  roles.includes(role)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-transparent text-gray-500 border-gray-300 dark:border-gray-600'
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-gray-500 mb-1 block">{t.reminderSettings.extraEmailsLabel}</label>
        <Input value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)} placeholder={t.reminderSettings.extraEmailsPlaceholder} />
      </div>

      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={inAppEnabled} onChange={(e) => setInAppEnabled(e.target.checked)} />
          {t.reminderSettings.inAppNotifications}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} />
          {t.reminderSettings.sendEmail}
        </label>
      </div>

      <Button size="sm" onClick={save} disabled={saving}>{t.common.save}</Button>
    </div>
  )
}

export default function AdminRemindersPage() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<ReminderSetting[]>([])
  const [loading, setLoading] = useState(true)

  const load = () =>
    fetch('/api/admin/reminders').then((r) => r.json()).then((d: unknown) => setSettings(Array.isArray(d) ? d : []))

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.nav.reminderSettings}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-1">
          <Clock className="h-3.5 w-3.5" /> {t.reminderSettings.dailyNote}
        </p>
      </div>

      {!loading && (
        <div className="space-y-3">
          {settings.map((s) => (
            <SettingCard key={s.id} setting={s} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  )
}
