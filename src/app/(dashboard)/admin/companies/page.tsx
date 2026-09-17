'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/hooks/useI18n'

interface CompanyRow {
  id: string
  name: string
  npwp: string | null
  address: string | null
  city: string | null
  email: string | null
  isActive: boolean
}

const emptyForm = { name: '', npwp: '', address: '', city: '', email: '' }

export default function AdminCompaniesPage() {
  const { t } = useI18n()
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  // null = the form is creating; an id = it is editing that company. One form
  // and one state object serve both, so the fields can't drift apart.
  const [editingId, setEditingId] = useState<string | null>(null)

  const fetchCompanies = () =>
    fetch('/api/companies?includeInactive=true').then(r => r.json()).then((d: unknown) => setCompanies(Array.isArray(d) ? d : []))

  useEffect(() => {
    fetchCompanies().finally(() => setLoading(false))
  }, [])

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function startEdit(company: CompanyRow) {
    setEditingId(company.id)
    setForm({
      name: company.name,
      npwp: company.npwp ?? '',
      address: company.address ?? '',
      city: company.city ?? '',
      email: company.email ?? '',
    })
    setShowForm(true)
  }

  // Create and edit hit the same fields, so they share one submit path:
  // POST /api/companies when creating, PATCH /api/companies/[id] when editing.
  // Both routes already existed and already validate with
  // createCompanySchema / updateCompanySchema — only the UI was missing.
  async function saveCompany() {
    setSaving(true)
    const payload = {
      name: form.name,
      npwp: form.npwp || null,
      address: form.address || null,
      city: form.city || null,
      email: form.email || null,
    }
    const res = await fetch(editingId ? `/api/companies/${editingId}` : '/api/companies', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(editingId ? t.companies.companyUpdated : t.companies.companyCreated)
      closeForm()
      fetchCompanies()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(
        data.error ??
          data.details?.join(', ') ??
          (editingId ? t.companies.updateFailed : t.companies.companyCreateFailed),
      )
    }
  }

  async function toggleActive(company: CompanyRow) {
    const res = await fetch(`/api/companies/${company.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !company.isActive }),
    })
    if (res.ok) {
      toast.success(company.isActive ? t.companies.companyDeactivated : t.companies.companyReactivated)
      fetchCompanies()
    } else {
      toast.error(t.companies.updateFailed)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.nav.companies}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.companies.countSubtitle.replace('{count}', String(companies.length))}</p>
        </div>
        <Button className="gap-2" onClick={() => (showForm && !editingId ? closeForm() : startCreate())}>
          <Plus className="h-4 w-4" /> {t.companies.newCompany}
        </Button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {editingId ? t.companies.editCompany : t.companies.newCompany}
            </p>
            <Button variant="ghost" size="icon" onClick={closeForm} aria-label={t.common.cancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder={t.companies.companyNamePlaceholder} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input placeholder={t.companies.colNpwp} value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} />
            <Input placeholder={t.vendorProfile.address} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            <Input placeholder={t.vendorProfile.city} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
            <Input placeholder={t.companies.billingEmail} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveCompany} disabled={saving || !form.name}>
              {editingId ? t.common.save : t.companies.createCompany}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={closeForm} disabled={saving}>
                {t.common.cancel}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.companies.colName}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.companies.colNpwp}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.companies.colCity}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.companies.colEmail}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium">{t.companies.colActive}</th>
                <th className="w-20 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {!loading && companies.map(c => (
                <tr key={c.id} className={`border-b dark:border-gray-700 last:border-0 ${!c.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.npwp ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.city ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.isActive ? t.common.yes : t.common.no}</td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(c)} aria-label={t.common.edit}>
                        <Pencil className="h-4 w-4 text-gray-400" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => toggleActive(c)} aria-label={c.isActive ? t.companies.deactivate : t.companies.reactivate}>
                        <Trash2 className="h-4 w-4 text-gray-400" />
                      </Button>
                    </div>
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
