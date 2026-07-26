'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { dictionaries, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type Locale, type Dictionary } from '@/lib/i18n'

interface I18nContextValue {
  locale: Locale
  t: Dictionary
  toggle: () => void
  mounted: boolean
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage must happen client-side after mount to avoid an SSR/client hydration mismatch
    setMounted(true)
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'id' || stored === 'en') setLocale(stored)
  }, [])

  const toggle = () => {
    const next: Locale = locale === 'id' ? 'en' : 'id'
    setLocale(next)
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  }

  return (
    <I18nContext.Provider value={{ locale, t: dictionaries[locale], toggle, mounted }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
