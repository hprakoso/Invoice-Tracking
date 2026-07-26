# Changelog

Two sections, per `CLAUDE.md` convention:
- **Code Changes Made** — running log of what changed and why, newest first. Add an entry here for every task before committing.
- **Commit Log** — the project's git history, grouped by phase for readability. Reconstructed retrospectively on 2026-07-15 since `docs/` did not exist before this file.

---

## Code Changes Made

### 2026-07-26 — docker-compose: pgvector → plain postgres
**What:** `docker-compose.yml`'s `db.image` changed from `pgvector/pgvector:pg16` to `postgres:16`. Docs updated to match (`docs/ARCHITECTURE.md`, `docs/DATABASE.md`).
**Why:** No `vector` column has ever existed in the schema — chat has always answered from a static context string (`docs/ARCHITECTURE.md`'s own Known Limitations section already said so), and is being rebuilt onto a structured `query_invoices` tool rather than vector search (`docs/PRODUCTION_PLAN.md` §5.2). Dead weight removed from the local dev image.
**Not applied to the running container:** this only changes what a fresh `docker-compose up` provisions. The already-running local `invoice_demo_db` container (with this session's migrated + seeded data) was intentionally left untouched — recreating it wasn't asked for and risked live dev data for a cosmetic image swap.

### 2026-07-26 — Rate limiter: lazy sweep instead of a background setInterval
**What:** `src/lib/rate-limit.ts`'s `setInterval(...).unref()` (swept expired entries every 60s) replaced with a lazy sweep — every 100th call to `rateLimit()` walks the Map and drops expired entries. New `src/lib/__tests__/rate-limit.test.ts` (4 cases: under-limit allowed, over-limit 429 + `Retry-After`, window reset, independent identifiers) — this file had no test coverage before.
**Why:** A `setInterval` doesn't fire reliably on serverless (the process can freeze between invocations), so correctness shouldn't depend on it. The per-instance in-memory limiter itself is accepted as-is for now — see `docs/PRODUCTION_PLAN.md` §4.3 for why (protects an authenticated surface, not anonymous; degrades to "per instance" rather than failing open).
**Verified live:** hit `/api/chat` (limit 10/min) 11 times through the real running server as a logged-in `GA_MANAGER` — first 10 returned 200, the 11th returned 429, confirming the refactor preserved the exact limiting behavior, not just that it type-checks.

### 2026-07-26 — Notification bell: SSE stream → client polling
**What:** Deleted `GET /api/notifications/stream` (held a `ReadableStream` open, polling the DB server-side every 15s for as long as the client stayed connected). `useNotificationStream.ts` now polls the existing `GET /api/notifications?unread=true` endpoint client-side every 60s and uses the response array's length as the unread count — no new route needed, the endpoint already existed for the notification-bell popover.
**Why:** A held-open SSE connection doesn't fit a serverless function — Vercel bills and eventually terminates long-lived connections, and it defeats scale-to-zero. Client polling is one `fetch` per interval, fits the request/response model serverless is built for. See `docs/PRODUCTION_PLAN.md` §4.4.
**Verified live:** confirmed the deleted route now hits middleware's generic 401 (not a route-specific response — expected, doesn't leak route existence) and that the new polling call returns real unread-notification rows for a logged-in user via the actual NextAuth session flow.

### 2026-07-26 — node-cron → Vercel Cron for due-date reminders
**What:** Removed `node-cron`/`@types/node-cron` and `src/instrumentation.ts` (an in-process scheduler doesn't survive Vercel's serverless scale-to-zero). `src/lib/services/reminderScheduler.ts` now exports a pure `checkDueDates()` function (previously wrapped in `cron.schedule(...)` + a `setTimeout` for demo-boot); new `GET /api/cron/reminders` route calls it, guarded by an `Authorization: Bearer <CRON_SECRET>` check done inside the route itself (no NextAuth session exists for a Vercel Cron-initiated request). Registered in `vercel.json` → `crons: [{ path: "/api/cron/reminders", schedule: "0 1 * * *" }]` — daily, the Vercel Hobby-plan cap. Also bumped the OCR route's `maxDuration` to 60s in `vercel.json` (Hobby's function ceiling is actually 300s, well above the 30s default already set — 60 is margin, not a fix for a real limit). Cleaned up the 3 pre-existing `as any` casts in this file while rewriting it (Prisma's typed `InvoiceStatus[]`/`Role[]` need no cast once the query shape is right).
**Found and fixed while verifying live:** `src/middleware.ts` returned its own 401 for `/api/cron/reminders` *before* the route's `CRON_SECRET` check ever ran, because the request carries no NextAuth session and middleware only allowlists `/login`, `/api/auth/**`, `/api/health`. Both failure modes produced the identical `{"error":"Unauthorized"}` body, so this was only caught by curling the running route with the right secret and getting 401 anyway — `tsc`/tests never would have caught it, since middleware and the route are two independent auth checks that both happen to fail the same way. Added `/api/cron/**` to middleware's public-route allowlist (the route still authenticates itself via `CRON_SECRET` — middleware just needed to stop pre-empting it).
**Why:** Required for the Vercel deployment target — see `docs/PRODUCTION_PLAN.md` §4.2.
**Verified live, not just compiled:** ran the actual Next.js dev server (not just `tsc`/`next build`) and curled `/api/cron/reminders` — confirmed 401 with no/wrong `CRON_SECRET`, 200 with the correct one, and that a second immediate call creates 0 new notifications (24h dedup working against real DB rows). Also logged in via the real NextAuth credentials flow as `GA_MANAGER` and `GA_STAFF` to confirm the Phase 13 role changes actually hold end-to-end (GA_MANAGER: 200 on `/api/audit` and `/api/chat`; GA_STAFF: 403 on both) — not just that the code compiles.

### 2026-07-26 — Role model simplified from 7 to 4 (dropped MANAGER/FINANCE/VIEWER)
**What:** `prisma/schema.prisma` `Role` enum reduced to `ADMIN`, `GA_STAFF`, `GA_MANAGER`, `VENDOR`. New migration `20260726171012_simplify_roles` (hand-written, applied and verified against the local dev DB): remaps any existing `MANAGER`/`FINANCE`/`VIEWER` rows to `GA_STAFF` as a safety net, then swaps the Postgres enum type (`CREATE TYPE Role_new` → `ALTER TABLE ... TYPE` → `DROP TYPE` → rename). `FINANCE`'s six responsibilities were redistributed rather than dropped: create/upload/status-change invoices and audit-log access now go to `GA_STAFF`+`GA_MANAGER` (previously `GA_STAFF` alone lacked audit access, `GA_MANAGER` had neither); the invoice `PATCH` route's `allowedFields()` switch folds `GA_MANAGER` into the existing `GA_STAFF` case rather than keeping a separate `FINANCE` branch, since `isEditor` already generalizes to "whoever created this invoice" regardless of role name. `GA_MANAGER` also keeps sole (with `ADMIN`) access to `POST /api/chat` — narrowed from "every role except VENDOR". Reminder-scheduler recipients (`FINANCE`,`GA_STAFF` → `GA_STAFF`,`GA_MANAGER`) updated inline; the file itself is due for a full rewrite when the Vercel Cron + `ReminderSetting` work lands, so its two remaining `as any` casts were left for that pass rather than touched twice. Updated every `requireRole()`/Zod-enum call site (`chat`, `invoices`, `invoices/[id]`, `invoices/[id]/upload`, `audit`, `users`, `users/[id]`, `validations.ts`), all UI role lists/badges (`Sidebar.tsx`, `TopBar.tsx`, `audit/page.tsx`, `admin/users/page.tsx`, `invoices/page.tsx`, `invoices/upload/page.tsx`, `invoices/[id]/page.tsx`, login demo-account list), `prisma/seed.ts` (6 users now, `finance@`/`manager@`/`viewer@` demo accounts removed), and `src/lib/auth/__tests__/rbac.test.ts` (8 cases rewritten for the 4-role matrix). Replaced the `Sidebar`/`TopBar` `?? 'VIEWER'` fallback — used while the session is still loading — with an explicit loading state (empty nav / neutral badge) instead of falling back to any real role, since a fallback role would render nav items or badge colors the user may not actually be permitted to see. `Sidebar.tsx` also gained two nav entries (`/admin/companies`, `/admin/reminders`) for pages landing in follow-up commits. Docs updated: `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/SETUP.md`.
**Why:** User decision — the only roles actually in use across the org are Admin, GA Staff, GA Manager, and Vendor; `MANAGER` and `VIEWER` were already dead (deprecated, read-only, no distinct capability), and `FINANCE` was real but its responsibilities belonged with GA Staff/GA Manager once payment tracking moves in-house. Full plan: `docs/PRODUCTION_PLAN.md` §4.9. Verified against a live Postgres instance (not just `tsc`) — migration applied cleanly, `prisma/seed.ts` reseeded successfully, all 35 existing tests pass, and a full `next build` (same pipeline Vercel runs) succeeds.
**Not Stored / no schema change beyond the enum:** no new columns — this commit only removes enum values and redistributes existing route/UI permission checks.

### 2026-07-16 — Three manual-QA fixes: resubmit ownership, PIC privacy, UI copy
**What:** (1) `PATCH /api/invoices/[id]` now rejects `REVISION → SUBMITTED` from `GA_STAFF` (403 "Only the vendor can resubmit a revision") — fixing/resubmitting is the vendor's job even though `GA_STAFF` can create invoices; frontend `canResubmit` matches (`VENDOR` owner or `ADMIN` only), and `isOwner` was also fixed to compare `vendor.id` (company-level) instead of `createdBy.id` (single-user), matching the backend's own ownership check. (2) `GET /api/invoices/[id]` now forces `pic: null` for `VENDOR` callers — PIC (the GA Staff handling the hardcopy) is internal-only; the frontend read-only PIC line is hidden for `VENDOR` too. (3) Removed the "Line item tidak bisa diubah di sini..." note from the Fix & Resubmit card.
**Why:** User-reported during manual QA (screenshot showed `GA_STAFF` seeing the resubmit form after setting a status themselves) — the resubmit-ownership and PIC-visibility issues were real gaps versus the app's role model; the copy removal was a UX preference.

### 2026-07-15 — Added the missing Fix & Resubmit form for REVISION invoices
**What:** `invoices/[id]/page.tsx`'s "Resubmit" button previously only sent `{status: 'SUBMITTED'}` with no way to actually correct anything — `PATCH /api/invoices/[id]` already allowed `VENDOR` (owner) to edit `invoiceNumber`/`invoiceDate`/`dueDate`/`subtotal`/`taxAmount`/`totalAmount`/`notes` while `status = REVISION`, but no frontend form existed for it. Added editable inputs for those fields, submitted together with `status: 'SUBMITTED'` in one `PATCH`. Line items are explicitly not editable here (noted in the UI) — that would need a separate line-item editor, out of scope for this fix.
**Why:** User asked how a vendor is supposed to fix a `REVISION` invoice — answer was "there's no way yet," a real gap versus this plan's own locked decision ("Vendor may edit the same fields during REVISION as they can at creation time").

### 2026-07-15 — Invoice list navigation didn't reach the editable detail page
**What:** `invoices/page.tsx` row click opened the read-only `InvoiceDetailDrawer` instead of navigating to `/invoices/[id]`, so the Update Status / Delivery & PIC editing cards added in the status-lifecycle work were unreachable. Rows now `router.push()` to the full detail page; `InvoiceDetailDrawer.tsx` (now fully unused) and its test were deleted.
**Why:** User-reported via screenshot during manual QA — confirmed the underlying card code was correct, the bug was pure navigation.

### 2026-07-15 — Two bugs found during manual QA of the invoice workflow overhaul
**What:** (1) `ai-service/main.py` now calls `load_dotenv()` before the FastAPI app/router imports — `python-dotenv` was already a listed dependency but nothing invoked it, so `ai-service/.env` never reached `os.environ`, causing every OCR/chat call to fail with a `GROQ_API_KEY` error even though `uvicorn` itself started fine. (2) `invoices/upload/page.tsx` review step gets a PIC dropdown for `GA_STAFF` uploaders (sourced from `GET /api/users?role=GA_STAFF`, defaults to self, submitted via the existing `PATCH /api/invoices/[id]` `picId` field) — previously only `VENDOR` got a Send Date input at this step, `GA_STAFF` had no way to assign/reassign PIC during upload at all.
**Why:** User-reported during manual verification of the previous commits (see Phase 9 in the Commit Log below).

### 2026-07-15 — Structured `docs/` reference created
**What:** Added `docs/INDEX.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/SETUP.md`, `docs/CHANGELOG.md` (this file). Fixed a stale port reference in the root `README.md` (said Postgres runs on 5432; `docker-compose.yml` maps it to 5434 as of commit `a56ffcd`).
**Why:** `CLAUDE.md` requires every change to be documented in `docs/` with API response fields traced to their `table.column`/formula source, but no `docs/` directory existed yet — all project knowledge lived only in the root `README.md` (demo pitch) and `memory.md` (freeform dev notes), neither of which is organized for that traceability requirement. This reconstructs a structured reference from the current codebase and full commit history.
**Not stored / no schema change:** documentation only, no code or migration touched.

### 2026-07-15 — Renamed docs index file, untracked CLAUDE.md
**What:** Renamed `docs/README.md` → `docs/INDEX.md` (updated the two references that pointed at it, in the root `README.md` and here). Committed the pre-existing uncommitted `.gitignore` change (adds `AGENTS.md`, `memory.md`, `CLAUDE.md` to ignore list) and removed `CLAUDE.md` from git tracking (`git rm --cached`, file kept on disk) to match `AGENTS.md`/`memory.md`, which were already untracked.
**Why:** User preference — avoid a second `README.md` inside `docs/` (ambiguous alongside the root one), and finish untracking the AI-assistant instruction files consistently now that `.gitignore` covers all three.

### 2026-07-15 — Fixed stale Postgres port reference (5434 → 5433)
**What:** `docker-compose.yml` already mapped Postgres to host port 5433 (uncommitted local change predating this session); `README.md` and `docs/SETUP.md` still said 5434. Corrected both to match the actual running port (verified via `docker ps`/`.env`).
**Why:** Pure documentation-accuracy fix, unrelated to any feature work — grouped as its own commit per `CLAUDE.md`'s "split unrelated changes into separate commits".
**Not Stored:** config/docs only, no schema or code logic touched.

### 2026-07-15 — Invoice status pipeline replaced: Submitted/Cancelled/Rejected/Void/Revision
**What:** Dropped the in-app 2-step `ApprovalWorkflow` (`ApprovalStatus` enum, `/api/approvals/**`, `/approvals` page) and the old 6-status pipeline (`PENDING_OCR/PENDING_REVIEW/PENDING_APPROVAL/APPROVED/REJECTED/PAID`). New `InvoiceStatus`: `SUBMITTED/CANCELLED/REJECTED/VOID/REVISION`, set via `VALID_TRANSITIONS` (`src/lib/validations.ts`). Added `Invoice.sendDate`/`deliveredDate`/`picId` for GA Staff hardcopy tracking (`validateDeliveryDates()` enforces `deliveredDate ≥ sendDate`). `PATCH /api/invoices/[id]` rewritten with a per-role/per-status field-permission matrix (`allowedFields()`) replacing the flat `requireRole(['FINANCE','ADMIN'])` gate; `POST /api/invoices`/`upload` now also allow `GA_STAFF`. OCR route no longer changes `status`. Frontend: `StatusBadge`/`StatusDonut` relabeled; invoice detail/list/upload pages and `InvoiceDetailDrawer` updated (approval UI replaced with Update Status + Delivery & PIC cards); `reminderScheduler.ts`/`format.ts` updated to the new open-status set (`SUBMITTED`/`REVISION`). New migration `20260715171000_invoice_workflow_overhaul` (hand-written — `prisma migrate dev` refuses non-interactive environments), applied by the user via `npx prisma migrate reset --force`. `prisma/seed.ts` rewritten for the new status set + delivery/PIC demo data. New `src/lib/__tests__/validations.test.ts`; `InvoiceDetailDrawer.test.tsx` updated. See `docs/DATABASE.md`, `docs/API.md`, `docs/ARCHITECTURE.md#invoice-status-lifecycle` for field-source tracing.
**Why:** User request — the real physical process is a vendor/GA-Staff submitting an invoice, GA Staff forwarding the hardcopy to Finance outside the app, and someone later recording the outcome; the old approval workflow modeled a process the app doesn't actually own, and `PAID` was meaningless since Finance never pays through the system. Full decision trail: `/Users/harioprakoso/.claude/plans/okee-jadi-sekarang-fokus-luminous-nest.md`.

### 2026-07-15 — Dashboard Excel export
**What:** New `GET /api/dashboard/export`, generates a two-sheet `.xlsx` (KPI Summary + full invoice list) via `exceljs`, streamed on demand, nothing persisted. Extracted the dashboard aggregation query logic into `src/lib/services/dashboardStats.ts` so `GET /api/dashboard` and the new export route compute identical numbers from one place (also renames the response field `pendingApprovalCount` → `openCount`, since the approval concept no longer exists). Dashboard page gets an "Export to Excel" link.
**Why:** Requested feature — export dashboard report to Excel. New dependency `exceljs` was explicitly approved by the user before installing, per `CLAUDE.md`'s "ask before adding new dependencies" rule.

### 2026-07-15 — Admin user management (create user, edit role)
**What:** New `GET/POST /api/users`, `PATCH /api/users/[id]` (create named accounts, edit role, `ADMIN`-only for writes; broader read for the PIC dropdown), using `createUserSchema` (bcrypt hash, `vendorId` required when `role=VENDOR`, added to `validations.ts` in the previous commit). New `/admin/users` page: user table with inline role edit + a create-user form.
**Why:** Requested feature — admin needs a way to create real named per-person accounts (previously only 8 hardcoded demo/role accounts existed) and change any user's role.

### 2026-07-15 — Removed VENDOR access to the AI chat
**What:** `POST /api/chat`: `requireAuth()` → `requireRole([...])` excluding `VENDOR` (previously no role check at all — any authenticated user, VENDOR included, could use it).
**Why:** Requested — take the AI chat feature out of the vendor role.

### 2026-07-15 — Wired up Sidebar/TopBar for the new routes and permissions
**What:** `Sidebar.tsx`: removed the `/approvals` nav entry (feature removed), added `GA_STAFF` to the Upload Invoice entry's roles, removed `VENDOR` from the AI Assistant entry, added a new ADMIN-only User Management entry (`/admin/users`). `TopBar.tsx`: removed the `/approvals` page-title mapping, added `/admin/users`.
**Why:** Navigation plumbing for the four preceding feature commits (status lifecycle, Excel export, admin RBAC, chat lockdown) — grouped as its own commit since `Sidebar.tsx`/`TopBar.tsx` are directly related to each other (both navigation shell components) but not tightly coupled to any single one of those features individually.

### 2026-07-15 — Dashboard page: Export to Excel link, Open Invoices card
**What:** `src/app/(dashboard)/page.tsx`: added an "Export to Excel" link (`<a href="/api/dashboard/export" download>`, native browser download, no client-side fetch/blob needed) next to the page header; renamed the 4th KPI card from "Pending Approval"/`pendingApprovalCount` to "Open Invoices"/`openCount`, matching the API field renamed in the Excel-export commit.
**Why:** Completes the two preceding commits (Excel export, status lifecycle) on the frontend — accidentally left uncommitted when those landed.

## Commit Log

Full history of the `feat/production-hardening` branch (current branch), grouped by phase. `main` and this branch are at the same point through `b7ffd9e`; deploy attempts live on separate branches (`deploy/option-a`, `deploy/option-b`, `chore/cleanup-tracked-files`) with their own merge commits, omitted here.

### Phase 0 — Scaffold
| Commit | Date | Message |
|---|---|---|
| `f73db86` | 2026-06-09 | Initial commit from Create Next App |

### Phase 1 — Core MVP build
| Commit | Date | Message |
|---|---|---|
| `8c01a15` | 2026-06-09 | feat: initial AI-powered invoice tracking system (demo MVP) |
| `1aefd2c` | 2026-06-09 | docs: add project conventions to CLAUDE.md |
| `a152127` | 2026-06-09 | feat(task-13): invoice detail page with PDF viewer and approval timeline |
| `4efa80c` | 2026-06-09 | feat(task-14): approval queue page with role-based cards and optimistic UI |
| `133a55f` | 2026-06-09 | feat(task-15): reminders page with filter tabs and per-notification read actions |
| `3d1f56c` | 2026-06-09 | feat(task-16): chatbot, audit log, page transitions, and AI chat service |
| `78d41a4` | 2026-06-09 | docs: rewrite README with 5W 1H structure for clarity |
| `3634b11` | 2026-06-09 | fix: address 7 code-review findings (security, correctness, cleanup) |
| `7ac71bc` | 2026-06-09 | fix: pass icon as ReactNode to resolve RSC boundary crash on dashboard |
| `90dae5d` | 2026-06-09 | fix: update gemini model to gemini-2.0-flash and add groq support note |
| `3545fb5` | 2026-06-09 | fix: guard approvals array against undefined in InvoiceDetailDrawer |

### Phase 2 — Dark mode, accessibility, UX polish
| Commit | Date | Message |
|---|---|---|
| `b15ce14` | 2026-06-10 | fix: sidebar highlights only the exact active nav item |
| `b6f854d` | 2026-06-10 | fix: sidebar active state — exact nav match blocks parent prefix highlight |
| `f40e1da` | 2026-06-10 | fix(a11y): address critical accessibility issues from UI review |
| `ed6bd5b` | 2026-06-10 | fix(ux): address high and medium priority UI/UX issues |
| `b21e823` | 2026-06-10 | fix(polish): improve UI details and visual clarity |
| `65c405d` | 2026-06-10 | feat(theme): add dark mode support with toggle |
| `bf45259` | 2026-06-10 | feat(theme): wire dark mode classes to shell components |
| `5d6b1e6` | 2026-06-10 | Add dark mode variants to InvoiceDetailDrawer component |
| `e56f592` | 2026-06-10 | Add comprehensive project memory.md documentation |
| `84abd91` | 2026-06-10 | Complete dark mode for dashboard and InvoiceDetailDrawer |
| `9d6928e` | 2026-06-10 | Fix dark mode text colors across all dashboard pages |

### Phase 3 — Language consistency
| Commit | Date | Message |
|---|---|---|
| `0612241` | 2026-06-11 | Fixing inconsistent UI language |

### Phase 4 — Multi-persona RBAC (VENDOR / GA_STAFF / GA_MANAGER) + deploy prep
| Commit | Date | Message |
|---|---|---|
| `51bc652` | 2026-06-18 | feat: add VENDOR, GA_STAFF, GA_MANAGER roles and vendor-user link |
| `dc87d56` | 2026-06-18 | feat: migrate to bcrypt, add vendorId to JWT, seed new personas |
| `8b880fc` | 2026-06-18 | feat: RBAC updates for vendor/GA personas with IDOR protection |
| `9f432b5` | 2026-06-18 | feat: update frontend for new personas |
| `cd53dfc` | 2026-06-18 | test: add RBAC tests for new roles and vendor isolation |
| `7460e07` | 2026-06-18 | docs: update memory.md with Phase 9 multi-persona changes |
| `7336cd3` | 2026-06-18 | feat: update login page demo accounts to show all 6 personas |
| `16120a8` | 2026-06-18 | chore: untrack files covered by .gitignore |
| `15e593b` | 2026-06-18 | chore(deploy): option-a vercel prep |
| `ab522b8` | 2026-06-18 | Prepare deployment |

### Phase 5 — Supabase SSL fixes, dashboard dark-mode completion
| Commit | Date | Message |
|---|---|---|
| `da12472` | 2026-06-19 | fix: disable SSL cert verification via env var for Supabase pooler |
| `ee4298c` | 2026-06-19 | fix: use explicit pg Pool to pass SSL options to Prisma adapter |
| `880802f` | 2026-06-19 | fix: use explicit pg Pool to bypass sslmode URL param for Supabase |
| `6e82560` | 2026-06-19 | ui: fix dark mode across KPICard, StatusBadge, TopBar, login page; polish KPI card design |

### Phase 6 — Production hardening: security, validation, docs discipline
| Commit | Date | Message |
|---|---|---|
| `c6f78c4` | 2026-06-25 | docs: add working rules for commit discipline and safety |
| `cc3e443` | 2026-06-25 | chore: un-track local AI tool config and expand gitignore |
| `af7370c` | 2026-06-25 | fix: add Zod validation schemas to invoice API routes |
| `9bae8ea` | 2026-06-25 | fix: sanitize error responses in Python AI service |
| `e2d1151` | 2026-06-25 | fix: add file magic-byte validation to upload endpoint |
| `3fb6592` | 2026-06-25 | feat: add per-user rate limiting to OCR and chat API routes |
| `dd4f708` | 2026-06-25 | feat: add Next.js health check endpoint |
| `7b55a52` | 2026-06-25 | fix: guard seed script against accidental production run |
| `6816f14` | 2026-06-25 | feat: add LLM model override, request timeout, and DeepSeek provider support |
| `6a93202` | 2026-06-25 | chore: move @types/pg to devDependencies |
| `e6c7aed` | 2026-06-25 | docs: create ai-service/.env.example with all provider configs |
| `6abc1a9` | 2026-06-25 | docs: update README with all 8 demo accounts and current approval flow |

### Phase 7 — Dependency pinning, local port fix
| Commit | Date | Message |
|---|---|---|
| `a56ffcd` | 2026-07-02 | fix: change local Postgres port from 5432 to 5434 to avoid conflicts |
| `b7ffd9e` | 2026-07-02 | chore: pin ai-service deps to compatible-release ranges, bump pydantic |

### Phase 8 — Structured docs/ reference, CLAUDE.md discipline rules committed
| Commit | Date | Message |
|---|---|---|
| `e2abc8e` | 2026-07-15 | docs: add structured docs/ reference and fix stale README port |
| `5123c3c` | 2026-07-15 | chore: gitignore and untrack CLAUDE.md alongside AGENTS.md, memory.md |

### Phase 9 — Invoice workflow overhaul, PIC tracking, admin RBAC, Excel export, chat lockdown
| Commit | Date | Message |
|---|---|---|
| `510f452` | 2026-07-15 | fix: correct stale Postgres port reference in docs (5434 -> 5433) |
| `df8a1d3` | 2026-07-15 | feat: replace invoice approval pipeline with 5-status lifecycle |
| `7c683cc` | 2026-07-15 | feat: add dashboard Excel export via exceljs |
| `c2c5f30` | 2026-07-15 | feat: add admin user management (create user, edit role) |
| `8a3fe53` | 2026-07-15 | feat: remove VENDOR access to the AI chat |
| `d64ed16` | 2026-07-15 | feat: wire up sidebar/topbar for the new routes and permissions |
| `4c533df` | 2026-07-15 | feat: add Export to Excel link and Open Invoices card to dashboard page |

### Phase 10 — Manual-QA bugfixes
| Commit | Date | Message |
|---|---|---|
| `6319844` | 2026-07-15 | fix: load ai-service .env via python-dotenv so LLM API keys are read |
| `3d00050` | 2026-07-15 | fix: add missing PIC dropdown to the upload flow for GA_STAFF |
| `490c219` | 2026-07-15 | fix: invoice list rows now navigate to the full editable detail page |
| `b3c79be` | 2026-07-15 | feat: add Fix & Resubmit form for REVISION invoices |
| `e82d76a` | 2026-07-16 | fix: restrict revision-resubmit to vendor, hide PIC from vendor view |

### Uncommitted / in-progress (not part of the log above)
- A stash (`stash@{0}`) exists on `main` titled "WIP on main: e6e09e8 fix: load .env in ai-service via python-dotenv so LLM API keys are read" — not applied to this branch; left untouched pending the user's direction.
