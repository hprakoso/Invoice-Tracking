# Architecture

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16.2.7 (App Router) + React 19.2.4 | Full-stack: UI + API routes in one app |
| Language | TypeScript (strict) | `avoid any`, `type`/`interface` per `memory.md` conventions |
| Styling | Tailwind CSS v4 + shadcn/ui | Dark mode via `@custom-variant dark` |
| Animation | Framer Motion | Respects `prefers-reduced-motion` |
| Charts | recharts | Status donut, aging bar |
| Auth | NextAuth v5 (Credentials provider, JWT sessions) | bcrypt (cost 12) password hashing |
| ORM | Prisma 7.8.0 + `@prisma/adapter-pg` | Explicit `pg.Pool` (see [DATABASE.md](./DATABASE.md#connection--ssl)) |
| Database | PostgreSQL 16 | Local via Docker Compose, port **5433** on host. Was `pgvector/pgvector:pg16`; downgraded to plain `postgres:16` — no `vector` column has ever existed in the schema (chat uses a structured `query_invoices` tool instead, see below) |
| AI | Gemini (`@google/genai`) | Single model does both OCR (vision, reads the uploaded file directly) and chat (function calling against `query_invoices`) — no separate service process |
| Email | Resend (`resend`) | Reminder/notification emails; no-ops silently if `RESEND_API_KEY` isn't configured |
| Background jobs | Vercel Cron → `GET /api/cron/reminders` | Daily due-date reminder scan (Hobby plan cap; see `docs/PRODUCTION_PLAN.md` §4.2) |
| Testing | Vitest + @testing-library/react | `npm test` |
| Excel export | exceljs | Dashboard KPI + invoice list, generated on demand, not persisted |
| File storage | Supabase Storage (`@supabase/supabase-js`) | Falls back to local disk (`uploads/invoices/`) when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` aren't set — local disk doesn't survive Vercel's serverless filesystem, so a real deployment needs Supabase configured |

## Service topology

```
Browser
  │
  ▼
Next.js app (localhost:3000)
  ├─ React UI (App Router, RSC by default, 'use client' where needed)
  ├─ API routes  src/app/api/**  ──────► PostgreSQL (Prisma, port 5433)
  ├─ NextAuth (JWT session, role + vendorId in token)
  ├─ GET /api/cron/reminders (Vercel Cron, CRON_SECRET-guarded, daily)
  ├─ Gemini (@google/genai) ── OCR extraction (src/lib/services/geminiExtraction.ts)
  │                        └── chat + query_invoices tool (src/lib/services/geminiChat.ts)
  ├─ Supabase Storage ── file upload/serve (src/lib/services/fileService.ts, falls back to local disk)
  └─ Resend ── reminder/notification emails (src/lib/services/email.ts, no-ops without RESEND_API_KEY)
```

Everything runs inside the single Next.js app — no separate backend process. Gemini, Supabase, and Resend are all called directly from API routes via their SDKs, not proxied through an internal service.

## Request flows

### Upload wizard (company/vendor → file → OCR → review → submit)
`src/app/(dashboard)/invoices/upload/page.tsx`, a single-page wizard driven by a `stage` state machine (`select → drop → uploading → ocr → review → done`):

0. **`select`** — the user picks the bill-to `Company` and (for non-`VENDOR` roles) the `Vendor` sending the invoice, *before* any file exists. No auto-selection of "the first vendor in the list" — that was a real bug where GA Staff/Admin uploads could get attributed to the wrong vendor.
1. `POST /api/invoices/[id]/upload` — validates MIME type + magic bytes + 10MB limit, saves file via `saveUploadedFile()` (Supabase Storage, or local disk if unconfigured). Status is untouched (still `DRAFT` from creation — see lifecycle below).
2. Client opens `GET /api/invoices/[id]/ocr` (SSE stream, rate-limited 5 req/min/user).
3. Route reads `Invoice.filePath`, fetches the file bytes via `getFileBuffer()`, and calls `extractInvoiceFields()` (`src/lib/services/geminiExtraction.ts`) — a single Gemini vision call reads the PDF/image directly (no separate OCR text-extraction step) and returns structured JSON (`responseSchema`-enforced) with a per-field `{value, confidence}`.
4. Route streams each field back to the client as an SSE `field` event (300ms stagger, drives the animated reveal UI), then persists parsed fields to `Invoice` + replaces `InvoiceItem` rows. Status stays `DRAFT` regardless of outcome — the client's review step (`PATCH /api/invoices/[id]`) is what commits corrected data and transitions to `SUBMITTED`.
5. **OCR failure fallback**: if the SSE stream emits an `error` event or the connection itself drops (`EventSource.onerror`) before any field was extracted, the wizard still advances to `review` — it populates the 8 standard fields as empty, manually-editable inputs (same keys the server would have sent) instead of rendering a blank form, with a red banner explaining OCR failed. The uploaded file is never lost; only the AI extraction step failed, so the user finishes the invoice by typing the values in themselves.

### Invoice status lifecycle
No in-app approval workflow — that used to be a 2-step GA_MANAGER→FINANCE sign-off (`ApprovalWorkflow` model, `/api/approvals/**`), removed because payment execution happens outside the app (no payment gateway integration — `PAID` is a system record of an outcome, not an in-app transaction). The current lifecycle:

0. `POST /api/invoices` creates the row as `status = DRAFT` — the upload wizard needs an invoice ID to attach the file/OCR to before the user has confirmed anything. `DRAFT` invoices are invisible everywhere else: excluded from `GET /api/invoices`, dashboard stats/KPIs, Excel export, the `query_invoices` chat tool, and reminder scans — they're not a "real" invoice yet, just wizard-in-progress state. `VALID_TRANSITIONS.DRAFT = [SUBMITTED, CANCELLED]`.
1. The user (any role that can upload) finishes the wizard and confirms → `PATCH /api/invoices/[id]` with `status: SUBMITTED`. This is the moment `invoice_submitted` notifications/emails fire (only when the confirming user is `VENDOR` — see § Invoice-event notifications), not at the earlier `DRAFT` creation.
2. `GA_STAFF` physically receives the hardcopy and forwards it to whoever settles it — **outside the app**. In-app, GA_STAFF records `deliveredDate` + becomes/reassigns the `pic` (person in charge) via `PATCH /api/invoices/[id]`, with a hard rule: `deliveredDate` can never predate `sendDate` (`validateDeliveryDates()` in `src/lib/validations.ts`, enforced client- and server-side).
3. Once the external outcome is known, `GA_STAFF`, `GA_MANAGER`, or `ADMIN` updates the invoice's status via the same `PATCH` route to one of: `PAID`, `CANCELLED`, `REJECTED`, `VOID` (all terminal), or `REVISION` (needs correction). Marking `PAID` additionally records `paidDate`/`paidAmount` (defaulting to now/`totalAmount`) and server-assigns `paidById` — see [DATABASE.md](./DATABASE.md#invoices).
4. `REVISION` loops back: the `VENDOR` (owner) or `GA_STAFF`/`GA_MANAGER` fixes the core fields and resubmits, `status → SUBMITTED`.

`VALID_TRANSITIONS` (`src/lib/validations.ts`): `DRAFT → {SUBMITTED, CANCELLED}`, `SUBMITTED → {PAID, CANCELLED, REJECTED, VOID, REVISION}`, `REVISION → {SUBMITTED}`, all others terminal. `ADMIN` bypasses this table for corrections. Every status change writes an `AuditLog` row (`action: 'invoice.status_changed'`, `metadata: { from, to, comment }`).

**Role model (4 roles):** `ADMIN`, `GA_STAFF`, `GA_MANAGER`, `VENDOR` — `MANAGER`, `FINANCE`, and `VIEWER` were removed (see `docs/PRODUCTION_PLAN.md` §4.9); their responsibilities were redistributed to `GA_STAFF`/`GA_MANAGER`. `GA_MANAGER` is **no longer deprecated** — it now carries the same operational permissions as `GA_STAFF` (create/upload/status invoices, mark invoices paid) plus supervisory-only access to the audit log and AI chat.

### Chatbot (query_invoices tool)
`POST /api/chat` (rate-limited 10 req/min/user, **`ADMIN`/`GA_MANAGER` only**) calls `runChat()` (`src/lib/services/geminiChat.ts`) directly. Gemini is given a `query_invoices` function declaration (filters: status, vendorName, companyName, overdueOnly, due date range, limit) and is instructed to call it for anything involving real invoice data rather than guessing. When it does, the route executes an actual Prisma query — scoped to nothing beyond the route's own `ADMIN`/`GA_MANAGER`-only gate, since the user's explicit requirement is that chat can query **any** invoice regardless of status, not just `PAID` — and returns matched invoices plus a server-computed `totalMatched`/`sumTotalAmount` (so aggregate questions stay accurate even when there are more matches than the returned list). The result is fed back to Gemini as a `FunctionResponse` for a second turn that produces the final answer.

### Reminders
`checkDueDates()` in `src/lib/services/reminderScheduler.ts`, invoked by `GET /api/cron/reminders` on a schedule declared in `vercel.json` (daily — Vercel Hobby caps cron at once/day, see `docs/PRODUCTION_PLAN.md` §4.2). Previously ran hourly in-process via `node-cron` (`src/instrumentation.ts`) — removed because a long-lived scheduler doesn't survive Vercel's serverless scale-to-zero. Scans invoices with status `SUBMITTED`/`REVISION` (the two "open" statuses) due within N days (`due_soon`) or already past due (`overdue`); creates `Notification` rows (deduplicated per 24h window) when `inAppEnabled`, and sends one summary email via Resend when `emailEnabled` — the two channels are gated independently, not tied together.

Thresholds, recipients, and per-channel toggles for all four notification types (`due_soon`, `overdue`, `invoice_submitted`, `revision_requested`) are **admin-editable**, not hardcoded — `ReminderSetting` rows, managed at `/admin/reminders` (`docs/API.md#reminder-settings`). `invoice_submitted` (vendor creates an invoice) and `revision_requested` (status → `REVISION`, always to the invoice's own vendor) fire inline from the invoice routes rather than the cron scan — see `docs/API.md#invoice-event-notifications`. Email delivery no-ops silently everywhere if `RESEND_API_KEY` isn't set.

### Dashboard filters and Excel export
`GET /api/dashboard` and `GET /api/dashboard/export` share `buildDashboardFilter()` (`src/lib/services/dashboardStats.ts`) — both read the same query params (`search`, `status`, `vendorId`, `companyId`, `from`/`to`) into one `Prisma.InvoiceWhereInput`, so the dashboard's KPI cards/charts/table and the Excel export always reflect the identical filtered view, never two different numbers for "the same" filter. The Dashboard page (`src/app/(dashboard)/page.tsx`) is a client component with its own filter bar, matching `/invoices`'s pattern — this also removed the page's previous server-side self-fetch to its own `/api/dashboard` (built from `process.env.NEXTAUTH_URL`), which was the root cause of a real `ECONNREFUSED` bug on first Vercel deploy when that env var was misconfigured.

`GET /api/dashboard/export` builds an `.xlsx` workbook on demand with `exceljs`: a "KPI Summary" sheet (same numbers as the Dashboard cards) and an "Invoices" sheet (matching the active filters). Streamed directly in the response, nothing persisted to disk.

### Language toggle (i18n)
`src/lib/i18n/id.ts`/`en.ts` — two flat dictionaries with an identical key shape (`Dictionary` type derived from `id.ts`, widened to `string` leaves so `en.ts`'s different literal values still type-check; a test in `src/lib/i18n/__tests__/dictionaries.test.ts` asserts the two have exactly the same key set and no empty values). `I18nProvider`/`useI18n()` (`src/hooks/useI18n.tsx`) is a React Context — unlike `useTheme` (which has no Context and relies on each component independently reading `localStorage` + mutating `document.documentElement`'s class), the toggle needs every consumer across the tree to re-render with the new language the instant it's clicked, which only a shared Context can do. Mounted once at the root layout (`src/app/layout.tsx`), so it covers both the `(auth)` and `(dashboard)` route groups. Defaults to `id`, persists the choice to `localStorage` (`locale` key), toggled via a button in `TopBar` next to the dark-mode toggle.

Translated: login, TopBar, Sidebar, Dashboard, Invoices list, Invoice detail, the upload wizard, vendor Company Profile, Change Password, the Reminders/notification feed, the Audit Log, and the shared `StatusBadge`/`StatusDonut` components. **Not yet translated** (still English-only, no crash — just doesn't respond to the toggle): the four `/admin/*` management pages (users, vendors, companies, reminder settings) and the AI chat page. Notification `title`/`body` text stored in `notifications` rows (e.g. "Invoice X perlu diperiksa") is **not** retroactively translated by the toggle either — it's historical data written in whatever language it was created in, same as audit log metadata, not live UI chrome.

## Folder structure

```
src/
├── app/
│   ├── (auth)/login/page.tsx        # Public login page
│   ├── (dashboard)/                 # Protected layout (sidebar + topbar)
│   │   ├── page.tsx                 # Dashboard (KPIs, charts, Excel export link)
│   │   ├── invoices/                # List, upload, [id] detail (status update, delivery/PIC)
│   │   ├── admin/users/              # Admin-only user management (create, edit role)
│   │   ├── admin/companies/          # ADMIN/GA_STAFF-only bill-to company management
│   │   ├── chat/                    # AI chatbot
│   │   ├── reminders/                # Notification feed
│   │   └── audit/                   # Audit log
│   └── api/                         # Next.js API routes — see docs/API.md
├── components/
│   ├── ui/                          # shadcn/ui primitives
│   ├── invoice/, dashboard/, chat/, layout/
├── hooks/                           # useTheme, useI18n (I18nProvider), useCountUp, useNotificationStream
├── lib/
│   ├── i18n/                         # id.ts/en.ts dictionaries, Dictionary type, dictionaries map
│   ├── db/prisma.ts                 # Prisma client singleton (explicit pg.Pool + SSL)
│   ├── auth/                        # NextAuth config, authorize logic, RBAC helpers
│   ├── services/                    # fileService (Supabase Storage/local disk), geminiExtraction, geminiChat, email (Resend), reminderScheduler, dashboardStats
│   ├── validations.ts               # Zod schemas + status-transition state machine
│   └── rate-limit.ts                # In-memory sliding-window limiter
├── types/                           # Shared TS types, NextAuth session augmentation
└── middleware.ts                    # NextAuth route protection (Edge runtime); excludes /api/cron/**; redirects to /change-password while mustChangePassword

prisma/
├── schema.prisma                    # 9 models — see docs/DATABASE.md
├── migrations/
└── seed.ts                          # Demo data (guarded against NODE_ENV=production)

```

## Known architectural limitations (demo MVP)

- **File storage falls back to local disk when Supabase isn't configured** — `uploads/invoices/`, which doesn't survive Vercel's serverless filesystem. Set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for any multi-instance or serverless deployment.
- **Synchronous OCR** — no job queue; the Gemini vision call blocks the SSE request for up to 60s (enforced timeout).
- **Gemini/Resend calls are unauthenticated to the outside world by design** — they're outbound HTTPS calls to Google/Resend's own APIs using a server-side API key, not a separate internal service to secure.
