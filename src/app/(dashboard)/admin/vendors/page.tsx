'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface VendorContact {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
}

interface VendorRow {
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
  isActive: boolean
  contacts?: VendorContact[]
}

const emptyCreateForm = { name: '', npwp: '', contactName: '', contactEmail: '', bankName: '', bankAccount: '' }

function VendorEditPanel({ vendor, isAdmin, onSaved }: { vendor: VendorRow; isAdmin: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: vendor.name,
    npwp: vendor.npwp ?? '',
    contactName: vendor.contactName ?? '',
    contactEmail: vendor.contactEmail ?? '',
    bankName: vendor.bankName ?? '',
    bankAccount: vendor.bankAccount ?? '',
    address: vendor.address ?? '',
    city: vendor.city ?? '',
    phone: vendor.phone ?? '',
    bankAccountHolder: vendor.bankAccountHolder ?? '',
    bankBranch: vendor.bankBranch ?? '',
  })
  const [contacts, setContacts] = useState<VendorContact[]>(vendor.contacts ?? [])
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '', role: '' })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/vendors/${vendor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      toast.success('Vendor updated')
      onSaved()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? 'Update failed')
    }
  }

  async function addContact() {
    if (!newContact.name) return
    const res = await fetch(`/api/vendors/${vendor.id}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newContact),
    })
    if (res.ok) {
      const created = await res.json()
      setContacts((prev) => [...prev, created])
      setNewContact({ name: '', email: '', phone: '', role: '' })
    } else {
      toast.error('Failed to add contact')
    }
  }

  async function removeContact(contactId: string) {
    const res = await fetch(`/api/vendors/${vendor.id}/contacts/${contactId}`, { method: 'DELETE' })
    if (res.ok) {
      setContacts((prev) => prev.filter((c) => c.id !== contactId))
    } else {
      toast.error('Failed to remove contact')
    }
  }

  return (
    <div className="px-4 py-4 bg-gray-50 dark:bg-gray-900 border-t dark:border-gray-700 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input placeholder="Vendor Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!isAdmin} />
        <Input placeholder="NPWP" value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} disabled={!isAdmin} />
        <Input placeholder="Contact Name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        <Input placeholder="Contact Email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
        <Input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <Input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input placeholder="Bank Name" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
        <Input placeholder="Bank Account Number" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
        <Input placeholder="Bank Account Holder" value={form.bankAccountHolder} onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })} />
        <Input placeholder="Bank Branch" value={form.bankBranch} onChange={(e) => setForm({ ...form, bankBranch: e.target.value })} />
      </div>
      <Button size="sm" onClick={save} disabled={saving}>Save Changes</Button>

      <div className="pt-2 border-t dark:border-gray-700">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">PIC / Contacts</p>
        <div className="space-y-1 mb-3">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm bg-white dark:bg-gray-800 rounded-md px-3 py-1.5 border dark:border-gray-700">
              <span>{c.name} {c.role && <span className="text-gray-400">({c.role})</span>} {c.email && <span className="text-gray-400">— {c.email}</span>}</span>
              <Button variant="ghost" size="icon" onClick={() => removeContact(c.id)} aria-label="Remove contact">
                <Trash2 className="h-3.5 w-3.5 text-gray-400" />
              </Button>
            </div>
          ))}
          {contacts.length === 0 && <p className="text-xs text-gray-400">No contacts yet</p>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Input placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
          <Input placeholder="Role (Finance, Sales...)" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
          <Input placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
          <Input placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
        </div>
        <Button size="sm" variant="outline" className="mt-2 gap-1" onClick={addContact} disabled={!newContact.name}>
          <Plus className="h-3.5 w-3.5" /> Add Contact
        </Button>
      </div>
    </div>
  )
}

export default function AdminVendorsPage() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string })?.role
  const isAdmin = role === 'ADMIN'
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreateForm)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchVendors = () =>
    fetch('/api/vendors').then((r) => r.json()).then((d: unknown) => setVendors(Array.isArray(d) ? d : []))

  useEffect(() => {
    fetchVendors().finally(() => setLoading(false))
  }, [])

  async function loadFullVendor(id: string) {
    const res = await fetch(`/api/vendors/${id}`)
    if (res.ok) {
      const full = await res.json()
      setVendors((prev) => prev.map((v) => (v.id === id ? full : v)))
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    await loadFullVendor(id)
    setExpandedId(id)
  }

  async function createVendor() {
    setSaving(true)
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    })
    setSaving(false)
    if (res.ok) {
      toast.success('Vendor created')
      setShowCreate(false)
      setCreateForm(emptyCreateForm)
      fetchVendors()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? data.details?.join(', ') ?? 'Failed to create vendor')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Vendors</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{vendors.length} vendors</p>
        </div>
        {isAdmin && (
          <Button className="gap-2" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" /> New Vendor
          </Button>
        )}
      </div>

      {showCreate && isAdmin && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Vendor Name (PT/CV ...)" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            <Input placeholder="NPWP" value={createForm.npwp} onChange={(e) => setCreateForm({ ...createForm, npwp: e.target.value })} />
            <Input placeholder="Contact Name" value={createForm.contactName} onChange={(e) => setCreateForm({ ...createForm, contactName: e.target.value })} />
            <Input placeholder="Contact Email" value={createForm.contactEmail} onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })} />
            <Input placeholder="Bank Name" value={createForm.bankName} onChange={(e) => setCreateForm({ ...createForm, bankName: e.target.value })} />
            <Input placeholder="Bank Account" value={createForm.bankAccount} onChange={(e) => setCreateForm({ ...createForm, bankAccount: e.target.value })} />
          </div>
          <Button onClick={createVendor} disabled={saving || !createForm.name}>Create Vendor</Button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden divide-y dark:divide-gray-700">
        {!loading && vendors.map((v) => (
          <div key={v.id}>
            <button
              onClick={() => toggleExpand(v.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{v.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{v.npwp ?? 'No NPWP'} {v.city && `· ${v.city}`}</p>
              </div>
              {expandedId === v.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {expandedId === v.id && (
              <VendorEditPanel vendor={v} isAdmin={isAdmin} onSaved={() => loadFullVendor(v.id)} />
            )}
          </div>
        ))}
        {!loading && vendors.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-gray-400">No vendors yet</p>
        )}
      </div>
    </div>
  )
}
