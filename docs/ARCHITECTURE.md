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
| Database | PostgreSQL 16 | Local via Docker Compose, port **5433** on host. Was `pgvector/pgvector:pg16`; downgraded to plain `postgres:16` — no `vector` column ever existed in the schema, and chat is being rebuilt onto a structured `query_invoices` tool (`docs/PRODUCTION_PLAN.md` §5.2) rather than vector search |
| AI service | Python FastAPI (separate process) | OCR extraction + RAG chatbot |
| OCR | Tesseract + PyMuPDF/pdf2image | Indonesian + English |
| LLM orchestration | LangChain (LCEL) | Provider-agnostic via `LLM_PROVIDER` |
| Background jobs | Vercel Cron → `GET /api/cron/reminders` | Daily due-date reminder scan (Hobby plan cap; see `docs/PRODUCTION_PLAN.md` §4.2) |
| Testing | Vitest + @testing-library/react | `npm test` |
| Excel export | exceljs | Dashboard KPI + invoice list, generated on demand, not persisted |
| File storage | Local disk (`uploads/invoices/`) | Not available on Vercel (see limitation below) |

## Service topology

```
Browser
  │
  ▼
Next.js app (localhost:3000)
  ├─ React UI (App Router, RSC by default, 'use client' where needed)
  ├─ API routes  src/app/api/**  ──────► PostgreSQL (Prisma, port 5433)
  ├─ NextAuth (JWT session, role + vendorId in token)
  └─ GET /api/cron/reminders (Vercel Cron, CRON_SECRET-guarded, daily)
        │
        │ HTTP (server-to-server, no auth between them — trusted internal network)
        ▼
Python FastAPI AI service (localhost:8000)
  ├─ POST /ocr/extract  → Tesseract OCR → LangChain LLM extraction → structured JSON
  ├─ POST /chat         → LangChain LLM → natural-language answer
  └─ GET  /health
```

The Next.js app is the only thing PostgreSQL and the browser talk to directly; the AI service is a private internal dependency proxied through `src/app/api/chat/route.ts` and `src/app/api/invoices/[id]/ocr/route.ts`.

## Request flows

### OCR extraction (upload → structured data)
1. `POST /api/invoices/[id]/upload` — validates MIME type + magic bytes + 10MB limit, saves file to `uploads/invoices/`. Status is untouched (already `SUBMITTED` from creation).
2. Client opens `GET /api/invoices/[id]/ocr` (SSE stream, rate-limited 5 req/min/user).
3. Route reads `Invoice.filePath`, calls AI service `POST /ocr/extract` with the file path.
4. AI service: `ocr_service.py` (Tesseract text extraction) → `extraction_chain.py` (LangChain LLM call, structured JSON with per-field confidence) → response.
5. Route streams each field back to the client as an SSE `field` event (300ms stagger, drives the animated reveal UI), then persists parsed fields to `Invoice` + replaces `InvoiceItem` rows. Status stays `SUBMITTED` regardless of outcome — the client's review step (`PATCH /api/invoices/[id]`) is what commits corrected data.

### Invoice status lifecycle
No in-app approval workflow — that used to be a 2-step GA_MANAGER→FINANCE sign-off (`ApprovalWorkflow` model, `/api/approvals/**`), removed because payment execution happens outside the app (no payment gateway integration — `PAID` is a system record of an outcome, not an in-app transaction). The current lifecycle:

1. `VENDOR` or `GA_STAFF` creates/uploads an invoice → `status = SUBMITTED` (set at creation, never touched by OCR).
2. `GA_STAFF` physically receives the hardcopy and forwards it to whoever settles it — **outside the app**. In-app, GA_STAFF records `deliveredDate` + becomes/reassigns the `pic` (person in charge) via `PATCH /api/invoices/[id]`, with a hard rule: `deliveredDate` can never predate `sendDate` (`validateDeliveryDates()` in `src/lib/validations.ts`, enforced client- and server-side).
3. Once the external outcome is known, `GA_STAFF`, `GA_MANAGER`, or `ADMIN` updates the invoice's status via the same `PATCH` route to one of: `PAID`, `CANCELLED`, `REJECTED`, `VOID` (all terminal), or `REVISION` (needs correction). Marking `PAID` additionally records `paidDate`/`paidAmount` (defaulting to now/`totalAmount`) and server-assigns `paidById` — see [DATABASE.md](./DATABASE.md#invoices).
4. `REVISION` loops back: the `VENDOR` (owner) or `GA_STAFF`/`GA_MANAGER` fixes the core fields and resubmits, `status → SUBMITTED`.

`VALID_TRANSITIONS` (`src/lib/validations.ts`): `SUBMITTED → {PAID, CANCELLED, REJECTED, VOID, REVISION}`, `REVISION → {SUBMITTED}`, all others terminal. `ADMIN` bypasses this table for corrections. Every status change writes an `AuditLog` row (`action: 'invoice.status_changed'`, `metadata: { from, to, comment }`).

**Role model (4 roles):** `ADMIN`, `GA_STAFF`, `GA_MANAGER`, `VENDOR` — `MANAGER`, `FINANCE`, and `VIEWER` were removed (see `docs/PRODUCTION_PLAN.md` §4.9); their responsibilities were redistributed to `GA_STAFF`/`GA_MANAGER`. `GA_MANAGER` is **no longer deprecated** — it now carries the same operational permissions as `GA_STAFF` (create/upload/status invoices, mark invoices paid) plus supervisory-only access to the audit log and AI chat.

### Chatbot (RAG)
`POST /api/chat` (rate-limited 10 req/min/user, **`ADMIN`/`GA_MANAGER` only**) proxies to AI service `POST /chat`, which builds a prompt from a **static system context string** (not a live pgvector query — see Known Limitations in root README) plus trimmed conversation history, and calls the configured LLM. Being replaced with a `query_invoices` tool per `docs/PRODUCTION_PLAN.md` §5.2 — this section will be rewritten once that lands.

### Reminders
`checkDueDates()` in `src/lib/services/reminderScheduler.ts`, invoked by `GET /api/cron/reminders` on a schedule declared in `vercel.json` (daily — Vercel Hobby caps cron at once/day, see `docs/PRODUCTION_PLAN.md` §4.2). Previously ran hourly in-process via `node-cron` (`src/instrumentation.ts`) — removed because a long-lived scheduler doesn't survive Vercel's serverless scale-to-zero. Scans invoices with status `SUBMITTED`/`REVISION` (the two "open" statuses) due within N days (`due_soon`) or already past due (`overdue`), and creates `Notification` rows, deduplicated per 24h window.

Thresholds and recipients for all four notification types (`due_soon`, `overdue`, `invoice_submitted`, `revision_requested`) are **admin-editable**, not hardcoded — `ReminderSetting` rows, managed at `/admin/reminders` (`docs/API.md#reminder-settings`). `invoice_submitted` (vendor creates an invoice) and `revision_requested` (status → `REVISION`, always to the invoice's own vendor) fire inline from the invoice routes rather than the cron scan — see `docs/API.md#invoice-event-notifications`.

### Dashboard Excel export
`GET /api/dashboard/export` builds an `.xlsx` workbook on demand with `exceljs`: a "KPI Summary" sheet (same numbers as the Dashboard cards, computed via the shared `getDashboardStats()` helper) and an "Invoices" sheet (full invoice list, unfiltered). Streamed directly in the response, nothing persisted to disk.

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
├── hooks/                           # useTheme, useCountUp, useNotificationStream
├── lib/
│   ├── db/prisma.ts                 # Prisma client singleton (explicit pg.Pool + SSL)
│   ├── auth/                        # NextAuth config, authorize logic, RBAC helpers
│   ├── services/                    # fileService, reminderScheduler, dashboardStats
│   ├── validations.ts               # Zod schemas + status-transition state machine
│   └── rate-limit.ts                # In-memory sliding-window limiter
├── types/                           # Shared TS types, NextAuth session augmentation
└── middleware.ts                    # NextAuth route protection (Edge runtime); excludes /api/cron/**; redirects to /change-password while mustChangePassword

prisma/
├── schema.prisma                    # 9 models — see docs/DATABASE.md
├── migrations/
└── seed.ts                          # Demo data (guarded against NODE_ENV=production)

ai-service/                          # Python FastAPI, independent deployable
├── main.py                          # App entry, CORS, router registration
├── app/api/{ocr,chat}.py            # Route handlers
├── app/services/                    # ocr_service, extraction_chain, chat_service
└── app/models/schemas.py            # Pydantic request/response models
```

## Known architectural limitations (demo MVP)

- **Local disk file storage** — `uploads/invoices/`; the file-serving route (`/api/invoices/[id]/file`) explicitly 503s when `process.env.VERCEL === '1'`. Needs S3/equivalent for any multi-instance or serverless deployment.
- **Synchronous OCR** — no job queue; long-running Tesseract/LLM calls block the SSE request for up to 60s (enforced timeout).
- **Chatbot is not live-RAG** — pgvector is provisioned but the chat endpoint answers from a static context string, not a per-query vector search over the invoices table.
- **No auth between Next.js and the AI service** — internal network is assumed trusted; do not expose port 8000 publicly.
