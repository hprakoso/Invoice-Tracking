'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Trash2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useI18n } from '@/hooks/useI18n'

interface VendorContact {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
}

interface VendorDetail {
  id: string
  name: string
  npwp: string | null
  contactName: string | null
  contactEmail: string | null
  bankName: string | null
  bankAccount: string | null
  address: string | null
  city: string | null
  phone: string | null
  bankAccountHolder: string | null
  bankBranch: string | null
  contacts: VendorContact[]
}

export default function VendorProfilePage() {
  const { data: session } = useSession()
  const { t } = useI18n()
  const vendorId = (session?.user as { vendorId?: string | null } | undefined)?.vendorId
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    contactName: '', contactEmail: '', bankName: '', bankAccount: '',
    address: '', city: '', phone: '', bankAccountHolder: '', bankBranch: '',
  })
  const [saving, setSaving] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '', role: '' })

  const load = async () => {
    if (!vendorId) { setLoading(false); return }
    const res = await fetch(`/api/vendors/${vendorId}`)
    if (res.ok) {
      const data: VendorDetail = await res.json()
      setVendor(data)
      setForm({
        contactName: data.contactName ?? '',
        contactEmail: data.contactEmail ?? '',
        bankName: data.bankName ?? '',
        bankAccount: data.bankAccount ?? '',
        address: data.address ?? '',
        city: data.city ?? '',
        phone: data.phone ?? '',
        bankAccountHolder: data.bankAccountHolder ?? '',
        bankBranch: data.bankBranch ?? '',
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets a loading flag before its async fetch
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId])

  function validate(): string | null {
    if (!form.contactName.trim()) return t.vendorProfile.contactNameRequired
    if (!form.contactEmail.trim()) return t.vendorProfile.contactEmailRequired
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) return t.vendorProfile.contactEmailInvalid
    return null
  }

  async function save() {
    if (!vendorId) return
    const validationError = validate()
    if (validationError) {
      toast.error(validationError)
      return
    }
    setSaving(true)
    const res = await fetch(`/api/vendors/${vendorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(t.vendorProfile.profileUpdated)
      load()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? t.vendorProfile.updateFailed)
    }
  }

  async function addContact() {
    if (!vendorId || !newContact.name) return
    const res = await fetch(`/api/vendors/${vendorId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newContact),
    })
    if (res.ok) {
      const created = await res.json()
      setVendor((prev) => (prev ? { ...prev, contacts: [...prev.contacts, created] } : prev))
      setNewContact({ name: '', email: '', phone: '', role: '' })
    } else {
      toast.error(t.vendorProfile.addContactFailed)
    }
  }

  async function removeContact(contactId: string) {
    if (!vendorId) return
    const res = await fetch(`/api/vendors/${vendorId}/contacts/${contactId}`, { method: 'DELETE' })
    if (res.ok) {
      setVendor((prev) => (prev ? { ...prev, contacts: prev.contacts.filter((c) => c.id !== contactId) } : prev))
    } else {
      toast.error(t.vendorProfile.removeContactFailed)
    }
  }

  if (loading) return <div className="text-sm text-gray-500">{t.common.loading}</div>
  if (!vendorId || !vendor) {
    return <div className="text-sm text-gray-500">{t.vendorProfile.notLinked}</div>
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t.vendorProfile.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.vendorProfile.subtitle}</p>
        <p className="text-xs text-gray-400 mt-1"><span className="text-red-500">*</span> {t.vendorProfile.requiredLegend}</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-4">
        <div>
          <label className="text-xs text-gray-400 flex items-center gap-1"><Lock className="h-3 w-3" /> {t.vendorProfile.companyName}</label>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{vendor.name}</p>
        </div>
        <div>
          <label className="text-xs text-gray-400 flex items-center gap-1"><Lock className="h-3 w-3" /> {t.vendorProfile.npwp}</label>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{vendor.npwp ?? '—'}</p>
        </div>
        <p className="text-xs text-gray-400">{t.vendorProfile.lockedNote}</p>

        <Separator />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.address}</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.city}</label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.phone}</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.contactName} <span className="text-red-500">*</span></label>
            <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.contactEmail} <span className="text-red-500">*</span></label>
            <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.bankName}</label>
            <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.bankAccount}</label>
            <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.bankAccountHolder}</label>
            <Input value={form.bankAccountHolder} onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t.vendorProfile.bankBranch}</label>
            <Input value={form.bankBranch} onChange={(e) => setForm({ ...form, bankBranch: e.target.value })} />
          </div>
        </div>
        <Button onClick={save} disabled={saving}>{t.vendorProfile.saveChanges}</Button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t.vendorProfile.picContacts}</p>
        <div className="space-y-1">
          {vendor.contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-1.5 border dark:border-gray-700">
              <span>{c.name} {c.role && <span className="text-gray-400">({c.role})</span>} {c.email && <span className="text-gray-400">— {c.email}</span>}</span>
              <Button variant="ghost" size="icon" onClick={() => removeContact(c.id)} aria-label="Remove contact">
                <Trash2 className="h-3.5 w-3.5 text-gray-400" />
              </Button>
            </div>
          ))}
          {vendor.contacts.length === 0 && <p className="text-xs text-gray-400">{t.vendorProfile.noContacts}</p>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Input placeholder={t.vendorProfile.namePlaceholder} value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
          <Input placeholder={t.vendorProfile.rolePlaceholder} value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
          <Input placeholder={t.vendorProfile.emailPlaceholder} value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
          <Input placeholder={t.vendorProfile.phonePlaceholder} value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
        </div>
        <Button size="sm" variant="outline" className="gap-1" onClick={addContact} disabled={!newContact.name}>
          <Plus className="h-3.5 w-3.5" /> {t.vendorProfile.addContact}
        </Button>
      </div>
    </div>
  )
}
