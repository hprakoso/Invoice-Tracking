import type { Role } from '@prisma/client'

declare module 'next-auth' {
  interface User {
    role: Role
    vendorId?: string | null
    mustChangePassword?: boolean
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
      vendorId: string | null
      mustChangePassword: boolean
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: Role
    vendorId: string | null
    mustChangePassword: boolean
  }
}
