# Setup & Local Development

## Prerequisites

- Node.js 18+
- Docker Desktop (for PostgreSQL)
- Python 3.10+ (for the AI service)
- Tesseract OCR — macOS: `brew install tesseract tesseract-lang`; Ubuntu: `sudo apt install tesseract-ocr tesseract-ocr-ind`

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Create `.env.local` in the project root:

```env
DATABASE_URL="postgresql://invoice_user:invoice_pass@localhost:5434/invoice_demo"
NEXTAUTH_SECRET="any-random-string-at-least-32-chars"
NEXTAUTH_URL="http://localhost:3000"
AI_SERVICE_URL="http://localhost:8000"
```

> Host port is **5434**, not the Postgres default 5432 — see `docker-compose.yml` and commit `a56ffcd` (changed to avoid clashing with a locally installed Postgres).

## 3. Start the database

```bash
docker-compose up -d
```

## 4. Run migrations and seed demo data

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

Creates all tables, 8 demo user accounts, demo vendors, and demo invoices across every status. The seed script refuses to run when `NODE_ENV=production`.

## 5. Start the Next.js app

```bash
npm run dev
```

Open http://localhost:3000.

## 6. Start the AI service (optional — needed for OCR and chatbot)

```bash
cd ai-service
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# edit .env: set LLM_PROVIDER and the matching API key
uvicorn main:app --reload --port 8000
```

Supported `LLM_PROVIDER` values: `groq` (free, recommended default), `gemini`, `anthropic`, `openai`, `deepseek`, `ollama` (local, no key). See `ai-service/.env.example` for the full list of provider-specific keys and default model per provider.

## All three processes together

| Terminal | Command | Serves |
|---|---|---|
| 1 | `docker-compose up -d` | PostgreSQL on `localhost:5434` |
| 2 | `npm run dev` | Web app on `localhost:3000` |
| 3 | `cd ai-service && uvicorn main:app --reload --port 8000` | AI service on `localhost:8000` |

## Demo accounts

All demo accounts use password `demo123` (bcrypt-hashed, cost 12).

| Email | Role | Notes |
|---|---|---|
| `admin@demo.com` | ADMIN | Full access, including audit log |
| `gastaff@demo.com` | GA_STAFF | Read-only review of the approval queue |
| `gamanager@demo.com` | GA_MANAGER | Step-1 approval |
| `finance@demo.com` | FINANCE | Upload, OCR, review, step-2 (final) approval |
| `vendor1@demo.com` | VENDOR | PT Maju Jaya Abadi — sees only own invoices |
| `vendor2@demo.com` | VENDOR | CV Teknologi Nusantara — sees only own invoices |
| `viewer@demo.com` | VIEWER | Read-only |
| `manager@demo.com` | MANAGER | Deprecated role, retained for backward compatibility |

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

**OCR not working**
- Check the AI service is up: `curl http://localhost:8000/health`
- Check `tesseract --version` is installed and on `PATH`
- Verify the LLM API key in `ai-service/.env` is valid for the selected `LLM_PROVIDER`
- Inspect the response of `/api/invoices/[id]/ocr` in the browser network tab (SSE stream)

**Database connection issues**
- `docker-compose ps` — confirm the `db` container is healthy
- Confirm `DATABASE_URL` in `.env.local` points at port **5434**
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

`vercel.json` sets a 30s max duration for API routes and runs `prisma generate && next build`. Because file storage is local-disk and the AI service is a separate long-running Python process, a Vercel deployment needs: (1) an external file store swapped in for `uploads/invoices/`, (2) the AI service hosted elsewhere with `AI_SERVICE_URL` pointed at it, (3) a hosted Postgres (e.g. Supabase) with `DATABASE_SSL_REJECT_UNAUTHORIZED` configured per the note above. See branches `deploy/option-a` / `deploy/option-b` for prior deployment attempts.
