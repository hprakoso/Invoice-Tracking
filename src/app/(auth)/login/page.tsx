'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileStack } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import type { Dictionary } from '@/lib/i18n'

const DEMO_ACCOUNTS: { email: string; roleKey: keyof Dictionary['login']; color: string }[] = [
  { email: 'vendor1@demo.com',   roleKey: 'roleVendor1',   color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { email: 'vendor2@demo.com',   roleKey: 'roleVendor2',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { email: 'gastaff@demo.com',   roleKey: 'roleGaStaff',   color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  { email: 'gamanager@demo.com', roleKey: 'roleGaManager', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  { email: 'admin@demo.com',     roleKey: 'roleAdmin',     color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { t } = useI18n()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (result?.error) {
      setError(t.login.invalidCredentials)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  async function quickLogin(accountEmail: string) {
    setLoading(true)
    setError('')
    const result = await signIn('credentials', { email: accountEmail, password: 'demo123', redirect: false })
    setLoading(false)
    if (result?.error) {
      setError(t.login.quickLoginFailed)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4 shadow-lg shadow-blue-600/20">
            <FileStack className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.nav.brand}</h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{t.login.tagline}</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-5">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t.login.email}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition"
                placeholder={t.login.emailPlaceholder}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t.login.password}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2.5 rounded-lg font-medium transition-colors shadow-sm"
            >
              {loading ? t.login.submitting : t.login.submit}
            </button>
          </form>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs text-gray-400 dark:text-gray-500">
              <span className="bg-white dark:bg-gray-900 px-2">{t.login.demoAccounts}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map(account => (
              <button
                key={account.email}
                onClick={() => quickLogin(account.email)}
                disabled={loading}
                className={`text-xs px-3 py-2 rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${account.color}`}
              >
                {t.login[account.roleKey]}
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            {t.login.demoPasswordNote} <span className="font-mono font-medium">demo123</span>
          </p>
        </div>
      </div>
    </div>
  )
}
