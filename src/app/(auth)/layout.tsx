import { auth } from '@/lib/auth/auth'
import { SessionProvider } from 'next-auth/react'
import { Toaster } from 'sonner'

// Bare layout, no Sidebar/TopBar — shared by /login and /change-password.
// The latter needs useSession() client-side (to read mustChangePassword) and
// toast() (sonner), so this fetches the session server-side same as the
// dashboard layout does and mounts its own Toaster, just without the auth
// redirect (login itself must render when logged out).
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <SessionProvider session={session}>
      {children}
      <Toaster richColors position="top-right" />
    </SessionProvider>
  )
}
