import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { requireRole } from '@/lib/auth/helpers'
import { createUserSchema, validationErrorResponse } from '@/lib/validations'
import { sendEmail, renderEmailLayout } from '@/lib/services/email'

/**
 * The initial credential every new account is issued. Server-side only — it is
 * never sent to the browser, never returned by this route, and never logged.
 * Configurable the same way prisma/seed.ts configures DEMO_PASSWORD, so the
 * value can be changed per environment without touching code.
 *
 * A shared, known starting password is only safe because it is single-use:
 * `mustChangePassword` is set below, and src/middleware.ts redirects any role
 * holding that flag to /change-password before it can reach anything else.
 */
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD ?? 'P@ssw0rd'

export async function GET(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN', 'GA_STAFF', 'GA_MANAGER'])
  if (error || !session) return error

  const role = req.nextUrl.searchParams.get('role')

  const users = await prisma.user.findMany({
    where: role ? { role: role as never } : undefined,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true, vendorId: true, isActive: true },
  })

  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireRole(['ADMIN'])
  if (error || !session) return error

  const parsed = createUserSchema.safeParse(await req.json())
  if (!parsed.success) return validationErrorResponse(parsed.error)
  const data = parsed.data

  // Hashed here with the same bcrypt cost every other write path uses; only
  // the hash is ever persisted. The response `select` deliberately omits
  // passwordHash, so neither the credential nor its hash leaves this function.
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      role: data.role,
      vendorId: data.role === 'VENDOR' ? data.vendorId : null,
      passwordHash: await bcrypt.hash(INITIAL_PASSWORD, 12),
      // Already the column default; set explicitly so the forced first-login
      // change is visible at the point the credential is issued.
      mustChangePassword: true,
    },
    select: { id: true, name: true, email: true, role: true, vendorId: true, isActive: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    },
  })

  // Delivery is best-effort and deliberately cannot fail the request: the
  // account already exists and is usable, so throwing here would return 500 for
  // a user that was in fact created and push the admin into retrying into a
  // duplicate-email error. sendEmail is itself a no-op when RESEND_API_KEY is
  // unset; the try/catch covers a transport-level throw on top of that.
  try {
    await sendWelcomeEmail(user.email, user.name)
  } catch (e) {
    console.error('Welcome email failed for a newly created user:', e instanceof Error ? e.message : e)
  }

  return NextResponse.json(user, { status: 201 })
}

async function sendWelcomeEmail(email: string, name: string) {
  await sendEmail(
    [email],
    'Akun Invoice Tracking Anda telah dibuat',
    renderEmailLayout({
      heading: `Selamat datang, ${name}`,
      bodyHtml:
        `<p style="margin:0 0 12px;">Akun Invoice Tracking Anda sudah aktif.</p>` +
        `<p style="margin:0 0 12px;">Email: <strong>${email}</strong><br/>` +
        `Password awal: <strong>${INITIAL_PASSWORD}</strong></p>` +
        `<p style="margin:0;">Demi keamanan, Anda akan diminta mengganti password ini saat pertama kali masuk.</p>`,
      ctaText: 'Masuk ke Invoice Tracking',
      ctaPath: '/login',
    }),
  )
}
