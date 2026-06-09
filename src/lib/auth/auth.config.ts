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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role: Role }).role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
      }
      return session
    },
  },
  providers: [],
}
