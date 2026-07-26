# Setup & Local Development

## Prerequisites

- Node.js 18+
- Docker Desktop (for PostgreSQL)

That's it for local dev — Supabase Storage, Gemini, and Resend are optional; without them the app falls back to local-disk file storage, and OCR/chat/email calls no-op gracefully (see below).

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Create `.env.local` in the project root:

```env
DATABASE_URL="postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo"
NEXTAUTH_SECRET="any-random-string-at-least-32-chars"
NEXTAUTH_URL="http://localhost:3000"
CRON_SECRET="any-random-string"  # required to call GET /api/cron/reminders locally; Vercel sets this automatically in production

# Optional — see docs/API.md for what each powers. Omit any of these and the
# corresponding feature degrades gracefully (local disk / no-op / friendly error)
# instead of failing.
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_API_KEY=
GEMINI_MODEL="gemini-2.5-flash"   # optional override
RESEND_API_KEY=
RESEND_FROM_EMAIL="Invoice Tracking <onboarding@resend.dev>"
```

See `.env.example` for the same list with inline comments. Never commit real values — `.env*` is gitignored except `.env.example`.

> Host port is **5433**, not the Postgres default 5432 — see `docker-compose.yml` and commit `a56ffcd` (changed to avoid clashing with a locally installed Postgres).

## 3. Start the database

```bash
docker-compose up -d
```

## 4. Run migrations and seed demo data

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

Creates all tables, 6 demo user accounts, demo vendors/companies, and demo invoices across every status. The seed script refuses to run when `NODE_ENV=production`.

## 5. Start the app

```bash
npm run dev
```

Open http://localhost:3000. That's the whole stack — there's no separate service to start; OCR, chat, file storage, and email are all called directly from Next.js API routes.

## Optional: enabling OCR, chat, storage, and email

Each is independent — enable any subset:

- **Supabase Storage** — create a Supabase project, add a private bucket named `invoices`, set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Without these, uploaded files are written to `uploads/invoices/` on local disk (fine for local dev, doesn't work on Vercel).
- **Gemini (OCR + chat)** — get a `GOOGLE_API_KEY` from [Google AI Studio](https://aistudio.google.com/) (free tier available). Without it, OCR returns a clear SSE `error` event and the chatbot replies with a friendly "not available" message — neither crashes.
- **Resend (email)** — get a `RESEND_API_KEY` from resend.dev, verify a sending domain (or use their `onboarding@resend.dev` test sender for local testing, which only delivers to the account owner's own address). Without it, reminder/notification emails silently no-op — in-app notifications still work.

## Demo accounts

All demo accounts use password `demo123` (bcrypt-hashed, cost 12).

| Email | Role | Notes |
|---|---|---|
| `admin@demo.com` | ADMIN | Full access, including audit log, chat, and role/company/reminder management |
| `gastaff@demo.com` | GA_STAFF | Create/upload/status invoices, record delivery + PIC, mark paid |
| `gastaff2@demo.com` | GA_STAFF | Second GA Staff account, for PIC-reassignment demos |
| `gamanager@demo.com` | GA_MANAGER | Same operational permissions as GA_STAFF, plus audit log and AI chat access |
| `vendor1@demo.com` | VENDOR | PT Maju Jaya Abadi — sees only own invoices |
| `vendor2@demo.com` | VENDOR | CV Teknologi Nusantara — sees only own invoices |

## Commands reference

```bash
npm run dev          # Next.js dev server
npm run build         # Production build (prisma generate && next build on Vercel — see vercel.json)
npm start              # Serve production build
npm test               # Vitest run (unit + component tests)
npm run test:watch    # Vitest watch mode
npm run lint            # ESLint
npm run db:seed        # Re-run prisma/seed.ts
```

## Troubleshooting

**OCR fails with "GOOGLE_API_KEY is not configured"**
- Set `GOOGLE_API_KEY` in `.env.local` and restart `npm run dev` (env vars are read at process start).
- Inspect the response of `/api/invoices/[id]/ocr` in the browser network tab (SSE stream) for the exact `error` event message.

**Uploaded files disappear / 404 on `/api/invoices/[id]/file`**
- Without Supabase configured, files live in `uploads/invoices/` on local disk — confirm the file exists there. On Vercel this directory doesn't persist between requests; you need `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set for deployed environments.

**Database connection issues**
- `docker-compose ps` — confirm the `db` container is healthy
- Confirm `DATABASE_URL` in `.env.local` points at port **5433**
- `psql "$DATABASE_URL" -c "SELECT 1"`

**Supabase / hosted Postgres SSL errors**
- Do not rely on `sslmode=require` in the connection string — it is stripped. Set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` instead. See [DATABASE.md](./DATABASE.md#connection--ssl).

**NextAuth session issues**
- Verify `NEXTAUTH_SECRET` is set in `.env.local`
- Check `src/middleware.ts` for route-protection logic
- Inspect the `authjs.session-token` cookie in DevTools → Application → Cookies

**Rate limited (429) on OCR or chat**
- OCR: 5 requests/min/user. Chat: 10 requests/min/user. Wait for the `Retry-After` window (`src/lib/rate-limit.ts`, in-memory — resets on server restart).

## Deployment note

`vercel.json` sets a 30s max duration for API routes (60s for OCR) and runs `prisma generate && next build`. For a real Vercel deployment set: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (file storage — local disk doesn't persist on Vercel), `GOOGLE_API_KEY` (OCR + chat), `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (reminder emails), and a hosted Postgres `DATABASE_URL` (e.g. Supabase) with `DATABASE_SSL_REJECT_UNAUTHORIZED` configured per the note above. See branches `deploy/option-a` / `deploy/option-b` for prior deployment attempts.
