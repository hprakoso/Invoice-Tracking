'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const DEMO_ACCOUNTS = [
  { email: 'admin@demo.com', role: 'Admin', color: 'bg-red-100 text-red-700' },
  { email: 'manager@demo.com', role: 'Manager', color: 'bg-blue-100 text-blue-700' },
  { email: 'finance@demo.com', role: 'Finance', color: 'bg-green-100 text-green-700' },
  { email: 'viewer@demo.com', role: 'Viewer', color: 'bg-gray-100 text-gray-700' },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError('Email atau password salah.')
    } else {
      router.push('/')
      router.refresh()
    }
  }

  async function quickLogin(accountEmail: string) {
    setLoading(true)
    setError('')
    const result = await signIn('credentials', {
      email: accountEmail,
      password: 'demo123',
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError('Login gagal.')
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Invoice Intelligence</h1>
          <p className="mt-2 text-gray-500">AI-Powered Accounts Payable System</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="email@demo.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Masuk...' : 'Masuk'}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs text-gray-400">
              <span className="bg-white px-2">Akun Demo</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map(account => (
              <button
                key={account.email}
                onClick={() => quickLogin(account.email)}
                disabled={loading}
                className={`text-xs px-3 py-2 rounded-lg font-medium transition-colors hover:opacity-80 disabled:opacity-50 ${account.color}`}
              >
                {account.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
