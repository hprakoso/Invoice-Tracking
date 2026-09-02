'use client'

import { useEffect } from 'react'

// Auth routes are forced light: the layout's pre-paint script strips the dark
// class for the first paint, and this component repeats it on soft navigations
// (inline scripts don't re-run there). On unmount it restores the stored
// dashboard theme so the app never inherits a stale light class after leaving.
export function AuthThemeReset() {
  useEffect(() => {
    document.documentElement.classList.remove('dark')
    return () => {
      const stored = localStorage.getItem('theme')
      if (stored === 'light') document.documentElement.classList.remove('dark')
      else document.documentElement.classList.add('dark')
    }
  }, [])
  return null
}
