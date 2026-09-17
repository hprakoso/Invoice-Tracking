'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/hooks/useI18n'

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  vendorId: string | null
  isActive: boolean
}

const ROLES = ['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']

export default function AdminUsersPage() {
  const { t } = useI18n()
  const [users, setUsers] = useState<UserRow[]>([])
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'GA_STAFF', vendorId: '' })
  const [saving, setSaving] = useState(false)

  const fetchUsers = () =>
    fetch('/api/users').then(r => r.json()).then((d: unknown) => setUsers(Array.isArray(d) ? d : []))

  useEffect(() => {
    Promise.all([
      fetchUsers(),
      fetch('/api/vendors').then(r => r.json()).then((d: unknown) => setVendors(Array.isArray(d) ? d : [])),
    ]).finally(() => setLoading(false))
  }, [])

  async function updateRole(id: string, role: string) {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      toast.success(t.userManagement.roleUpdated)
      fetchUsers()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.userManagement.roleUpdateFailed)
    }
  }

  async function toggleActive(user: UserRow) {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.isActive }),
    })
    if (res.ok) {
      toast.success(user.isActive ? t.userManagement.userDeactivated : t.userManagement.userReactivated)
      fetchUsers()
    } else {
      toast.error(t.userManagement.updateFailed)
    }
  }

  // Vendors cannot change their own login email or rotate their own password —
  // both are enforced server-side — so the admin is the only path for either.
  // The password set here is always temporary: the API re-arms the account's
  // forced change, so no admin ends up holding a live credential.
  async function patchCredential(user: UserRow, body: Record<string, string>, successMsg: string, failMsg: string) {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      toast.success(successMsg)
      fetchUsers()
      return
    }
    const data = await res.json().catch(() => ({}))
    toast.error(res.status === 409 ? t.userManagement.emailInUse : (data.error ?? failMsg))
  }

  function resetPassword(user: UserRow) {
    const next = window.prompt(t.userManagement.newPasswordPrompt.replace('{name}', user.name))
    if (next === null) return
    if (next.length < 8) {
      toast.error(t.userManagement.passwordTooShort)
      return
    }
    void patchCredential(
      user,
      { password: next },
      t.userManagement.passwordReset.replace('{name}', user.name),
      t.userManagement.passwordResetFailed,
    )
  }

  function changeEmail(user: UserRow) {
    const next = window.prompt(t.userManagement.newEmailPrompt.replace('{name}', user.name), user.email)
    if (next === null) return
    const trimmed = next.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error(t.userManagement.invalidEmail)
      return
    }
    if (trimmed === user.email) return
    void patchCredential(
      user,
      { email: trimmed },
      t.userManagement.emailChanged,
      t.userManagement.emailChangeFailed,
    )
  }

  async function createUser() {
    setSaving(true)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, vendorId: form.role === 'VENDOR' ? form.vendorId || null : null }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(t.userManagement.userCreated)
      setShowCreate(false)
      setForm({ name: '', email: '', role: 'GA_STAFF', vendorId: '' })
      fetchUsers()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? data.details?.join(', ') ?? t.userManagement.userCreateFailed)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.nav.userManagement}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.userManagement.userCount.replace('{count}', String(users.length))}</p>
        </div>
        <Button className="gap-2" onClick={() => setShowCreate(v => !v)}>
          <Plus className="h-4 w-4" /> {t.userManagement.newUser}
        </Button>
      </div>

      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder={t.userManagement.namePlaceholder} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input placeholder={t.userManagement.emailPlaceholder} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <select
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.role === 'VENDOR' && (
              <select
                value={form.vendorId}
                onChange={e => setForm({ ...form, vendorId: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t.userManagement.selectVendor}</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
          </div>
          {/* No password input: POST /api/users issues the initial credential
              server-side and mails it to the new user. */}
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.userManagement.initialPasswordNotice}</p>
          <Button onClick={createUser} disabled={saving || !form.name || !form.email || (form.role === 'VENDOR' && !form.vendorId)}>
            {t.userManagement.createUser}
          </Button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.userManagement.colName}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.userManagement.colEmail}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.userManagement.colRole}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.userManagement.colActive}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.userManagement.credentialsColumn}</th>
              </tr>
            </thead>
            <tbody>
              {!loading && users.map(u => (
                <tr key={u.id} className="border-b dark:border-gray-700 last:border-0">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={e => updateRole(u.id, e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(u)}
                      className={`text-xs font-medium px-2 py-1 rounded-full transition-colors ${
                        u.isActive
                          ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {u.isActive ? t.userManagement.active : t.userManagement.inactive}
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button onClick={() => resetPassword(u)} className="text-xs text-blue-600 hover:underline">
                      {t.userManagement.resetPassword}
                    </button>
                    <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
                    <button onClick={() => changeEmail(u)} className="text-xs text-blue-600 hover:underline">
                      {t.userManagement.changeEmail}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
