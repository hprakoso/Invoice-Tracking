# 🧾 Invoice Intelligence System

> An AI-powered Invoice Tracking & Accounts Payable Assistant — built as a demo MVP to showcase real-time OCR extraction, multi-step approval workflows, and an AI chatbot, all in a single responsive web app.

> 📚 This file is the pitch/quick-start. For architecture, database schema, API reference (with field-level data-source tracing), and setup/troubleshooting details, see [`docs/`](./docs/INDEX.md).

---

## 📌 What is this project?

This is a **full-stack invoice management system** that automates the accounts payable process from document upload to payment approval. It combines:

- **Optical Character Recognition (OCR)** — upload a PDF or image invoice and watch fields extract automatically, one by one, in real time
- **Multi-step Approval Workflow** — Finance reviews first, then escalates to Manager with a single click
- **AI Chatbot** — ask natural language questions about your invoices ("Which invoices are overdue?" / "Total tagihan bulan ini berapa?")
- **In-app Notification System** — due-date reminders and approval alerts pushed to the notification bell without email or external services
- **Audit Log** — every action (upload, approve, reject) is recorded with who did what and when

The UI is fully responsive — it works on mobile, tablet, and desktop.

---

## 👤 Who is this for?

| Role | What they can do |
|------|-----------------|
| **Admin** | Full access — all pages including audit log, AI chat, user/company/reminder management |
| **GA Manager** | Same operational permissions as GA Staff (create/upload/status invoices, mark paid), plus audit log and AI chat access |
| **GA Staff** | Create/upload/status invoices, record hardcopy delivery + PIC, mark invoices paid |
| **Vendor** | View and upload invoices for their own company only |

**Demo accounts (all password: `demo123`):**

| Email | Role |
|-------|------|
| `admin@demo.com` | Admin |
| `gastaff@demo.com` | GA Staff |
| `gastaff2@demo.com` | GA Staff |
| `gamanager@demo.com` | GA Manager |
| `vendor1@demo.com` | Vendor (PT Maju Jaya Abadi) |
| `vendor2@demo.com` | Vendor (CV Teknologi Nusantara) |

---

## 🕐 When should you use this?

This project is built as a **2-day demo MVP** — ideal for:

- Presenting an AI-powered invoice automation concept to stakeholders
- Showcasing OCR + LLM extraction in action with real documents
- Demonstrating a role-based approval workflow in a live presentation
- Using as a starting point or blueprint for a production accounts payable system

> This is **not** a production system. It uses local disk storage, hardcoded demo users, and synchronous OCR. See the Known Limitations section for what would need to change before going live.

---

## 📍 Where does it run?

Everything runs locally on your machine — no cloud account required:

| Service | Address |
|---------|---------|
| Next.js web app | `http://localhost:3000` |
| PostgreSQL database | `localhost:5433` (via Docker) |
| Uploaded files | Supabase Storage if configured, else `uploads/invoices/` (local disk) |

---

## ❓ Why was this built?

Manual invoice processing is slow, error-prone, and hard to audit. This project demonstrates how modern AI tools can:

1. **Eliminate manual data entry** — OCR + LLM extracts vendor name, invoice number, dates, line items, and tax automatically from any invoice (Indonesian or English)
2. **Enforce a consistent approval chain** — no invoice can be approved without both Finance and Manager sign-off, and every decision is logged
3. **Surface overdue risks proactively** — an hourly scheduler flags invoices approaching or past their due date before they become a problem
4. **Give finance teams a natural language interface** — instead of building complex filters, just ask the AI chatbot

OCR and chat both run on Gemini (`@google/genai`), called directly from Next.js API routes — no separate backend process.

---

## 🛠️ How do you run it?

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL)

That's it — Supabase Storage, Gemini, and Resend are optional (see Step 6 below); without them the app falls back to local-disk storage and OCR/chat/email calls degrade gracefully instead of failing.

---

### Step 1 — Clone and install dependencies

```bash
git clone <repo-url>
cd invoice-demo
npm install
```

---

### Step 2 — Configure environment variables

Create a `.env.local` file in the project root:

```env
DATABASE_URL="postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo"
NEXTAUTH_SECRET="any-random-string-at-least-32-chars"
NEXTAUTH_URL="http://localhost:3000"
```

See `.env.example` for the optional Supabase/Gemini/Resend variables (Step 6).

---

### Step 3 — Start the database

```bash
docker-compose up -d
```

---

### Step 4 — Run database migrations and seed demo data

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

  This creates all tables, populates 20 demo invoices across all statuses, and creates the 6 demo user accounts.

---

### Step 5 — Start the Next.js app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with any demo account.

---

### Step 6 — Enable OCR, chat, storage, and email *(optional)*

Add to `.env.local` — each is independent, enable any subset (see `.env.example`):

```env
# OCR + chat — get a free-tier key at https://aistudio.google.com/
GOOGLE_API_KEY=your_google_api_key

# File storage — create a Supabase project + a private "invoices" bucket.
# Without these, uploads fall back to local disk (uploads/invoices/).
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Reminder/notification emails via Resend. Without this, in-app
# notifications still work — only the email side no-ops.
RESEND_API_KEY=
```

Restart `npm run dev` after changing `.env.local` — env vars are read at process start. Without any of these set, OCR returns a clear error, the chatbot replies with a friendly "not available" message, and reminder emails silently no-op — nothing crashes.

---

### Two terminals, that's it

| Terminal | Command | Result |
|----------|---------|--------|
| 1 | `docker-compose up -d` | Database on port 5433 |
| 2 | `npm run dev` | Web app on port 3000 |

---

## 🗺️ Architecture Overview

```
Browser
  └── Next.js App (localhost:3000)
        ├── React UI  (Tailwind CSS + shadcn/ui + Framer Motion)
        └── Next.js API Routes
              ├── Gemini (@google/genai)      →  OCR (vision) + chat (query_invoices tool)
              ├── Supabase Storage             →  file upload/serve (falls back to local disk)
              ├── Resend                         →  reminder/notification emails
              └── PostgreSQL (localhost:5433)
```

**Key technology choices:**

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Next.js 16 (App Router) + TypeScript | Single repo, full-stack, fast DX |
| Styling | Tailwind CSS v4 + shadcn/ui | Clean design system, zero config |
| Animations | Framer Motion | Smooth transitions with minimal code |
| Charts | recharts | React-native, responsive by default |
| Auth | NextAuth v5 | JWT sessions, role-based access |
| Database | PostgreSQL 16 | Relational data; no vector column — chat uses a `query_invoices` tool instead of RAG |
| ORM | Prisma 7 | Type-safe queries, fast schema iteration |
| AI | Gemini (`@google/genai`) | One model for OCR (vision, reads the file directly) and chat (function calling), no separate service |
| File storage | Supabase Storage | Falls back to local disk when unconfigured |
| Email | Resend | Reminder/notification emails; no-ops silently when unconfigured |
| Realtime | Server-Sent Events (SSE) for OCR reveal; client polling (60s) for the notification bell | SSE doesn't fit a held-open serverless function for background polling |
| Reminders | Vercel Cron (daily) → `GET /api/cron/reminders` | Survives serverless scale-to-zero, unlike an in-process scheduler |

---

## 📁 Project Structure

```
invoice-demo/
├── src/
│   ├── app/
│   │   ├── (auth)/login/          # Login page
│   │   ├── (dashboard)/           # All protected pages
│   │   │   ├── page.tsx           # Dashboard (KPIs + charts)
│   │   │   ├── invoices/          # Invoice list, upload, detail
│   │   │   ├── admin/             # Users, companies, vendors, reminder settings
│   │   │   ├── vendor/profile/    # Vendor self-service company profile
│   │   │   ├── chat/              # AI chatbot
│   │   │   ├── reminders/         # Notification feed
│   │   │   └── audit/             # Audit log
│   │   └── api/                   # All Next.js API routes
│   ├── components/
│   │   ├── dashboard/             # KPICard, StatusDonut, AgingBar
│   │   ├── invoice/               # InvoiceTable, OCRProgress, StatusBadge
│   │   └── layout/                # Sidebar, TopBar, PageTransition
│   └── lib/
│       ├── auth/                  # NextAuth config + RBAC helpers
│       ├── db/                    # Prisma client (with PrismaPg adapter)
│       └── services/              # fileService, geminiExtraction, geminiChat, email, reminderScheduler
├── prisma/
│   ├── schema.prisma              # 9 database models
│   └── seed.ts                    # 20 demo invoices, 6 vendors, 2 companies, 6 users
└── docker-compose.yml             # PostgreSQL
```

---

## 🎬 Demo Script (10-minute walkthrough)

1. **Log in as Vendor** → upload a real invoice PDF, watch OCR fields appear one by one with confidence bars, pick a bill-to company, confirm
2. **Log in as GA Staff** → see the new invoice on the dashboard, record delivery date + PIC, mark it Paid
3. **Log in as GA Manager or Admin** → open the AI Chatbot, ask *"Invoice mana yang sudah jatuh tempo?"* — the assistant calls `query_invoices` against the real database, not a canned answer
4. **Open the Audit Log** → show every action recorded with user, role, and timestamp
5. **Open Admin → Reminder Settings** → show the due-soon/overdue thresholds and recipients are editable, not hardcoded

---

## ⚠️ Known Limitations (Demo MVP)

- **File storage falls back to local disk** when Supabase isn't configured — `uploads/invoices/`, which doesn't persist on Vercel.
- **Hardcoded demo users** — no self-service registration; admin creates named accounts via `/admin/users` (see [ARCHITECTURE.md](./docs/ARCHITECTURE.md)).
- **Synchronous OCR** — no job queue; the Gemini vision call blocks the SSE request for up to 60s.
- **Per-instance rate limiting** — the in-memory limiter (`src/lib/rate-limit.ts`) resets per server instance/restart, not shared across a multi-instance deployment.
