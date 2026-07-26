import type { NextAuthConfig } from 'next-auth'
import type { Role } from '@prisma/client'

// Edge-safe config — no Node.js modules, no Prisma, no crypto.
// Used by middleware (Edge Runtime). The full authorize logic lives in auth.ts.
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    // This is the Edge-safe config middleware runs — it decodes the same JWT
    // auth.ts's full callbacks wrote at sign-in, but its own session callback
    // only forwards the fields middleware actually needs to branch on
    // (mustChangePassword, for the forced-reset redirect below).
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role: Role }).role
        token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
        session.user.mustChangePassword = token.mustChangePassword as boolean
      }
      return session
    },
  },
  providers: [],
}
