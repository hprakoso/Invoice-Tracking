'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, BadgeCheck, Droplets, Eye, EyeOff, FileText, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()

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

  const fade = (y: number, delay: number) => ({
    initial: { opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: 'easeOut' as const, delay },
  })

  return (
    <main className="relative flex min-h-screen flex-col bg-background lg:flex-row lg:overflow-hidden">
      {/* Brand panel — hidden on mobile, where the card's brand block takes over */}
      <section className="auth-brand relative hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:overflow-hidden lg:p-12 xl:p-16">
        <div aria-hidden="true" className="auth-dots absolute inset-0" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-20 -left-24 h-96 w-96 rounded-full bg-teal-400/25 blur-[100px] mix-blend-screen" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-[28rem] w-[28rem] rounded-full bg-violet-500/40 blur-[120px] mix-blend-screen" />

        <motion.div {...fade(16, 0.05)} className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-white/10 shadow-[0_0_28px_rgba(255,255,255,0.12)] backdrop-blur">
            <Droplets className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-bold tracking-[0.3em] text-white/90">{t.nav.brand}</span>
        </motion.div>

        <motion.div {...fade(24, 0.12)}>
          <h2 className="max-w-md text-3xl font-bold leading-[1.15] tracking-tight text-white xl:text-4xl">
            {t.nav.brandTagline}
          </h2>
          {/* Liquid invoice pipeline — upload → review → paid */}
          <div aria-hidden="true" className="mt-10 flex items-center gap-3 xl:mt-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] backdrop-blur">
              <FileText className="h-6 w-6 text-teal-200" />
            </div>
            <div className="relative h-px w-12 flex-1 bg-white/25 xl:w-16">
              <span className="auth-flow-dot" />
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] backdrop-blur">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div className="relative h-px w-12 flex-1 bg-white/25 xl:w-16">
              <span className="auth-flow-dot" style={{ animationDelay: '-1.6s' }} />
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] backdrop-blur">
              <BadgeCheck className="h-6 w-6 text-violet-200" />
            </div>
          </div>
        </motion.div>

        <motion.div {...fade(16, 0.2)} aria-hidden="true" className="flex items-center gap-3">
          <span className="h-1 w-16 rounded-full bg-white/35 backdrop-blur" />
          <span className="h-1 w-8 rounded-full bg-white/25 backdrop-blur" />
          <span className="h-1 w-4 rounded-full bg-white/15 backdrop-blur" />
        </motion.div>
      </section>

      {/* Form panel */}
      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/70 via-transparent to-muted/50" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 h-80 w-80 rounded-full bg-violet-300/40 blur-[100px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-20 h-96 w-96 rounded-full bg-teal-200/40 blur-[110px]" />

        <motion.div
          {...fade(16, 0.08)}
          className="glass-panel-strong relative w-full max-w-md overflow-hidden rounded-[28px] p-8 sm:p-10"
        >
          {/* Glass top-edge highlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[var(--glass-highlight)] to-transparent"
          />

          {/* Brand */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] border border-primary/30 bg-primary/15 shadow-[0_0_44px_var(--glow-primary)]">
              <Droplets className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.nav.brand}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t.login.tagline}</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground/90">
                {t.login.email}
              </label>
              <div className="relative">
                <Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/70" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t.login.emailPlaceholder}
                  className="glass-field h-12 w-full rounded-full pl-12 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground/90">
                {t.login.password}
              </label>
              <div className="relative">
                <Lock aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/70" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="glass-field h-12 w-full rounded-full pl-12 pr-12 text-sm text-foreground placeholder:text-muted-foreground/60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-liquid flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t.login.submitting : t.login.submit}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </motion.div>
      </section>
    </main>
  )
}
