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
| File storage | Supabase Storage (`@supabase/supabase-js`) | Keyed `{invoiceId}/{documentId}.{ext}` — several documents per invoice (see `invoice_documents`). Falls back to local disk (`uploads/invoices/`) when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` aren't set — local disk doesn't survive Vercel's serverless filesystem, so a real deployment needs Supabase configured |

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
1. `POST /api/invoices/[id]/upload` (with `primary=true`) — validates MIME type + magic bytes + 10MB limit, saves the file via `saveUploadedFile()` (Supabase Storage, or local disk if unconfigured) at `{invoiceId}/{documentId}.{ext}`, and creates an `InvoiceDocument` row. Status is untouched (still `RECEIVED` from creation — see lifecycle below).
2. Client opens `GET /api/invoices/[id]/ocr` (SSE stream, rate-limited 5 req/min/user).
3. Route reads `Invoice.filePath`, fetches the file bytes via `getFileBuffer()`, and calls `extractInvoiceFields()` (`src/lib/services/geminiExtraction.ts`) — a single Gemini vision call reads the PDF/image directly (no separate OCR text-extraction step) and returns structured JSON (`responseSchema`-enforced) with a per-field `{value, confidence}`.
4. Route streams each field back to the client as an SSE `field` event (300ms stagger, drives the animated reveal UI), then persists parsed fields to `Invoice` + replaces `InvoiceItem` rows. Status stays `RECEIVED` regardless of outcome — the client's review step (`PATCH /api/invoices/[id]`) is what commits corrected data and advances the status.
5. **Supporting documents** — on the review step the user attaches the tax invoice (faktur pajak), BAST, and anything else, each posted to the same upload route without `primary`. Those go through `classifyDocument()` (a cheap classify-only Gemini call, rather than running the full invoice-extraction schema against a document that has no invoice fields) and land as additional `InvoiceDocument` rows with an AI-assigned type. Every row gets a type dropdown in the UI — see § Document classification below.
6. **OCR failure fallback**: if the SSE stream emits an `error` event or the connection itself drops (`EventSource.onerror`) before any field was extracted, the wizard still advances to `review` — it populates the 8 standard fields as empty, manually-editable inputs (same keys the server would have sent) instead of rendering a blank form, with a red banner explaining OCR failed. The uploaded file is never lost; only the AI extraction step failed, so the user finishes the invoice by typing the values in themselves.

### Document classification
An invoice submission carries several documents (invoice, tax invoice / faktur pajak, BAST, supporting files), and the business requirement is explicit that misclassifying them is unacceptable. Three layers, in order of how much they're relied on:

1. **Classification** — the primary document's type falls out of the OCR extraction call for free (`document_type` was added to its response schema), so it costs no extra request. Supporting documents use `classifyDocument()`, a separate minimal-schema call, because running the full invoice-extraction schema against a BAST would spend tokens extracting fields that don't exist. Both share one prompt describing the four types, including how a Faktur Pajak (NSFP number, DJP references) differs from a commercial invoice.
2. **Confidence floor** — `normalizeClassification()` forces the type to `OTHER` below 70% confidence or for any value outside the enum. A wrong specific label is worse than an honest "Other", and the prompt tells the model the same thing.
3. **Manual override** — the real guarantee. Every document, at any confidence, carries a type dropdown in both the upload wizard and the invoice detail page (`PATCH /api/invoices/[id]/documents/[documentId]`). Setting it by hand clears `classification_confidence`, so the UI stops showing a human decision as an AI guess. Layers 1–2 reduce how often a human has to intervene; they are not what makes the outcome correct.

Classification failures are swallowed — a Gemini outage or missing API key leaves the document as `OTHER` rather than failing the upload. Losing a user's file over a labelling problem would be the worse trade.

### Invoice status lifecycle
No in-app approval workflow — that used to be a 2-step GA_MANAGER→FINANCE sign-off (`ApprovalWorkflow` model, `/api/approvals/**`), removed because payment execution happens outside the app (no payment gateway integration — `PAID` is a system record of an outcome, not an in-app transaction). As of the 2026-09-01 status overhaul (migration `20260901000000_status_and_stage_overhaul`), `InvoiceStatus` is a 17-value workflow modeled on the "Smart Invoice Payment" business requirement doc, minus its PR/PO/Advance-related states (product decision: PR/PO are assumed to already exist before an invoice reaches this system, so tracking "waiting for PO" is out of scope here).

**Main flow** (linear): `RECEIVED → REGISTERED → DOC_VERIFICATION → FINANCE_VERIFICATION → READY_FOR_PAYMENT → TREASURY_PROCESS → PAYMENT_SCHEDULED → PAID → CLOSED`.

**Exception states** (each branches off one specific main-flow state and resolves back to exactly that same state — not "return to whatever it was before"; this keeps the transition table deterministic without a `preExceptionStatus` column):

| Exception | Enters from | Resolves to |
|---|---|---|
| `DOC_INCOMPLETE` | `DOC_VERIFICATION` | `DOC_VERIFICATION` |
| `RETURNED_TO_VENDOR` | `DOC_VERIFICATION` | `REGISTERED` |
| `WAITING_TAX_DOCUMENT` | `DOC_VERIFICATION` | `DOC_VERIFICATION` |
| `WAITING_USER_CONFIRMATION` | `FINANCE_VERIFICATION` | `FINANCE_VERIFICATION` |
| `WAITING_APPROVAL` | `READY_FOR_PAYMENT` | `READY_FOR_PAYMENT` |
| `PAYMENT_HOLD` | `TREASURY_PROCESS`, `PAYMENT_SCHEDULED` | `TREASURY_PROCESS` |
| `VENDOR_BANK_ISSUE` | `TREASURY_PROCESS`, `PAYMENT_SCHEDULED` | `TREASURY_PROCESS` |
| `REJECTED` (terminal) | most pre-payment states (see `VALID_TRANSITIONS`) | — |

**Flow:**
0. `POST /api/invoices` creates the row as `status = RECEIVED`, `pic_stage = GA` — the upload wizard needs an invoice ID to attach the file/OCR to. Unlike the old `DRAFT` status (removed in this overhaul), `RECEIVED` invoices are **not** hidden from lists/dashboard/reminders — there is currently no "invisible until confirmed" concept (a known gap: a user abandoning the wizard mid-upload leaves a real, visible `RECEIVED` invoice behind). The related *orphaned duplicate on retry* bug was fixed on 2026-09-02 — the wizard reuses the row a failed attempt created rather than re-POSTing — but a genuinely abandoned session still leaves one row behind.
1. `GA_STAFF`/`GA_MANAGER`/`ADMIN` advances the invoice through `REGISTERED → DOC_VERIFICATION → FINANCE_VERIFICATION → READY_FOR_PAYMENT → TREASURY_PROCESS → PAYMENT_SCHEDULED` via `PATCH /api/invoices/[id]` (`status: <next>`), routing through exception states as needed. `deliveredDate` + `pic` (person in charge, independent of `pic_stage`) are recorded the same way, with `deliveredDate` never predating `sendDate` (`validateDeliveryDates()`).
2. `PAYMENT_SCHEDULED → PAID` is the one valid entry into `PAID` — this additionally records `paidDate`/`paidAmount` (defaulting to now/`totalAmount`) and server-assigns `paidById`. `PAID → CLOSED` is the only edge out of `PAID`. See [DATABASE.md](./DATABASE.md#invoices).

`VALID_TRANSITIONS` (`src/lib/invoiceStatus.ts` — pure, no `next/server` import, so both API routes and client components can import it directly; `src/lib/validations.ts` re-exports it for existing server-side importers) encodes the full graph above. `ADMIN` bypasses this table for corrections. Every status change writes an `AuditLog` row (`action: 'invoice.status_changed'`, `metadata: { from, to, comment }`).

**`pic_stage`** (`GA/BUDGET/PROC_LEGAL/SSU/TREASURY`) is a separate dimension from `status` — *who currently holds the invoice* vs. *where it is in the workflow*. Changed via `PATCH /api/invoices/[id]/stage`, independent of the status control; every change appends an `InvoiceStageHistory` row (see [DATABASE.md](./DATABASE.md#invoice_stage_history)), which is the source for the invoice detail page's per-stage duration ("SLA timeline") display.

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

Translated: login, TopBar, Sidebar, Dashboard, Invoices list, Invoice detail, the upload wizard, vendor Company Profile, Change Password, the Reminders/notification feed, the Audit Log, the AI chat page, the four `/admin/*` management pages (users, vendors, companies, reminder settings), and the shared `StatusBadge`/`PICStageBadge` components. Notification `title`/`body` text stored in `notifications` rows (e.g. "Invoice X perlu diperiksa") is **not** retroactively translated by the toggle either — it's historical data written in whatever language it was created in, same as audit log metadata, not live UI chrome.

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
