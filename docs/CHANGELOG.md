# Changelog

Two sections, per `CLAUDE.md` convention:
- **Code Changes Made** — running log of what changed and why, newest first. Add an entry here for every task before committing.
- **Commit Log** — the project's git history, grouped by phase for readability. Reconstructed retrospectively on 2026-07-15 since `docs/` did not exist before this file.

---

## Code Changes Made

### 2026-07-27 — DRAFT invoice status (Stage 1 of 5, upload/UX overhaul)
**What:** New `DRAFT` value on `InvoiceStatus` (migration `20260727000000_add_draft_invoice_status`, additive). `POST /api/invoices` now creates the placeholder row as `DRAFT` instead of `SUBMITTED`. `DRAFT` is excluded from: `GET /api/invoices` (unconditionally, regardless of `?status=` filter), `getDashboardStats()` and its two callers (`GET /api/dashboard`, `GET /api/dashboard/export`), and the chat `query_invoices` tool's default query (`geminiChat.ts`). `VALID_TRANSITIONS.DRAFT = [SUBMITTED, CANCELLED]`. `allowedFields()` in `PATCH /api/invoices/[id]` treats `DRAFT` like `REVISION` — the owning `VENDOR`/`GA_STAFF`/`GA_MANAGER` gets the full `CREATE_TIME_FIELDS` set plus `status`, so the wizard's final "Submit" step can both correct the data and transition `DRAFT → SUBMITTED` in one `PATCH`. `isOverdue()` (`src/lib/format.ts`) now also treats `DRAFT` as never-overdue.

**Moved the `invoice_submitted` notification trigger** from `POST /api/invoices` (creation) to `PATCH /api/invoices/[id]` (the `DRAFT → SUBMITTED` transition, gated on the confirming user being `VENDOR` — unchanged from before). `notifyInvoiceSubmitted()` exported from `src/app/api/invoices/route.ts` and imported into the `[id]` route rather than duplicated. The `[id]` route's `PATCH` update query now also includes `vendor: { select: { name: true } }`, needed for the notification's vendor-name text.

**Why:** User-reported gap: closing the browser mid-upload left an empty `DRAFT-{timestamp}` row that showed up in the invoice list, dashboard KPIs/charts, and — worse — had already fired an `invoice_submitted` notification/email to GA Staff for an invoice the vendor never actually finished submitting. This is Stage 1 of a 5-stage plan (upload wizard restructure, mandatory vendor-profile fields, dashboard filters, ID/EN i18n toggle) agreed with the user before starting; later stages build on this status.

**Verified live against local Postgres** (not Supabase — deliberately targeted the local docker DB via inline env overrides to avoid touching the production database without being asked): created a real draft via the API as `vendor1`, confirmed `totalInvoices`/`GET /api/invoices` count unchanged while `DRAFT`, confirmed zero notifications fired at creation; `PATCH`ed `status: SUBMITTED`, confirmed the count incremented and exactly one `invoice_submitted` notification landed for `gastaff`. `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` (50/50 — the 3 new passing cases are the auto-generated `DRAFT → SUBMITTED`/`DRAFT → CANCELLED` transition tests from the existing data-driven `VALID_TRANSITIONS` test, plus one added `isOverdue` case for `DRAFT`).


### 2026-07-27 — Fix: `prisma.config.ts`/`seed.ts` ignored `.env.local`
**What:** Both files loaded env vars via plain `import "dotenv/config"`, which only reads `.env` — never `.env.local`. Whenever both files coexist (the common case: an old `.env` left over from earlier in the project, plus the `.env.local` `docs/SETUP.md` actually documents), `prisma migrate deploy` and `npx tsx prisma/seed.ts` would silently use `.env`'s values, completely ignoring `.env.local` edits, with no error — just the wrong database. Switched both to `@next/env`'s `loadEnvConfig()` (added as an explicit devDependency — was already bundled transitively via `next`), which is the exact mechanism `next dev` itself uses (`.env.local` overrides `.env`), so CLI tooling and the running app now resolve env vars identically. Also gave `seed.ts` the same Supabase-pooler SSL workaround `src/lib/db/prisma.ts` already had (explicit `pg.Pool` + `ssl` option, `sslmode`/`sslaccept` stripped from the URL) — it was building its own `PrismaPg` adapter directly from a connection string with no SSL handling at all, which would have failed against Supabase even after the env-loading fix. Fixed a stale `5434` fallback port in `prisma.config.ts` to `5433`, matching `docker-compose.yml`.

**Why:** User-reported — ran the Supabase deployment guide's migrate/seed steps, got no visible error, but no data appeared in the new Supabase project. Root-caused via a hash comparison of `.env` vs `.env.local`'s `DATABASE_URL` (without ever printing the actual connection string) — confirmed `prisma.config.ts` was resolving to `.env`'s stale value, not `.env.local`'s.

**Not user's config mistake, but flagged one anyway:** while diagnosing, found `DATABASE_URL` in the user's `.env.local` still matched the original local-docker default byte-for-byte — only `DIRECT_URL` had actually been updated to Supabase. Since the app runtime and seed script only ever read `DATABASE_URL` (never `DIRECT_URL`), this needed calling out separately from the code fix — the code fix alone doesn't help if `DATABASE_URL` itself was never pointed at Supabase.

**Also removed** the stale `.env` file (untracked/gitignored, dated 2026-07-15, fully superseded by `.env.local`) per user request, to prevent this exact class of bug from recurring.

**Verified:** `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` (47/47) all pass. Confirmed the fix's *precedence logic* via SHA-256 hash comparison of `.env`/`.env.local`/resolved values — never printed a real secret to verify. Did not run `migrate deploy`/`seed` against the user's live Supabase project myself (would mutate their real external database without being explicitly asked to in that moment); left for the user to re-run and confirm.

### 2026-07-26 — Supabase Storage, Gemini OCR/chat, Resend email — retired the Python ai-service
**What:** Added `@supabase/supabase-js`, `@google/genai`, `resend` (explicit user approval per `CLAUDE.md`'s new-dependency rule). Removed `ai-service/` entirely (Python FastAPI + Tesseract + LangChain, explicit user approval — a separate destructive-action confirmation since it deletes tracked files).

**File storage** (`src/lib/services/fileService.ts`): `saveUploadedFile()`/new `getFileBuffer()` use Supabase Storage (private `invoices` bucket, service-role key) when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set, else fall back to local disk — same fallback behavior dev has always had, but now Vercel-capable when configured. `filePath` is now always the bare `{invoiceId}.{ext}` object key (previously the local-disk build stored a full absolute path) — server-derived from `invoiceId`, never user input, so the old path-traversal confinement check in `GET /api/invoices/[id]/file` was removed as dead code rather than kept as defense with nothing to defend against. That route's Vercel-503 special case is also gone — Supabase Storage works on Vercel, so there's no longer a deployment target where file serving is impossible.

**OCR** (`src/lib/services/geminiExtraction.ts`): `GET /api/invoices/[id]/ocr` now reads the file via `getFileBuffer()` and calls `extractInvoiceFields()` — one Gemini vision call reads the PDF/image directly (`responseSchema`-enforced JSON output), replacing the old two-step Tesseract-text → LangChain-LLM pipeline. Output shape (`{field: {value, confidence}}[]` + `line_items` + `overall_confidence`) and the `overall_confidence` formula (average of the 7 core fields' confidence, excluding currency, over non-null values) were kept identical to the old `ai-service/app/api/ocr.py` so no other code — the SSE event stream, the DB write, the frontend confidence bars — needed to change.

**Chat** (`src/lib/services/geminiChat.ts`): `POST /api/chat` now calls `runChat()` directly. Defines a `query_invoices` function declaration (filters: status, vendorName, companyName, overdueOnly, due date range, limit) that Gemini calls when a question needs real data; the route runs an actual Prisma query and returns matched invoices plus a server-computed `totalMatched`/`sumTotalAmount` so aggregate questions (totals, counts) stay accurate even past the returned list's cap, then feeds the result back to Gemini as a `FunctionResponse` for a final answer. Per the user's explicit correction earlier this session, the query is **not** scoped to any particular status — chat can answer about any invoice, gated only by the route's existing `ADMIN`/`GA_MANAGER`-only `requireRole`. This replaces the old static-context-string prompt (which answered from the model's general knowledge, not the database) — the actual point of `docs/PRODUCTION_PLAN.md` §5.2.

**Email** (`src/lib/services/email.ts`): `sendEmail(to, subject, html)` via Resend, no-ops silently (not an error) when `RESEND_API_KEY` is unset — reminder triggers call it unconditionally and shouldn't fail (or crash the daily cron) over missing config. Wired into all three existing notification triggers, each gated independently from its in-app counterpart via the same `ReminderSetting` row: `checkDueDates()` (due_soon/overdue — restructured so `isActive && (inAppEnabled || emailEnabled)` gates the invoice scan, with `inAppEnabled`/`emailEnabled` then independently gating each channel, where previously `inAppEnabled` alone gated the whole block and email had no path at all), `notifyInvoiceSubmitted()`, `notifyRevisionRequested()`. Recipients = the same role/vendor-scoped user list already computed for in-app notifications, plus each setting's `extraEmails`.

**Why:** Completes the three pieces of `docs/PRODUCTION_PLAN.md` deferred at the CI checkpoint pending user approval for new dependencies and credentials — user approved all three (Supabase Storage, Gemini OCR+chat, Resend) plus removing `ai-service/` in the same session.

**Env vars** (all optional — each integration degrades gracefully without its key, verified below): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Added to `.env.example` (new file) and as empty placeholders in `.env.local`, which is gitignored — no real key values were ever available to or handled by the assistant, since credentials aren't something that should be pasted into a chat session even a private one.

**Verified live against the real running dev server and local Postgres, deliberately without real credentials** (none were available — the point was confirming graceful degradation, not full round-trips through Gemini/Supabase/Resend, which the user still needs to do once they add real keys): logged in as `vendor1` via the real NextAuth flow, created a draft invoice, uploaded a PDF — confirmed `filePath` came back as the new bare `{id}.pdf` object key (local-disk fallback, no `SUPABASE_URL` set), downloaded it back through `GET /api/invoices/[id]/file` and diffed it byte-for-byte against the original upload (identical), confirmed `vendor2` still gets 403 on `vendor1`'s file. Hit `GET /api/invoices/[id]/ocr` without `GOOGLE_API_KEY` — got a clean SSE `error` event (`"GOOGLE_API_KEY is not configured"`), not a crash or a hung stream. Hit `POST /api/chat` the same way — got the existing friendly-fallback `{answer: "..."}` response, 200, not a 500. Ran the real cron route (`GET /api/cron/reminders` with the correct `CRON_SECRET`) and the two inline triggers (created an invoice as `vendor1`, transitioned it to `REVISION` as `admin`) with the new email code path active and no `RESEND_API_KEY` set — all three completed 200/201 with no error, confirming the no-op path doesn't break the request it's attached to. Full `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` (47/47), and `npm run build` (real production build, not just typecheck) all pass.

**Found and fixed along the way, unrelated to the new integrations:** `new NextResponse(buffer, ...)` in the file-serving route started failing `tsc` once `buffer` came from a function with an explicit `Promise<Buffer>` return-type annotation instead of a directly-inferred `readFile()` call — a real (if obscure) TypeScript/Node-types quirk where an explicitly-annotated `Buffer` return type doesn't structurally satisfy `BodyInit` the same way an inferred one does, reproduced in isolation before concluding it wasn't caused by the new dependencies. Fixed by wrapping in `new Uint8Array(buffer)`, which is unambiguously `BodyInit`-compatible regardless of how the `Buffer` was produced.

### 2026-07-26 — GitHub Actions CI (typecheck/lint/test on every push and PR)
**What:** New `.github/workflows/ci.yml` — on `push` to `main` and every `pull_request`: `npm ci` → `npx prisma generate` (schema-only, no live DB needed) → `npx tsc --noEmit` → `npm run lint` → `npm test`. Node 22, npm-cached.

**Fixed the pre-existing lint errors this surfaced** (none newly introduced — `npm run lint` had never been run clean across the whole repo before, only spot-checked per file): `src/hooks/useTheme.ts` had `applyTheme` referenced before its declaration and two `setState`-in-effect calls flagged by `eslint-plugin-react-hooks`'s newer rules — reordered `applyTheme` above the effect, and scoped `eslint-disable-next-line` on the two calls that are the standard client-only-hydration pattern (reading `localStorage`/`matchMedia` can't move into a lazy `useState` initializer without a server/client render mismatch). The same `setState`-in-effect pattern (an effect calling a `useCallback`/function that sets a loading flag before its async fetch — a legitimate, common data-fetch-on-mount shape) recurs in `audit/page.tsx`, `invoices/[id]/page.tsx`, `invoices/upload/page.tsx`, `reminders/page.tsx`, and the new `vendor/profile/page.tsx`; same scoped-disable treatment. `invoices/upload/page.tsx` also had `runOCR` (a hoisted `function` declaration, safe at runtime) referenced by an earlier `useCallback` — disabled `react-hooks/immutability` at the one call site rather than relocating a 90-line function. Two `<p>`/`<div>` apostrophes in `vendor/profile/page.tsx` needed `&apos;` (`react/no-unescaped-entities`). Two `any`-typed Prisma `where` clauses (`api/audit/route.ts`, `api/invoices/route.ts`) replaced with `Prisma.AuditLogWhereInput`/`Prisma.EnumInvoiceStatusFilter['equals']`.

**Why:** `CLAUDE.md` requires unit tests before finishing tasks; a CI workflow makes that automatic on every push/PR instead of relying on remembering to run it locally. Fixing the lint errors it surfaced was necessary — a CI job that fails on its first run against `main` isn't useful, and none of these were touched by unrelated refactoring beyond what made the rule pass.

**Verified locally by running the exact 4 CI steps against this working tree:** `npx prisma generate` (105ms, no DB connection attempted), `npx tsc --noEmit` (clean), `npm run lint` (0 errors, 1 pre-existing unused-arg warning on `notifications/route.ts`'s `PATCH(req)` — Next.js route handlers require the parameter even when unused, left as-is), `npm test` (47/47 passing, 5 files). Did not push a branch to actually trigger GitHub Actions — that requires the repo's Actions to be enabled/observed on GitHub, outside local verification.

### 2026-07-26 — Admin-editable reminder settings, replacing hardcoded thresholds (3f)
**What:** New `ReminderSetting` model (`reminder_settings` table, unique `type`) — one row per notification type (`due_soon`, `overdue`, `invoice_submitted`, `revision_requested`), each with `isActive`, `daysBefore` (only meaningful for `due_soon`), `recipientRoles` (JSON array of `Role`), `extraEmails`, `emailEnabled`, `inAppEnabled`, and a server-assigned `updatedById`. New `GET /api/admin/reminders` + `PATCH /api/admin/reminders/[type]` (`ADMIN`-only, writes `audit_logs`). New `/admin/reminders` page — one card per type with an active toggle, days-before input (`due_soon` only), a role multi-select, a comma-separated extra-emails field, and separate email/in-app switches. Per the plan, deliberately **no** send-time/frequency controls — Vercel Hobby's cron cap means only "once daily" is actually deliverable, and a UI promising more would be a lie.

`reminderScheduler.ts`'s `checkDueDates()` rewritten to read `daysBefore`/`recipientRoles`/`isActive`/`inAppEnabled` from the `due_soon`/`overdue` rows instead of the module-level constants it had before (`OPEN_STATUSES` for status filtering stays hardcoded — that's app-model, not admin policy).

**Extended scope beyond a settings-CRUD page — wired two more triggers that don't need Resend:** `invoice_submitted` (fires in `POST /api/invoices` when the creator is `VENDOR`) and `revision_requested` (fires in `PATCH /api/invoices/[id]` when `status → REVISION`, always targeting the invoice's own `VENDOR` users regardless of `recipientRoles` — that field only applies to the other three types) now write real `notifications` rows, gated by their settings row's `isActive`/`inAppEnabled`. These were previously undocumented gaps — no in-app notification existed for either event at all. `emailEnabled` is stored and surfaced in the UI but not yet acted on anywhere; that's the thin layer that gets added once Resend is approved, without touching this notification-creation logic.

**Why:** User request (3f) — the two thresholds (due-soon window, recipient list) previously required a code change + deploy to adjust. The `invoice_submitted`/`revision_requested` wiring directly serves the reminder-email feature request's own stated triggers (`docs/PRODUCTION_PLAN.md` §6.2), just via in-app notifications for now instead of email.

**Verified live against real Postgres and real sessions:** confirmed all 4 default rows seed correctly; `PATCH` as `ADMIN` updates `daysBefore`/`emailEnabled`/`extraEmails` and stamps `updatedById`; `GA_STAFF` gets 403 on both `GET` and `PATCH`; an unknown `type` 404s before validation runs; the cron route picks up a changed `daysBefore` on the next call; a real `vendor1` invoice creation produces an `invoice_submitted` notification for `gastaff`; a real `REVISION` transition produces a `revision_requested` notification for the vendor; and — the actual suppression test — disabling the `revision_requested` row via `PATCH`, then triggering the same transition again, produced **zero** new notifications (count unchanged before/after), confirming the gate actually gates.

### 2026-07-26 — Forced password change for admin-created accounts + active toggle (3a)
**What:** `User.mustChangePassword` (bool, default `true`; migration `20260726181558_add_must_change_password`). `POST /api/users` now creates accounts that must set their own password before reaching anything else — `middleware.ts` redirects every page route to `/change-password` while the flag is true (API routes stay reachable — the change-password call itself is one). New `PATCH /api/users/me/password` (verifies `currentPassword`, rehashes, clears the flag, writes `audit_logs`). New `/change-password` page.

**The stale-JWT problem and how it's handled:** NextAuth JWT sessions are stateless, so clearing the DB flag alone wouldn't update the session the user is already holding — they'd stay gated until the token's natural expiry. Fixed with NextAuth's `trigger: 'update'` mechanism: `/change-password` calls the client-side `update()` after a successful password change, which POSTs to `/api/auth/session` and re-runs `auth.ts`'s `jwt` callback with `trigger === 'update'`, re-reading `mustChangePassword` from the DB and re-encoding the cookie. Had to fix this in **two places**, not one — `middleware.ts` runs against the separate Edge-safe `authConfig` (no DB access), which has its own `jwt`/`session` callbacks that only forwarded `id`/`role` onto `session.user`; `mustChangePassword` had to be added there too or middleware would never see it even though the full `auth.ts` config set it correctly.

Also wired up the admin users page's previously-static "Yes/No" Active column into a clickable toggle (`PATCH /api/users/[id]` with `{isActive}` — that endpoint already accepted the field, just had no UI control).

Demo seed accounts (`prisma/seed.ts`) explicitly set `mustChangePassword: false` on all 6 — otherwise the shared `demo123` quick-login buttons on the login page would force a password reset on every demo account's first use, breaking the documented demo flow.

**Why:** User request (3a) — the remaining gap from the existing admin-user-creation flow, per `docs/PRODUCTION_PLAN.md` §6.1 (welcome-email delivery is the other listed gap, deferred pending the Resend decision).

**Verified live end-to-end, not just compiled:** confirmed demo `admin@demo.com` logs in and reaches the dashboard without any redirect (seed's `false` flag holds); created a real user via `POST /api/users`, logged in as them, confirmed the session correctly carried `mustChangePassword: true`, confirmed a page route redirected to `/change-password` while an API route (`GET /api/invoices`) did not; confirmed a wrong `currentPassword` is rejected 400; confirmed a correct change succeeds and the JWT stays stale until the `update()` call is simulated (`POST /api/auth/session`), after which the session flips to `false` and the dashboard becomes reachable in the same request round-trip.

### 2026-07-26 — Vendor profile: extended fields, VendorContact, self-service editing (3e)
**What:** `Vendor` gains `address`/`city`/`phone`/`bankAccountHolder`/`bankBranch` (migration `20260726180556_extend_vendor_profile`). New `VendorContact` model (`vendor_contacts` table, cascade-deletes with its vendor) — a vendor can have several PICs (finance, sales, ops), kept as a separate table rather than flat fields.

New endpoints: `POST /api/vendors` (`ADMIN`-only — creates the `Vendor` entity a `VENDOR`-role user account later links to via `POST /api/users`, a separate step); `GET/PATCH /api/vendors/[id]`; `GET/POST /api/vendors/[id]/contacts`; `DELETE /api/vendors/[id]/contacts/[contactId]`. `GET /api/vendors` (list) now scopes `VENDOR`-role callers to their own vendor only — previously returned the full list to everyone. `PATCH` uses the same field-aware-not-flat-role-gate pattern as invoices (`allowedVendorFields()`): `name`/`npwp` are `ADMIN`-only (they're used to match tax documents — a vendor renaming itself would break that audit trail), everything else is self-editable by `ADMIN`/`GA_STAFF`/`GA_MANAGER` for any vendor, or by the linked `VENDOR` for their own record only.

New `/admin/vendors` page (create — `ADMIN` only — plus an expandable per-row edit panel with a contacts sub-list, open to `ADMIN`/`GA_STAFF`/`GA_MANAGER`) and `/vendor/profile` (self-service page for `VENDOR`, name/npwp shown read-only with a lock icon and an explanatory note, rest editable, own contacts manageable).

**Resolved a conflict in my own plan while implementing:** `docs/PRODUCTION_PLAN.md` §6.5's prose said vendor-data editing is `ADMIN, GA_STAFF` only, but its own §11 role-matrix table listed `GA_MANAGER` as included. Went with including `GA_MANAGER` — consistent with the pattern established everywhere else this session (`GA_MANAGER` mirrors `GA_STAFF`'s operational permissions plus supervisory extras), and matches the more-recently-written summary table.

**Why:** User request (3e) — vendor's own detail data (address, bank account, PICs) editable by the vendor after being seeded by admin; name/NPWP locked since they anchor tax-document matching.

**Verified live against real Postgres and real sessions across three roles:** as `VENDOR`, confirmed a `name`/`npwp` change is silently dropped while `city`/`phone` in the same request still applies (partial-field filtering, not a hard reject); confirmed `GET /api/vendors` returns only the caller's own vendor; confirmed `GET`/`PATCH` on a different vendor's real id both return 403 (tested against an actual second vendor id, not just a malformed one); confirmed adding a contact works. As `GA_STAFF`: confirmed `POST /api/vendors` (create) is blocked 403 (`ADMIN`-only) while `PATCH` on an existing vendor's non-locked field succeeds, and a `name`-only `PATCH` correctly 403s (filtered field list ends up empty).

### 2026-07-26 — Company model: bill-to entity selection (3c/3d)
**What:** New `Company` model (`companies` table, migration `20260726175202_add_companies`) — the invoice-receiving entity ("bill-to"), distinct from `Vendor` (the sender). `Invoice.companyId` is a nullable FK (nullable by design, not backfill laziness — avoids forcing a value onto rows that predate the feature; see `docs/PRODUCTION_PLAN.md` §6.3). New `GET/POST /api/companies` and `PATCH/DELETE /api/companies/[id]`, writes/deletes restricted to `ADMIN`/`GA_STAFF` (`GA_MANAGER` explicitly excluded — matches the plan's own permission matrix, which the Sidebar nav had drifted from, see below); `DELETE` soft-deletes (`isActive = false`) so existing invoice references stay valid. `GET` is open to any authenticated user, including `VENDOR` — it populates the upload wizard's company dropdown.

New `/admin/companies` page (create/list/deactivate). Upload wizard: `VENDOR` gets a required company `<select>` in the review step (same pattern as the existing `sendDate`/`picId` fields — collected after the draft invoice exists, submitted via the confirm `PATCH`, not at initial draft-creation time). Invoice detail page shows "Bill to: {company.name}". Excel export gains a Company column. `allowedFields()` in `PATCH /api/invoices/[id]` grants `companyId` alongside the other `CREATE_TIME_FIELDS` (editable during the same review/resubmit window as `invoiceNumber`/`totalAmount`/etc.).

**Found and fixed while wiring up the Sidebar:** I'd added `/admin/companies` to `GA_MANAGER`'s nav roles in an earlier commit this session, ahead of actually building the feature — but the plan (§6.4, and the role matrix in §11) restricts company management to `ADMIN`/`GA_STAFF` only. Caught by re-reading the plan before implementing; corrected before it ever shipped inconsistently.

**Why:** User request (3c/3d) — vendor picks which PT an invoice is billed to at submission time; admin/GA Staff manage the PT list.

**Verified live against real Postgres and real sessions:** applied the migration, restarted the dev server for the regenerated Prisma client, reseeded (2 demo companies, cycled across all 20 seed invoices by index). Then, through the real API: created/patched/soft-deleted a company as `ADMIN` and confirmed the soft-deleted one disappears from the default `GET` but still appears with `?includeInactive=true`; confirmed `GA_MANAGER` and `VENDOR` both get 403 on `POST /api/companies` but 200 on `GET`; and ran the actual wizard sequence as `vendor1` — created a draft (`companyId: null`), then `PATCH`ed with a real `companyId`, then confirmed `GET` returns the fully populated `company` relation.

### 2026-07-26 — Payment tracking: PAID status, paidDate/paidAmount/paidBy
**What:** `InvoiceStatus` gets `PAID` back (additive `ALTER TYPE ... ADD VALUE`, migration `20260726173942_add_payment_tracking` — no type-swap needed since adding an enum value doesn't require one, unlike the role removal migration). `Invoice` gains `paidDate`, `paidAmount` (`Decimal(15,2)`), `paidById` (FK → `users.id`). `VALID_TRANSITIONS`: `SUBMITTED → {..., PAID}`, `PAID → []` (terminal). `allowedFields()` in `PATCH /api/invoices/[id]` grants `paidDate`/`paidAmount` to `GA_STAFF`/`GA_MANAGER` unconditionally (not gated on `isEditor` — marking paid isn't tied to who created the invoice). The route sets `paidById` **server-side only** (session user id, never from the request body) and defaults `paidDate`/`paidAmount` to `now()`/`totalAmount` when the caller omits them, so a partial-payment amount can still be recorded explicitly.

UI: invoice detail page gets a "Tandai Lunas" card (paid date + amount inputs, defaults pre-filled) shown to `GA_STAFF`/`GA_MANAGER`/`ADMIN` while `status = SUBMITTED`; once paid, the same slot shows a read-only paid-date/amount/marked-by summary. `PAID` is deliberately excluded from the generic status-update dropdown (which has no fields for paidDate/paidAmount) so there's exactly one path that can set it. `StatusBadge` and the invoices-list status filter both get a `PAID`/"Lunas" entry. Excel export gains Paid Date/Paid Amount columns.

**Found and fixed while touching this area:** `isOverdue()` (`src/lib/format.ts`) excluded `CANCELLED`/`REJECTED`/`VOID` from the overdue check but not `PAID` — a paid invoice past its due date would have displayed as overdue. Added `PAID` to the terminal-status list. Also added `src/lib/__tests__/format.test.ts` (7 cases), which this function had no coverage for before.

**Why:** User decision — chatbot needs a real payment signal to answer "which invoices are unpaid" honestly (`SUBMITTED` means "outcome unknown", not "unpaid" — see `docs/PRODUCTION_PLAN.md` §5.2/§5.3). No payment gateway integration; this is a manual record of an outcome decided outside the app, same pattern as `CANCELLED`/`REJECTED`/`VOID`.

**Known pre-existing issue found, not fixed (out of scope for this task):** `seed.ts`'s invoice-creation loop only ever assigns `createdById` to `gaStaff` or `gaManager` (`d.creator === 'gastaff' ? gaStaff : gaManager`), even for the ~14 entries tagged `creator: 'vendor'` — so those "vendor-created" demo invoices are actually attributed to a GA_MANAGER user, not an actual vendor user. Predates this session (the ternary was already binary before the role-simplification commit touched this line); demo-data cosmetic issue only, no functional impact.

**Verified live against real Postgres and a real session, not just compiled:** applied the migration to the local dev DB, regenerated the Prisma client, restarted the dev server (caught a stale-Prisma-client 500 from the long-running dev process — `Unknown field paidBy for include statement` — until restarted with the freshly generated client), reseeded, then through the actual NextAuth login flow: marked a real `SUBMITTED` invoice `PAID` as `GA_STAFF` with no `paidAmount` supplied (confirmed it defaulted to `totalAmount` and `paidById` matched the logged-in user's real id), confirmed `PAID → PAID` is rejected 400 ("Cannot transition from PAID to PAID"), and confirmed a `VENDOR` attempting to mark their own invoice paid gets 403.

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

### Phase 11 — Production-readiness plan execution: role simplification, payment tracking, Company/Vendor/Reminder features
| Commit | Date | Message |
|---|---|---|
| `cd753a6` | 2026-07-26 | fix: remove duplicate const url declaration blocking build |
| `5c19eb6` | 2026-07-26 | docs: add production readiness plan |
| `d0627ec` | 2026-07-26 | refactor: simplify role model from 7 to 4 roles |
| `d1e46f7` | 2026-07-26 | refactor: replace node-cron with Vercel Cron for reminders |
| `117302b` | 2026-07-26 | refactor: notification bell polls instead of holding an SSE stream |
| `d4e6b1c` | 2026-07-26 | refactor: rate limiter uses lazy sweep instead of setInterval |
| `6c8e47a` | 2026-07-26 | chore: downgrade local dev Postgres image from pgvector to plain |
| `7764daa` | 2026-07-26 | feat: add payment tracking (PAID status) |
| `bc92958` | 2026-07-26 | feat: add Company model for vendor bill-to selection (3c/3d) |
| `7889ba2` | 2026-07-26 | feat: vendor profile self-service editing (3e) |
| `a067057` | 2026-07-26 | feat: force password change for admin-created accounts (3a) |
| `3f32262` | 2026-07-26 | feat: admin-editable reminder settings (3f) |

### Phase 12 — Supabase Storage, Gemini OCR/chat, Resend email; CI
| Commit | Date | Message |
|---|---|---|
| `ec0eee2` | 2026-07-26 | chore: add GitHub Actions CI running tsc/lint/test |
| `a37d4fb` | 2026-07-26 | feat: Supabase Storage, Gemini OCR/chat, Resend email; retire ai-service |
| `6681d1a` | 2026-07-26 | docs: record commit log entries for CI and the AI-service migration |

### Phase 13 — Merged to main, deploy prep fixes
`feat/deploy-ready` fast-forward merged into `main` at `27745ba` (no merge commit — main had no divergent commits) and pushed; `main` is now the deploy branch for the fresh Vercel/Supabase project.
| Commit | Date | Message |
|---|---|---|
| `f7c8a27` | 2026-07-26 | chore: gitignore .agents/ and skills-lock.json |
| `7d2e2e4` | 2026-07-26 | docs: document DIRECT_URL and clarify CRON_SECRET behavior on Vercel |
| `27745ba` | 2026-07-26 | chore: remove obsolete version key from docker-compose.yml |
| `4e03b10` | 2026-07-27 | fix: load .env.local in prisma.config.ts and seed.ts, not just .env |

## Commit Log

Full history of `main` (current branch — `feat/deploy-ready` was fast-forward merged into it at `27745ba`, see Phase 13), grouped by phase. Older deploy attempts live on separate branches (`deploy/option-a`, `deploy/option-b`, `chore/cleanup-tracked-files`) with their own merge commits, omitted here.

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
