# 🧾 Invoice Intelligence System

> An AI-powered Invoice Tracking & Accounts Payable Assistant — built as a demo MVP to showcase real-time OCR extraction, multi-step approval workflows, and an AI chatbot, all in a single responsive web app.

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
| **Finance** | Upload invoices, run OCR, review extracted data, forward to Manager |
| **Manager** | Review Finance-approved invoices, give final approval or reject with a comment |
| **Admin** | Full access — all pages including audit log |
| **Viewer** | Read-only access — browse invoices and dashboard |

**Demo accounts (all password: `demo123`):**

| Email | Role |
|-------|------|
| `admin@demo.com` | Admin |
| `manager@demo.com` | Manager |
| `finance@demo.com` | Finance |
| `viewer@demo.com` | Viewer |

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
| Python AI service | `http://localhost:8000` |
| PostgreSQL database | `localhost:5432` (via Docker) |
| Uploaded files | `uploads/invoices/` (local disk) |

---

## ❓ Why was this built?

Manual invoice processing is slow, error-prone, and hard to audit. This project demonstrates how modern AI tools can:

1. **Eliminate manual data entry** — OCR + LLM extracts vendor name, invoice number, dates, line items, and tax automatically from any invoice (Indonesian or English)
2. **Enforce a consistent approval chain** — no invoice can be approved without both Finance and Manager sign-off, and every decision is logged
3. **Surface overdue risks proactively** — an hourly scheduler flags invoices approaching or past their due date before they become a problem
4. **Give finance teams a natural language interface** — instead of building complex filters, just ask the AI chatbot

The LLM provider is fully configurable — swap between Groq (free), Gemini (free), Ollama (local/offline), Anthropic Claude, or OpenAI with a single environment variable change.

---

## 🛠️ How do you run it?

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL)
- [Python 3.10+](https://www.python.org/) (for the AI service)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) installed on your system
  - macOS: `brew install tesseract tesseract-lang`
  - Ubuntu: `sudo apt install tesseract-ocr tesseract-ocr-ind`

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
DATABASE_URL="postgresql://invoice_user:invoice_pass@localhost:5432/invoice_demo"
NEXTAUTH_SECRET="any-random-string-at-least-32-chars"
NEXTAUTH_URL="http://localhost:3000"
AI_SERVICE_URL="http://localhost:8000"
```

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

This creates all tables, populates 20 demo invoices across all statuses, and creates the 4 demo user accounts.

---

### Step 5 — Start the Next.js app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with any demo account.

---

### Step 6 — Start the AI service *(optional — needed for OCR and chatbot)*

```bash
cd ai-service

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure the LLM provider
cp .env.example .env
# Then edit .env and set LLM_PROVIDER + the matching API key
```

**Choose your LLM provider** (edit `ai-service/.env`):

```env
# Option 1: Groq — free tier, fast, recommended for demo
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key

# Option 2: Google Gemini — free tier available
LLM_PROVIDER=gemini
GOOGLE_API_KEY=your_google_api_key

# Option 3: Ollama — fully local, no API key needed
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434

# Option 4: Anthropic Claude — highest quality
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key

# Option 5: OpenAI GPT
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
```

Start the service:

```bash
uvicorn main:app --reload --port 8000
```

---

### All three terminals running

| Terminal | Command | Result |
|----------|---------|--------|
| 1 | `docker-compose up -d` | Database on port 5432 |
| 2 | `npm run dev` | Web app on port 3000 |
| 3 | `cd ai-service && uvicorn main:app --reload` | AI service on port 8000 |

---

## 🗺️ Architecture Overview

```
Browser
  └── Next.js App (localhost:3000)
        ├── React UI  (Tailwind CSS + shadcn/ui + Framer Motion)
        └── Next.js API Routes
              └── Python AI Service (localhost:8000)
                    ├── POST /ocr/extract  →  Tesseract + LangChain → structured JSON
                    └── POST /chat         →  LangChain + LLM → natural language answer
              └── PostgreSQL + pgvector (localhost:5432)
```

**Key technology choices:**

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Next.js 16 (App Router) + TypeScript | Single repo, full-stack, fast DX |
| Styling | Tailwind CSS v4 + shadcn/ui | Clean design system, zero config |
| Animations | Framer Motion | Smooth transitions with minimal code |
| Charts | recharts | React-native, responsive by default |
| Auth | NextAuth v5 | JWT sessions, role-based access |
| Database | PostgreSQL 16 + pgvector | Relational data + vector search |
| ORM | Prisma 7 | Type-safe queries, fast schema iteration |
| AI service | FastAPI + LangChain LCEL | Lightweight, async, provider-agnostic |
| OCR | Tesseract + PyMuPDF | Open-source, offline, Indonesian support |
| Realtime | Server-Sent Events (SSE) | Real-time OCR reveal + notification bell |
| Reminders | node-cron (hourly scan) | No external dependencies |

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
│   │   │   ├── approvals/         # Approval queue (Finance & Manager)
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
│       └── services/              # Due-date reminder scheduler
├── ai-service/                    # Python FastAPI service
│   ├── app/api/                   # /ocr and /chat endpoints
│   └── app/services/              # OCR extraction, LangChain chain, chat
├── prisma/
│   ├── schema.prisma              # 7 database models
│   └── seed.ts                    # 20 demo invoices, 6 vendors, 4 users
└── docker-compose.yml             # PostgreSQL with pgvector
```

---

## 🎬 Demo Script (10-minute walkthrough)

1. **Log in as Finance** → see the pre-populated dashboard with animated KPI counters and charts
2. **Upload a real invoice PDF** → watch OCR fields appear one by one with confidence bars
3. **Confirm the extracted data** → invoice moves to "Pending Approval"
4. **Switch to Manager account** → approve the invoice → card animates out, status updates live
5. **Open the AI Chatbot** → ask *"Invoice mana yang sudah jatuh tempo?"*
6. **Open the Audit Log** → show every action recorded with user, role, and timestamp

---

## ⚠️ Known Limitations (Demo MVP)

- **Local disk storage** — files are saved to `uploads/invoices/`. Use S3 or equivalent in production.
- **Hardcoded demo users** — no registration or password reset. Replace with a real identity provider for production.
- **Synchronous OCR** — large PDFs may take a few seconds. In production, offload to a background queue (e.g. Celery + Redis).
- **Chatbot uses general context** — the AI answers from its training knowledge about invoices, not live database queries. Full RAG with pgvector is the natural next step.
- **In-app notifications only** — no email or SMS. Add a notification provider (e.g. SendGrid, Twilio) for production reminders.
