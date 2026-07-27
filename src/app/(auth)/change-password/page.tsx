'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/hooks/useI18n'

export default function ChangePasswordPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const { t } = useI18n()
  const mustChange = (session?.user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error(t.changePassword.mismatch)
      return
    }
    if (newPassword.length < 8) {
      toast.error(t.changePassword.tooShort)
      return
    }
    setSaving(true)
    const res = await fetch('/api/users/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(t.changePassword.changed)
      await update() // refresh JWT so middleware's mustChangePassword gate clears
      router.push('/')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.changePassword.changeFailed)
    }
  }

  return (
    <div className="max-w-sm mx-auto space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-3">
          <KeyRound className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {mustChange ? t.changePassword.setNewPassword : t.changePassword.changePassword}
        </h1>
        {mustChange && (
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            {t.changePassword.tempPasswordNote}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-800 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t.changePassword.currentPassword}</label>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t.changePassword.newPassword}</label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t.changePassword.confirmPassword}</label>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <Button type="submit" className="w-full" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
          {saving ? t.changePassword.submitting : t.changePassword.submit}
        </Button>
      </form>
    </div>
  )
}
