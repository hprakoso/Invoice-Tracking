'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  vendorId: string | null
  isActive: boolean
}

const ROLES = ['ADMIN', 'MANAGER', 'FINANCE', 'VIEWER', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'VIEWER', vendorId: '', password: '' })
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
      toast.success('Role updated')
      fetchUsers()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? 'Failed to update role')
    }
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
      toast.success('User created')
      setShowCreate(false)
      setForm({ name: '', email: '', role: 'VIEWER', vendorId: '', password: '' })
      fetchUsers()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? data.details?.join(', ') ?? 'Failed to create user')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">User Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{users.length} users</p>
        </div>
        <Button className="gap-2" onClick={() => setShowCreate(v => !v)}>
          <Plus className="h-4 w-4" /> New User
        </Button>
      </div>

      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
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
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            <Input placeholder="Initial password (min 8 chars)" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <Button onClick={createUser} disabled={saving || !form.name || !form.email || form.password.length < 8}>
            Create User
          </Button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Email</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">Active</th>
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
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
