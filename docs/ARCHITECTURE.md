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
| Database | PostgreSQL 16 + pgvector | Local via Docker Compose, port **5434** on host |
| AI service | Python FastAPI (separate process) | OCR extraction + RAG chatbot |
| OCR | Tesseract + PyMuPDF/pdf2image | Indonesian + English |
| LLM orchestration | LangChain (LCEL) | Provider-agnostic via `LLM_PROVIDER` |
| Background jobs | node-cron | Hourly due-date reminder scan, in-process |
| Testing | Vitest + @testing-library/react | `npm test` |
| File storage | Local disk (`uploads/invoices/`) | Not available on Vercel (see limitation below) |

## Service topology

```
Browser
  │
  ▼
Next.js app (localhost:3000)
  ├─ React UI (App Router, RSC by default, 'use client' where needed)
  ├─ API routes  src/app/api/**  ──────► PostgreSQL (Prisma, port 5434)
  ├─ NextAuth (JWT session, role + vendorId in token)
  └─ node-cron reminder scheduler (in-process, started via src/instrumentation.ts)
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
1. `POST /api/invoices/[id]/upload` — validates MIME type + magic bytes + 10MB limit, saves file to `uploads/invoices/`, sets `Invoice.status = PENDING_OCR`.
2. Client opens `GET /api/invoices/[id]/ocr` (SSE stream, rate-limited 5 req/min/user).
3. Route reads `Invoice.filePath`, calls AI service `POST /ocr/extract` with the file path.
4. AI service: `ocr_service.py` (Tesseract text extraction) → `extraction_chain.py` (LangChain LLM call, structured JSON with per-field confidence) → response.
5. Route streams each field back to the client as an SSE `field` event (300ms stagger, drives the animated reveal UI), then persists parsed fields to `Invoice` + replaces `InvoiceItem` rows, sets `status = PENDING_REVIEW`.

### Approval workflow
Two-step. The first `ApprovalWorkflow` row (step 1, GA_MANAGER) is expected to already exist (created by the seed script / invoice creation flow) before `/api/approvals/[invoiceId]/approve` is first called; step 2 (FINANCE) is created by the API when step 1 is approved. See [DATABASE.md](./DATABASE.md#approval_workflows) for the state machine.

- Step 1 (`GA_MANAGER`) approves → invoice `PENDING_APPROVAL`, step-2 `ApprovalWorkflow` row created, all `FINANCE` users notified.
- Step 2 (`FINANCE`, or legacy `MANAGER`) approves → invoice `APPROVED`.
- Reject at either step → invoice `REJECTED` immediately (no further steps).
- Every transition writes an `AuditLog` row.

### Chatbot (RAG)
`POST /api/chat` (rate-limited 10 req/min/user) proxies to AI service `POST /chat`, which builds a prompt from a **static system context string** (not a live pgvector query — see Known Limitations in root README) plus trimmed conversation history, and calls the configured LLM.

### Due-date reminders
`src/lib/services/reminderScheduler.ts`, started once via `node-cron` (`0 * * * *`, plus once 5s after boot). Scans invoices with status `PENDING_APPROVAL`/`APPROVED` due within 3 days (`due_soon`) or already past due (`overdue`), and creates `Notification` rows for `FINANCE`/`GA_MANAGER` users, deduplicated per 24h window.

## Folder structure

```
src/
├── app/
│   ├── (auth)/login/page.tsx        # Public login page
│   ├── (dashboard)/                 # Protected layout (sidebar + topbar)
│   │   ├── page.tsx                 # Dashboard (KPIs, charts)
│   │   ├── invoices/                # List, upload, [id] detail
│   │   ├── approvals/               # Approval queue
│   │   ├── chat/                    # AI chatbot
│   │   ├── reminders/               # Notification feed
│   │   └── audit/                   # Audit log
│   └── api/                         # Next.js API routes — see docs/API.md
├── components/
│   ├── ui/                          # shadcn/ui primitives
│   ├── invoice/, dashboard/, approval/, chat/, layout/
├── hooks/                           # useTheme, useCountUp, useNotificationStream
├── lib/
│   ├── db/prisma.ts                 # Prisma client singleton (explicit pg.Pool + SSL)
│   ├── auth/                        # NextAuth config, authorize logic, RBAC helpers
│   ├── services/                    # fileService, reminderScheduler
│   ├── validations.ts               # Zod schemas + status-transition state machine
│   └── rate-limit.ts                # In-memory sliding-window limiter
├── types/                           # Shared TS types, NextAuth session augmentation
├── instrumentation.ts               # Boots the reminder scheduler on server start
└── middleware.ts                    # NextAuth route protection (Edge runtime)

prisma/
├── schema.prisma                    # 7 models — see docs/DATABASE.md
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
- **In-process cron** — `node-cron` runs inside the Next.js server process; on serverless/multi-instance deployments this either won't fire reliably or will fire once per instance. Fine for a single long-running Node process (e.g. VM, container), not for Vercel-style scale-to-zero.
- **No auth between Next.js and the AI service** — internal network is assumed trusted; do not expose port 8000 publicly.
