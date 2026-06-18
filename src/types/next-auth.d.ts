import type { Role } from '@prisma/client'

declare module 'next-auth' {
  interface User {
    role: Role
    vendorId?: string | null
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
      vendorId: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: Role
    vendorId: string | null
  }
}
