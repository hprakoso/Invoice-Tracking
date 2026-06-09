import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { Toaster } from 'sonner'
import { PageTransition } from '@/components/layout/PageTransition'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <SessionProvider session={session}>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
        <Sidebar />
        <div className="flex flex-col flex-1 lg:pl-56 xl:pl-64 min-w-0">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </SessionProvider>
  )
}
