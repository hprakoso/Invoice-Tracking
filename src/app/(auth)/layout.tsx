import { auth } from '@/lib/auth/auth'
import { SessionProvider } from 'next-auth/react'
import { Toaster } from 'sonner'
import { AuthThemeReset } from '@/components/auth/AuthThemeReset'

// Shared shell for /login and /change-password. The root layout ships
// <html class="dark"> (the app is dark-first), but auth pages must render
// light with no dark flash — the inline script below strips the class
// before the first paint. AuthThemeReset repeats that on soft navigations
// and re-applies the stored theme on unmount so entering the dashboard
// never inherits a stale light page.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <SessionProvider session={session}>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.remove('dark');`,
        }}
      />
      <AuthThemeReset />
      {children}
      <Toaster richColors position="top-right" />
    </SessionProvider>
  )
}
