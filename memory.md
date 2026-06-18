# Invoice Tracking Project Memory

**Last Updated:** 2026-06-18  
**Project Root:** `/Users/harioprakoso/Work/IT_Apps/Invoice-Tracking`

---

## Architecture

### Full-Stack Stack
- **Frontend:** Next.js 16.2.7 with App Router + React 19.2.4
- **API Routes:** Next.js built-in API routes (`src/app/api/**`)
- **Database:** PostgreSQL with Prisma ORM v7.8.0 + pgvector extension
- **AI Service:** Python FastAPI (separate process) for OCR, embedding, chatbot
- **File Storage:** Local disk (`/uploads/invoices/`)
- **Authentication:** NextAuth v5, bcrypt password hashing, 7 demo users (ADMIN, MANAGER, FINANCE, VIEWER, GA_STAFF, GA_MANAGER, VENDOR)
- **UI Framework:** Tailwind CSS v4 + shadcn/ui components
- **Charts:** recharts
- **Animations:** Framer Motion
- **Testing:** Vitest + @testing-library/react
- **Background Jobs:** node-cron (hourly reminder scan)

### Service Topology
```
BROWSER
  ↓
Next.js (Full-Stack)
  ├─ React UI Layer
  ├─ API Routes → PostgreSQL
  └─ NextAuth (demo users hardcoded)
  
↓ HTTP (internal)

Python FastAPI (port 8000)
  ├─ /ocr/extract → Tesseract + LangChain
  ├─ /chat → LLM + pgvector RAG
  └─ /embed → LangChain embeddings

↓

PostgreSQL (port 5432)
```

### LLM Configuration
- **Provider:** Configurable via `LLM_PROVIDER` env var (groq | gemini | anthropic | openai | ollama)
- **Default:** Groq (free tier, llama-3.1-8b-instant)
- **Use Cases:**
  - OCR extraction: raw text → structured JSON (vendor, invoice_number, due_date, etc.)
  - Chatbot RAG: user query → pgvector search → LLM answer

---

## Coding Standards

### TypeScript
- Strictly typed — avoid `any`
- Use `type` for type aliases, `interface` for contracts
- Arrow functions, `const` declarations
- Trailing commas in multi-line objects/arrays

### React
- React Server Components (RSC) by default
- Client components marked with `'use client'` at top
- Use `useTheme()` hook for theme state (mounted guard required to prevent SSR hydration mismatch)
- Custom hooks in `src/hooks/`

### Styling
- Tailwind CSS v4 with `@custom-variant dark (&:is(.dark *))`
- Dark mode: add `dark:` prefixed classes for every light variant
- Dark colors: prefer `dark:bg-gray-900`, `dark:text-gray-100` (not inverted)
- CSS variables in `@supports (color: oklch(0 0 0))` block in `globals.css` for oklch() fallback

### Components
- shadcn/ui where applicable
- Lucide React icons (SVG, not emoji)
- Prop drilling: use React context sparingly; prefer composition
- Accessibility: `aria-label`, `aria-live`, semantic HTML, 4.5:1 contrast ratio

### Database
- Prisma schema in `prisma/schema.prisma`
- Migrations in `prisma/migrations/`
- Seed data in `prisma/seed.ts`

### API Routes
- RESTful conventions: `POST /api/resource`, `GET /api/resource/[id]`
- Request validation via Zod schemas
- Error responses with status codes (400, 401, 404, 500)
- SSE endpoints return `text/event-stream` content-type

### Python AI Service
- FastAPI with CORS for localhost:3000
- LangChain for LLM abstraction (swappable providers)
- pytesseract for OCR, pdf2image / PyMuPDF for PDF handling
- pgvector for cosine-similarity search
- `.env` for configuration (no secrets in code)

---

## Folder Structure

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/              # Protected layout with sidebar + topbar
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Dashboard (KPIs, charts)
│   │   ├── invoices/
│   │   │   ├── page.tsx          # Invoice list
│   │   │   ├── upload/page.tsx   # OCR upload page
│   │   │   └── [id]/page.tsx
│   │   ├── approvals/page.tsx    # Approval queue
│   │   ├── chat/page.tsx         # AI chatbot
│   │   ├── reminders/page.tsx    # Notification feed
│   │   └── audit/page.tsx        # Activity log
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── invoices/
│   │   │   ├── route.ts          # CRUD
│   │   │   └── [id]/
│   │   │       ├── route.ts
│   │   │       └── ocr/route.ts  # SSE stream
│   │   ├── vendors/route.ts
│   │   ├── approvals/route.ts
│   │   ├── chat/route.ts         # Proxy to Python
│   │   ├── audit/route.ts
│   │   ├── notifications/
│   │   │   ├── route.ts
│   │   │   └── stream/route.ts   # SSE notifications
│   │   └── dashboard/route.ts
│   ├── globals.css               # Tailwind setup with dark mode
│   └── layout.tsx                # Root layout + Plus Jakarta Sans font
├── components/
│   ├── ui/                       # shadcn/ui base components
│   ├── invoice/
│   │   ├── InvoiceDetailDrawer.tsx
│   │   ├── InvoiceTable.tsx
│   │   ├── StatusBadge.tsx       # Status badges with icons
│   │   └── OCRProgress.tsx       # Field-by-field animated reveal
│   ├── dashboard/
│   │   ├── KPICard.tsx           # Animated counter card
│   │   ├── StatusChart.tsx       # recharts donut
│   │   └── AgingChart.tsx        # recharts bar chart
│   ├── approval/
│   │   └── ApprovalTimeline.tsx
│   ├── chat/
│   │   └── ChatWindow.tsx
│   └── layout/
│       ├── Sidebar.tsx
│       ├── TopBar.tsx            # Theme toggle, user menu, notifications bell
│       └── ProtectedLayout.tsx
├── hooks/
│   └── useTheme.ts               # Theme state with localStorage persistence
├── lib/
│   ├── prisma.ts                 # Prisma client singleton
│   ├── auth.config.ts            # NextAuth config (4 demo users)
│   ├── ai-client.ts              # HTTP client for Python service
│   └── services/
│       ├── invoiceService.ts
│       ├── approvalService.ts
│       └── auditService.ts
├── types/
│   └── index.ts                  # Shared TypeScript types
└── middleware.ts                 # NextAuth middleware

prisma/
├── schema.prisma                 # Database schema (7 models)
├── migrations/
└── seed.ts                       # Demo data (users, vendors, invoices)

ai-service/                       # Python FastAPI (separate repo-like structure)
├── main.py                       # Entry point with CORS, routers
├── app/
│   └── api/
│       ├── ocr.py               # Tesseract + LangChain extraction
│       └── chat.py              # RAG chatbot
├── services/
│   ├── ocr_service.py
│   ├── extraction_chain.py      # LangChain LLMChain
│   ├── embedding_service.py
│   └── chat_service.py
├── models/
│   └── schemas.py               # Pydantic schemas
├── requirements.txt
├── .env.example
└── venv/                         # Python virtual environment

public/
└── (static assets)

docker-compose.yml               # PostgreSQL + pgvector (no other services)
package.json
.env.local                        # Local secrets (NextAuth secret, DB URL)
CLAUDE.md                         # Project instructions (read before coding)
AGENTS.md                         # Framework warnings (Next.js 16.2.7 breaking changes)
```

---

## Completed Tasks

### Phase 1: Core Setup
- ✅ Next.js 16.2.7 + App Router scaffold
- ✅ PostgreSQL + Prisma ORM + migrations
- ✅ NextAuth v5 with 4 hardcoded demo roles
- ✅ Database schema (7 models: User, Vendor, Invoice, InvoiceItem, ApprovalWorkflow, AuditLog, Notification)
- ✅ Seed script with demo data (6 vendors, 20 invoices, 4 users)

### Phase 2: UI Shell
- ✅ Responsive sidebar (drawer on mobile, full on desktop)
- ✅ TopBar with user menu, notification bell, theme toggle
- ✅ Protected layout with role-based nav
- ✅ Plus Jakarta Sans font integration

### Phase 3: Pages (Core Functionality)
- ✅ Dashboard page with KPI cards (animated counters) + recharts (status donut, aging bar)
- ✅ Invoice list page with table, filters, status badges
- ✅ Invoice upload page with drag-and-drop, file validation
- ✅ Invoice detail drawer (slide-in panel)
- ✅ Approval page with pending queue, timeline
- ✅ Chat page (AI chatbot with RAG)
- ✅ Reminders page (in-app notification feed)
- ✅ Audit log page (activity feed)

### Phase 4: API Routes
- ✅ Invoices CRUD + status transitions
- ✅ Vendors list
- ✅ Approvals workflow (approve/reject with status update)
- ✅ Audit logging (every action tracked)
- ✅ Dashboard stats aggregation
- ✅ OCR integration (SSE streaming from Python service)
- ✅ Chat proxy (Next.js → Python FastAPI)
- ✅ Notifications (read, mark-as-read, SSE stream)

### Phase 5: Authentication & Authorization
- ✅ NextAuth v5 configuration
- ✅ Credentials provider with 4 hardcoded demo users
- ✅ Role-based access control (middleware checks)
- ✅ Session persistence

### Phase 9: Multi-Persona + Security Hardening (2026-06-18)
- ✅ New roles: GA_STAFF, GA_MANAGER, VENDOR added to DB enum
- ✅ vendor_id FK on users table (VENDOR users link to a Vendor record)
- ✅ Password hashing migrated SHA256 → bcrypt (cost 12)
- ✅ vendorId propagated in JWT + session (vendor data isolation)
- ✅ 8 demo accounts (including vendor1@demo.com, vendor2@demo.com, gastaff@demo.com, gamanager@demo.com)
- ✅ Approval workflow: step 1 = GA_MANAGER, step 2 = FINANCE (was FINANCE → MANAGER)
- ✅ VENDOR data isolation: GET /invoices, /invoices/[id], /invoices/[id]/file scoped server-side
- ✅ IDOR protection on all [id] routes for VENDOR role
- ✅ File upload: 10MB size limit enforced
- ✅ GA_STAFF: read-only view of approvals queue (no approve/reject)
- ✅ Dashboard stats scoped by vendorId for VENDOR users
- ✅ Sidebar nav updated with all new roles
- ✅ 31 tests passing (new RBAC test suite added)

**Demo Accounts:**
| Email | Password | Role |
|-------|----------|------|
| admin@demo.com | demo123 | Admin |
| gastaff@demo.com | demo123 | GA Staff (read-only review) |
| gamanager@demo.com | demo123 | GA Manager (step 1 approval) |
| finance@demo.com | demo123 | Finance (step 2 final approval) |
| vendor1@demo.com | demo123 | Vendor: PT Maju Jaya Abadi |
| vendor2@demo.com | demo123 | Vendor: CV Teknologi Nusantara |
| viewer@demo.com | demo123 | Viewer (read-only) |
| manager@demo.com | demo123 | Manager (deprecated) |

### Phase 6: Python AI Service
- ✅ FastAPI scaffold with CORS
- ✅ OCR endpoint: PDF → Tesseract → LangChain → structured JSON
- ✅ Chat endpoint: query → pgvector RAG → LLM answer
- ✅ Embedding service (LangChain document splitter + embeddings)
- ✅ Configurable LLM provider (Groq, Gemini, Anthropic, OpenAI, Ollama)
- ✅ `.env` configuration with API keys

### Phase 7: Dark Mode Implementation
- ✅ `useTheme()` hook with localStorage persistence + system preference detection
- ✅ TopBar dark variants (header bg, text, bell button, notifications)
- ✅ Sidebar dark variants (nav items, borders, user section)
- ✅ InvoiceDetailDrawer dark variants (panel, header, vendor section, close button)
- ✅ StatusBadge with semantic icons per status (not color-only)
- ✅ KPICard dark variants (RSC boundary fix: accept `ReactNode` icon instead of function)

### Phase 8: Accessibility & Polish
- ✅ Color contrast improvements (4.5:1 ratio in dark mode)
- ✅ Semantic HTML (aria-labels, aria-live regions)
- ✅ Touch target sizes (44×44px minimum)
- ✅ Keyboard navigation (tab order)
- ✅ Focus states (visible rings)
- ✅ Reduced motion support (Framer Motion respects prefers-reduced-motion)
- ✅ Skeleton screens for loading states
- ✅ Toast notifications for user feedback

---

## Pending Tasks

### High Priority
1. **Dashboard Dark Mode Completion**
   - KPI cards: add `dark:bg-gray-900` to container
   - Chart containers: dark variant for recharts wrapper
   - Table header: `dark:bg-gray-800`, `dark:text-gray-100`
   - Table rows: `dark:hover:bg-gray-800`, alternating row colors
   - Text throughout: ensure `dark:` variants on all text-gray-* classes

2. **InvoiceDetailDrawer Dark Mode Completion**
   - Dates section: `text-gray-400` → add `dark:text-gray-300`
   - Financial summary: `bg-gray-50` → add `dark:bg-gray-800`
   - Line items: text colors dark variant
   - Approval timeline: header/step text dark variant
   - Notes section: background + border dark variant
   - OCR confidence bar: background dark variant

3. **AI Service Startup Documentation**
   - Step-by-step commands to activate venv, install deps, run uvicorn
   - Troubleshooting: missing Tesseract, API key config, port conflicts

### Medium Priority
4. **Testing Coverage**
   - Unit tests for invoice status transitions
   - Integration tests for OCR → database flow
   - E2E tests for approval workflow
   - Component tests for dark mode toggle

5. **Performance Optimization**
   - Virtual scrolling for large invoice lists (50+)
   - Image lazy loading in invoice PDFs
   - Database query optimization (indexes, N+1 checks)

6. **Additional Features (Post-MVP)**
   - Email notifications (currently in-app only)
   - Multi-language support (currently hardcoded Indonesian/English)
   - Export to Excel/PDF (invoices, reports)
   - Bulk upload (CSV + auto-match vendors)

---

## Known Issues

### Dark Mode
- **Issue:** Some page components (e.g., specific chart labels in recharts) may have hardcoded light colors without dark: variants
- **Status:** Partially fixed; InvoiceDetailDrawer in progress, dashboard pending
- **Workaround:** Manually add `dark:` classes where missing

### RSC Boundary Management
- **Issue:** Server Components cannot pass function references to Client Components (e.g., Lucide icon functions)
- **Status:** Fixed in KPICard by changing `icon: LucideIcon` prop to `icon: ReactNode`
- **Lesson:** Always instantiate JSX at the call site when crossing RSC boundary (e.g., `<FileText className="..." />` not `FileText`)

### CSS Variables Fallback
- **Issue:** Tailwind dark mode uses CSS variables for oklch() colors, but older browsers may not support it
- **Status:** Mitigated via `@supports` block in globals.css with hex color fallback
- **Impact:** Low — mostly affects Edge Legacy browsers

### Virtualization Not Implemented
- **Issue:** Large invoice lists (100+ rows) may cause performance lag without virtual scrolling
- **Status:** Not yet implemented; current MVP handles demo data (20 invoices) fine
- **Task:** Add `react-window` or `TanStack Virtual` if needed post-launch

### Hardcoded Demo Data
- **Issue:** Users stored in DB with bcrypt passwords; no user registration UI
- **Status:** By design for internal tool; 8 demo accounts available
- **Post-MVP:** Implement user registration, password reset, admin user management UI

### pgvector Embedding Updates
- **Issue:** When invoices are updated, embeddings may become stale (not re-generated)
- **Status:** Not critical for MVP (embeddings are read-once on invoice upload)
- **Post-MVP:** Add webhook to re-embed on invoice modification

### Error Handling in OCR
- **Issue:** If Python AI service is down, OCR requests hang; no graceful fallback in UI
- **Status:** Partially addressed — API route checks `/health` endpoint
- **Enhancement:** Add timeout (5s) + user-facing "Manual entry" mode when service unavailable

---

## Key Files & Their Purpose

| File | Purpose |
|------|---------|
| `src/hooks/useTheme.ts` | Theme state management with localStorage + system preference |
| `src/app/globals.css` | Tailwind setup, dark mode custom variant, CSS variable fallback |
| `src/components/layout/TopBar.tsx` | Header with theme toggle, notification bell, user menu |
| `src/components/layout/Sidebar.tsx` | Navigation sidebar with role-based menu items |
| `src/app/(dashboard)/page.tsx` | Main dashboard with KPI cards and charts |
| `src/components/invoice/InvoiceDetailDrawer.tsx` | Slide-in panel for invoice details |
| `src/components/dashboard/KPICard.tsx` | Animated counter card (RSC-safe: icon as ReactNode) |
| `src/components/invoice/StatusBadge.tsx` | Status badges with semantic icons |
| `prisma/schema.prisma` | Database schema definition |
| `prisma/seed.ts` | Demo data seed script |
| `src/lib/auth.config.ts` | NextAuth configuration (demo users) |
| `src/lib/ai-client.ts` | HTTP client for Python FastAPI service |
| `ai-service/main.py` | Python FastAPI entry point |
| `ai-service/app/api/ocr.py` | OCR extraction endpoint |
| `ai-service/app/api/chat.py` | Chatbot RAG endpoint |
| `docker-compose.yml` | PostgreSQL container definition |

---

## Quick Reference Commands

```bash
# Install dependencies
npm install

# Activate Python venv
cd ai-service && source venv/bin/activate

# Install Python deps
pip install -r requirements.txt

# Start PostgreSQL (docker-compose)
docker-compose up -d db

# Run Prisma migrations
npx prisma migrate dev

# Seed demo data
npx prisma db seed

# Start Next.js dev server
npm run dev

# Start Python AI service
cd ai-service && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Run tests
npm test

# Build for production
npm run build
npm start
```

---

## Debugging Tips

### Theme Not Persisting
- Check localStorage: `localStorage.getItem('theme')`
- Check `<html>` class: should be `class="dark"` or `class=""`
- Verify `useTheme()` has `mounted` guard in component

### Dark Mode Colors Look Off
- Check Tailwind config; `@custom-variant dark` should be in globals.css
- Verify color is defined in both light and dark variants: `text-gray-500 dark:text-gray-400`
- Use Inspect → Styles to verify computed color

### OCR Not Working
- Check Python service health: `curl http://localhost:8000/health`
- Check `/api/invoices/[id]/ocr` response for errors
- Verify Tesseract installed: `tesseract --version`
- Check `.env` LLM API keys are valid

### Database Connection Issues
- Verify PostgreSQL running: `docker-compose ps`
- Check `DATABASE_URL` in `.env.local`
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`

### NextAuth Not Working
- Check middleware redirection: `src/middleware.ts`
- Verify `NEXTAUTH_SECRET` in `.env.local`
- Check session cookie: DevTools → Application → Cookies → `authjs.session-token`

---

## Notes for Future Self

- **Always add `dark:` variants when styling.** Light-only styling breaks dark mode.
- **RSC boundary rule:** Instantiate components at call site, not in props. Pass JSX, not function references.
- **useTheme() always needs mounted guard.** SSR hydration mismatch = flickering + console errors.
- **Commit small + often.** Dark mode was 7 commits, easier to review and revert if needed.
- **Test responsive design.** Mobile (375px), tablet (768px), desktop (1920px).
- **Keep AI service separate.** Python service can be replaced/upgraded without touching Next.js frontend.
