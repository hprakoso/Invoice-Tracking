# Changelog

Two sections, per `CLAUDE.md` convention:
- **Code Changes Made** — running log of what changed and why, newest first. Add an entry here for every task before committing.
- **Commit Log** — the project's git history, grouped by phase for readability. Reconstructed retrospectively on 2026-07-15 since `docs/` did not exist before this file.

---

## Code Changes Made

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

### Uncommitted / in-progress (not part of the log above)
- A stash (`stash@{0}`) exists on `main` titled "WIP on main: e6e09e8 fix: load .env in ai-service via python-dotenv so LLM API keys are read" — not applied to this branch; left untouched pending the user's direction.
