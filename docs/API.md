# API Reference

All Next.js routes live under `src/app/api/`. Every route calls `requireAuth()` or `requireRole([...])` from `src/lib/auth/helpers.ts` first (401/403 on failure) unless noted. Response fields are traced to their source per `CLAUDE.md` — `table.column` for stored data, `formula` for computed values, `Not Stored` for pass-through/ephemeral data.

## Invoices

### `GET /api/invoices`
Auth: any authenticated user. `VENDOR` role is server-forced to `where.vendorId = session.user.vendorId` (query-param `vendorId` is ignored for vendors — prevents IDOR).

Query params: `status`, `search` (matches `invoice_number`, case-insensitive), `from`/`to` (filters `due_date`), `vendorId` (non-vendor roles only).

| Response field | Source |
|---|---|
| `id`, `vendorId`, `invoiceNumber`, `poNumber`, `invoiceDate`, `dueDate`, `sendDate`, `deliveredDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount`, `status`, `picStage`, `ocrConfidence`, `filePath`, `fileType`, `notes`, `createdById`, `createdAt`, `updatedAt` | `invoices.*` (1:1 column mapping, camelCase via Prisma `@map`) |
| `vendor.id`, `vendor.name` | `vendors.id`, `vendors.name` |
| `createdBy.id`, `createdBy.name` | `users.id`, `users.name` |
| `pic.id`, `pic.name` | `users.id`, `users.name` via `invoices.pic_id` — this is *who*, distinct from `picStage` (*which team*) |
| `items[]` | `invoice_items.*` where `invoice_id = invoices.id`, ordered by `sort_order` |

### `POST /api/invoices`
Auth: `ADMIN`, `VENDOR`, `GA_STAFF`, `GA_MANAGER`. Body validated by `createInvoiceSchema` (Zod, `src/lib/validations.ts`) — `poNumber` is required. `VENDOR` role: `vendorId` is forced to `session.user.vendorId`, ignoring any client-supplied value; other roles pick the vendor explicitly from a dropdown in the wizard's first step — there is deliberately no "default to the first vendor" fallback (that was a real bug: an invoice could get attributed to the wrong vendor). `GA_STAFF`: `picId` defaults to the creating user (they're the hardcopy's first handler), overridable via `data.picId`. `companyId` (which PT/entity the invoice bills) is schema-optional but the upload wizard always collects it upfront, before the file is even chosen — it's sent in this same `POST` call, not deferred to the later `PATCH` review step.

Writes: `invoices` row (`status = 'RECEIVED'`, `pic_stage` from body or default `'GA'`, `send_date` from body, `pic_id` per above, `created_by` = session user id), `invoice_items` rows, one `invoice_stage_history` row (`stage = picStage`, `changed_by_id` = session user id), `audit_logs` row (`action: 'invoice.created'`, `metadata: { invoiceNumber }`).

> **Known gap:** the row created here is immediately live and visible everywhere — there's no "invisible until confirmed" draft state — so a user abandoning the upload wizard mid-flow leaves a real `RECEIVED` invoice behind carrying a `DRAFT-<timestamp>` placeholder number. The related *orphaned duplicate on retry* bug is fixed (the wizard now reuses the existing row instead of re-POSTing), but a genuinely abandoned session still leaves one row behind.

### `GET /api/invoices/[id]`
Auth: any authenticated user; `VENDOR` gets 403 if `invoice.vendorId !== session.user.vendorId`.

Adds to the list-response shape above: `vendor` (full row, not just `id`/`name`), `company` (full `companies` row, nullable), `createdBy.role`, `pic.role`, `paidBy.{id,name,role}` (who marked it paid, via `invoices.paid_by`), `stageHistory[]` (`invoice_stage_history.*` for this invoice, ordered by `changed_at` ascending — the source for the detail page's per-stage duration display). `pic` is forced to `null` for `VENDOR` callers — the PIC (GA Staff handling the hardcopy) is internal-only, not vendor-facing.

### `PATCH /api/invoices/[id]`
Auth: any authenticated user — authorization is field- and status-aware, not a flat role gate. Body validated by `updateInvoiceSchema`. The server computes which of the submitted fields the caller's role may write given the invoice's current `status` (`allowedFields()` in the route), silently drops the rest, and 403s if nothing survives:

| Role | Writable fields | When |
|---|---|---|
| `VENDOR` (own invoice only) | `invoiceNumber`, `poNumber`, `invoiceDate`, `dueDate`, `subtotal`, `taxAmount`, `totalAmount`, `notes`, `companyId`, `sendDate` | while `status` is not terminal (`CLOSED`/`REJECTED`) |
| `GA_STAFF`, `GA_MANAGER` (any invoice) | `deliveredDate`, `picId`, `sendDate`, `status`, `paidDate`, `paidAmount` | always |
| `GA_STAFF`, `GA_MANAGER` (invoice they created) | + the same core fields as `VENDOR` above | while `status` is not terminal |
| `ADMIN` | all fields, bypasses both `allowedFields()` and the `VALID_TRANSITIONS` table | — |

`VENDOR` cannot change `status` at all — there is no self-service resubmit flow (unlike the old `REVISION → SUBMITTED` model, removed with the 2026-09-01 status overhaul).

Any `status` change is checked against `isValidStatusTransition()` (`src/lib/invoiceStatus.ts::VALID_TRANSITIONS`, skipped for `ADMIN`) — 400 with `{ error: 'Invalid status transition', from, to }` if not a valid edge. See [ARCHITECTURE.md](./ARCHITECTURE.md#invoice-status-lifecycle) for the full graph. Any `sendDate`/`deliveredDate` change is checked against `validateDeliveryDates()` (deliveredDate ≥ sendDate).

**Duplicate auto-rejection.** When this `PATCH` changes `invoiceNumber`, the server first looks for another invoice with the same `vendorId` + `invoiceNumber` (case-insensitive, excluding `status = 'REJECTED'`). This is the only point a duplicate can be detected — at `POST /api/invoices` the number is still a `DRAFT-<timestamp>` placeholder, so a failed upload retried against the same row is never mistaken for a duplicate.

On a match, the update is **still saved** (so the row isn't stranded with a placeholder number and no way to reach it) but `status` is **forced to `REJECTED`** regardless of what the caller asked for, `paidDate`/`paidAmount`/`paidById` are not applied, and a line is appended to `invoices.notes`: `Auto-rejected: duplikat dari invoice {number} (id {id})`. Writes `audit_logs` with `action: 'invoice.auto_rejected'` and `metadata: { from, to: 'REJECTED', reason: 'duplicate', duplicateOfId, duplicateOfNumber }`. The response body gains a `duplicateOf: { id, invoiceNumber }` field — **Not Stored** on the invoice, present only so the client can explain the rejection instead of showing a generic success toast (a duplicate returns **200, not 4xx**, so clients must check this field rather than relying on the status code).

Match key is deliberately vendor-scoped, **not** company-scoped: the same vendor reusing an invoice number across different bill-to companies still counts as a duplicate. `REJECTED` rows are excluded so a rejected duplicate doesn't permanently burn the number.

The application check and the write aren't atomic, so a concurrent submission can claim the number in between; the partial unique index `invoices_vendor_invoice_number_active_uidx` (migration `20260902000000_invoice_duplicate_guard`) turns that race into a Prisma `P2002`, which the route catches and funnels into the same auto-reject path.

**Marking an invoice `PAID`** (`PAYMENT_SCHEDULED → PAID` is the only valid entry — see `VALID_TRANSITIONS`; `GA_STAFF`/`GA_MANAGER`/`ADMIN` only, never reachable by `VENDOR` since `status` isn't in its writable-fields list at all): `invoices.paid_by` is **always server-assigned** to `session.user.id`, never client-supplied. `paidDate` defaults to `now()` and `paidAmount` defaults to `invoices.total_amount` when the caller omits them (partial-payment amounts can still be supplied explicitly). `PAID`'s only outbound edge is `→ CLOSED`.

Writes: `invoices` row (partial update, only the filtered/allowed fields). `audit_logs` — `action: 'invoice.status_changed'` with `metadata: { from, to, comment }` (the optional `comment` field is **Not Stored** on the invoice itself, only in this audit metadata) when `status` changes, else `action: 'invoice.updated'` with `metadata: { fields: [...changed keys] }`. Any status change also fires the `status_changed` reminder trigger, notifying the invoice's own vendor — see § Invoice-event notifications.

### `PATCH /api/invoices/[id]/stage`
Auth: `ADMIN`, `GA_STAFF`, `GA_MANAGER` (vendors are read-only on `picStage`). Body validated by `updateInvoiceStageSchema` (`{ stage: PICStage }`) — no transition restriction, any of the 5 stages is reachable from any other (unlike `status`, this is a free control).

Writes: `invoices.pic_stage`, a new `invoice_stage_history` row (`stage`, `changed_by_id` = session user id, `changed_at` = `now()`), `audit_logs` (`action: 'invoice.stage_changed'`, `metadata: { stage }`). No reminder notification fires here yet — see the approved plan's Item D4 (not yet implemented).

### `DELETE /api/invoices/[id]`
Auth: `ADMIN` only. **Hard delete** — the row is actually removed (there is no `CANCELLED` status in the current `InvoiceStatus` enum to soft-cancel into). Writes `audit_logs` (`action: 'invoice.deleted'`) before the delete.

### `POST /api/invoices/[id]/upload`
Auth: `ADMIN`, `VENDOR`, `GA_STAFF`, `GA_MANAGER` (vendor scoped to own invoices — 403 otherwise). Validates: MIME type allowlist (`pdf`/`jpeg`/`jpg`/`png`), magic-byte signature check against the claimed extension (prevents MIME spoofing), 10MB max size.

Writes: file to `uploads/invoices/` via `saveUploadedFile()` (`src/lib/services/fileService.ts`), `invoices.file_path`, `invoices.file_type` (status is untouched), `audit_logs` (`action: 'invoice.file_uploaded'`, `metadata: { fileName, fileType }`). One file per invoice — re-uploading overwrites the previous file at the same derived path (`{invoiceId}.{ext}`); see the approved plan's Item C for the planned multi-file model (not yet implemented).

### `GET /api/invoices/[id]/ocr` (SSE stream)
Auth: any authenticated user, rate-limited **5 requests/min/user** (`src/lib/rate-limit.ts`). Streams `status`, `field`, `line_items`, `done`/`error` events.

| Streamed field | Source |
|---|---|
| `field.value`, `field.confidence` (per invoice field) | Gemini vision extraction response (`extractInvoiceFields()`, `src/lib/services/geminiExtraction.ts`) — **Not Stored** as a distinct field, only the final parsed values persist |
| Persisted after stream: `invoiceNumber`, `invoiceDate`, `dueDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount` | Written to `invoices.*` from the Gemini response, falling back to existing DB value if the field wasn't extracted |
| `ocrConfidence` | `invoices.ocr_confidence` ← `overall_confidence`, computed in `extractInvoiceFields()` as the average confidence of the 7 core fields that came back non-null (same formula the old Python service used) |
| Line items | `invoice_items.*` — existing rows for the invoice are deleted and replaced from `line_items[]` in the Gemini response |

OCR never changes `invoices.status` on success or error — the invoice stays `RECEIVED` (its status at creation) throughout; the frontend review step (`PATCH /api/invoices/[id]`) is what persists corrected data. Advancing `status` from there is a separate GA/ADMIN-only action (`VENDOR` cannot write `status` at all).

### `GET /api/invoices/[id]/file`
Auth: any authenticated user; `VENDOR` 403 if not their invoice. Reads via `getFileBuffer()` (`src/lib/services/fileService.ts`) — Supabase Storage if configured, else local disk (`uploads/invoices/`, which doesn't survive Vercel's serverless filesystem). `filePath` is always server-derived (`{invoiceId}.{ext}`), never taken from user input, so there's no path-traversal surface. **Not Stored as an API field** — streams the raw file bytes referenced by `invoices.file_path`.

## Vendors

### `GET /api/vendors`
Auth: any authenticated user. `VENDOR` role gets only their own vendor (full row, or `[]` if unlinked) — never the full list. Everyone else gets `vendors.{id,name,npwp,contactEmail,bankName}` where `is_active = true`, ordered by `name`.

### `POST /api/vendors`
Auth: `ADMIN` only. Body validated by `createVendorSchema`. Creates the `Vendor` entity a `VENDOR`-role user account is later linked to via `POST /api/users` (`vendorId`) — the two are separate steps. Writes: `vendors` row, `audit_logs` (`action: 'vendor.created'`).

### `GET /api/vendors/[id]`
Auth: any authenticated user; `VENDOR` gets 403 if `id !== session.user.vendorId`. Returns the full `vendors` row + `contacts[]` (all `vendor_contacts` for this vendor).

### `PATCH /api/vendors/[id]`
Auth: any authenticated user — like invoices, field-aware rather than a flat role gate (`allowedVendorFields()` in the route):

| Role | Writable fields |
|---|---|
| `ADMIN` | everything, including `name`, `npwp`, `isActive` |
| `GA_STAFF`, `GA_MANAGER` | everything **except** `name`, `npwp` |
| `VENDOR` (`id === session.user.vendorId` only) | everything except `name`, `npwp`, `isActive` |

`name`/`npwp` are locked to `ADMIN` — both are used to match tax documents, and a vendor changing them unilaterally would break that audit trail. Writes: `vendors` row (partial update), `audit_logs` (`action: 'vendor.updated'`, `metadata: { fields }`).

**Mandatory contact fields** (`VENDOR` self-service only, `id === session.user.vendorId`): `contactName`/`contactEmail` must be non-empty in the *resulting* row after this update, not just in the submitted body — computed from the patch's value if it touches that field, else the vendor's current value. Rejects 400 with `{ error: "Contact name and contact email are required" }` if either would end up empty. Deliberately **not** enforced for `ADMIN`/`GA_STAFF`/`GA_MANAGER` edits — an admin-seeded vendor the owning `VENDOR` hasn't finished setting up yet shouldn't block unrelated admin operations like toggling `isActive`.

### `GET /api/vendors/[id]/contacts`
Auth: same access rule as `GET /api/vendors/[id]`. Returns `vendor_contacts.*` for this vendor, ordered by `name`.

### `POST /api/vendors/[id]/contacts`
Auth: `ADMIN`, `GA_STAFF`, `GA_MANAGER`, or the owning `VENDOR`. Body validated by `vendorContactSchema`. Writes: `vendor_contacts` row, `audit_logs` (`action: 'vendor.contact_added'`).

### `DELETE /api/vendors/[id]/contacts/[contactId]`
Auth: same as `POST`. Hard delete (contacts have no soft-delete flag). Writes `audit_logs` (`action: 'vendor.contact_removed'`).

## Companies

The invoice-receiving entity ("bill-to") a vendor submits against — distinct from `Vendor` (the sender). See `docs/PRODUCTION_PLAN.md` §6.3.

### `GET /api/companies`
Auth: any authenticated user (needed by the vendor upload wizard's company dropdown, not just admin pages). Returns `companies.*` where `is_active = true`, ordered by `name`. `?includeInactive=true` returns all rows regardless of `is_active` (used by the admin management page).

### `POST /api/companies`
Auth: `ADMIN`, `GA_STAFF` only. Body validated by `createCompanySchema`. Writes: `companies` row, `audit_logs` (`action: 'company.created'`).

### `PATCH /api/companies/[id]`
Auth: `ADMIN`, `GA_STAFF` only. Body validated by `updateCompanySchema` (partial). Writes: `companies` row (partial update), `audit_logs` (`action: 'company.updated'`, `metadata: { fields }`).

### `DELETE /api/companies/[id]`
Auth: `ADMIN`, `GA_STAFF` only. Soft-delete: sets `companies.is_active = false` (no row is actually deleted — invoices already pointing at it keep a valid FK). Writes `audit_logs` (`action: 'company.deactivated'`).

## Dashboard

### `GET /api/dashboard`
Auth: any authenticated user. `VENDOR` role scoped to `vendorId = session.user.vendorId` on every query below, server-forced (query-param `vendorId` is ignored for vendors, same IDOR protection as `GET /api/invoices`). Aggregation logic and the filter-building are shared with the export route via `getDashboardStats()`/`buildDashboardFilter()` (`src/lib/services/dashboardStats.ts`), so the two always agree.

Query params (all optional, all combine with AND): `search` (matches `invoice_number`, case-insensitive), `status`, `vendorId` (non-vendor roles only), `companyId`, `from`/`to` (filters `due_date`). Every field below — KPIs, chart data, and the table — reflects the same filtered set; there's no partially-filtered view.

| Response field | Source |
|---|---|
| `totalInvoices` | `formula`: `COUNT(invoices)` matching the request's filters — no status exclusion of its own |
| `totalPayable` | `formula`: `SUM(invoices.total_amount)` over the filtered set, additionally narrowed to `status NOT IN ('PAID','CLOSED','REJECTED')` (`NON_OPEN_STATUSES`, `dashboardStats.ts`) **only when `?status=` wasn't given** — an explicit status filter reflects that status's total instead of always meaning "open" |
| `overdueCount` | `formula`: `COUNT(invoices)` where `due_date < now()`, same open/explicit-status logic as `totalPayable` |
| `openCount` | `formula`: `COUNT(invoices)` matching the filtered set, same open/explicit-status logic as `totalPayable` |
| `statusBreakdown[]` | `formula`: `GROUP BY invoices.status` over the filtered set, count per group — all 17 statuses, not just the main-flow ones |
| `agingBuckets[]` | `formula`: `SUM(invoices.total_amount)` bucketed by `due_date` relative to now (0–30 / 31–60 / 61–90 / >90 days), same status scoping as `totalPayable` |
| `monthlyTrend[]` | `formula`: trailing 12 UTC months — `{month, totalAmount, count}` per month, from invoices `WHERE created_at` in that month, no status filter |
| `statusByMonth[]` | `formula`: trailing 12 UTC months — `{month, entered, accepted}`, counting invoices created that month currently in `status = 'RECEIVED'` (entered) vs `status = 'PAID'` (accepted). A pipeline-health proxy, not a true historical flow rate — see `StatusFlowChart.tsx` |
| `recentInvoices[]` | `invoices.*` (10 most recent by `created_at` within the filtered set) + `vendor.name` + `company.name` |

### `GET /api/dashboard/export`
Auth: any authenticated user, same `VENDOR` scoping and query params as `GET /api/dashboard` (same `buildDashboardFilter()`). **Not Stored** — generates an `.xlsx` file on demand via `exceljs`, streamed as the response body (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), not persisted anywhere.

- Sheet "KPI Summary": same fields/formulas as `GET /api/dashboard` above, computed over the same filtered set (`totalInvoices`, `totalPayable`, `overdueCount`, `openCount`, `statusBreakdown`, `agingBuckets`).
- Sheet "Invoices": one row per invoice matching the active filters (unfiltered = every invoice, same as the dashboard's default view), columns Invoice Number/**PO Number**/Vendor/**Company (Bill To)**/Invoice Date/Due Date/Send Date/Delivered Date/PIC/Status/**PIC Stage**/Currency/Subtotal/Tax/Total/Paid Date/Paid Amount/Created By/Created At/Notes, all sourced from `invoices.*` + `vendor.name` + `company.name` + `createdBy.name` + `pic.name`.

## Audit

### `GET /api/audit`
Auth: `ADMIN`, `GA_MANAGER`. Paginated (`page`, fixed `limit=20`), filterable by `entityType`, `userId`.

| Response field | Source |
|---|---|
| `logs[]` | `audit_logs.*` + `user.{name,role}` from `users` |
| `total` | `formula`: `COUNT(audit_logs)` with same filter |
| `page`, `pages` | `formula`: `Math.ceil(total / 20)` — **Not Stored** |

## Notifications

### `GET /api/notifications`
Auth: any authenticated user. Scoped to `user_id = session.user.id`. Optional `?unread=true` filter. Returns `notifications.*` (max 50, newest first) + `invoice.{invoiceNumber, vendorId}`.

### `PATCH /api/notifications`
Auth: any authenticated user. Marks all of the caller's unread notifications as read: `notifications.is_read=true`, `notifications.read_at=now()`.

### `PATCH /api/notifications/[id]/read`
Auth: any authenticated user; scoped via `WHERE id = :id AND user_id = session.user.id` (prevents marking another user's notification as read). Sets `is_read=true`, `read_at=now()`.

The notification bell's unread badge polls `GET /api/notifications?unread=true` client-side every 60s (`useNotificationStream` hook) and uses the array length as the count — no separate SSE endpoint. A dedicated `GET /api/notifications/stream` (SSE, held-open connection) previously did this server-side, but a long-lived connection doesn't fit a serverless function; removed in favor of client polling.

## Chat

### `POST /api/chat`
Auth: `ADMIN`, `GA_MANAGER` only, rate-limited **10 requests/min/user**. Body `{ message, history }` passed to `runChat()` (`src/lib/services/geminiChat.ts`). Gemini is given a `query_invoices` function declaration and instructed to call it for anything involving real invoice data; when it does, the route runs an actual Prisma query (see [ARCHITECTURE.md](./ARCHITECTURE.md) for the two-turn function-calling flow) — deliberately **not** scoped to any invoice status the model can explicitly ask for, since the requirement is that chat can answer about any invoice regardless of status. `answer` field is **Not Stored** — no chat history table exists; conversation history is client-held and replayed per request. If `GOOGLE_API_KEY` isn't configured, or the Gemini call throws, returns `{ answer: "Maaf, layanan AI sedang tidak tersedia..." }` with a 200 (never surfaces a raw error to the chat UI).

## Users

### `GET /api/users`
Auth: `ADMIN`, `GA_STAFF`, `GA_MANAGER` (broad read access so the invoice detail page's PIC-reassignment dropdown can populate for non-admin roles). Optional `?role=` filter. Returns `users.{id,name,email,role,vendorId,isActive}` — `passwordHash` is never selected/returned.

### `POST /api/users`
Auth: `ADMIN` only. Body validated by `createUserSchema` (Zod). Writes: `users` row (`password_hash` = `bcrypt.hash(password, 12)`, matching the hashing convention in `auth.ts`/`seed.ts`; `vendor_id` set only when `role='VENDOR'`; `must_change_password` defaults to `true` — the account must set its own password before reaching anything past `/change-password`, enforced in `middleware.ts`), `audit_logs` (`action: 'user.created'`, `metadata: { email, role }`).

### `PATCH /api/users/[id]`
Auth: `ADMIN` only. Body: `{ role?, isActive?, vendorId? }`. Rejects (400) if the resulting role is `VENDOR` with no `vendorId`. Writes: `users` row (partial update), `audit_logs` (`action: 'user.role_updated'`, `metadata: { from, to }`). The admin users page's Active/Inactive badge is a toggle button wired to this with `{ isActive }` — deactivated users fail login at `authorize()` (`!user.isActive` check in `auth.ts`).

### `PATCH /api/users/me/password`
Auth: any authenticated user, changing their own password only (no `id` param — always `session.user.id`). Body validated by `changePasswordSchema` (`{ currentPassword, newPassword }`). Verifies `currentPassword` against `users.password_hash` first (400 if wrong) — this isn't gated behind `mustChangePassword`, so it doubles as the general "change my password" endpoint, not just the first-login flow. Writes: `users.password_hash` (rehashed), `users.must_change_password = false`, `audit_logs` (`action: 'user.password_changed'`). The `/change-password` page calls NextAuth's client-side `update()` after a successful response to refresh the JWT (`trigger: 'update'` branch in `auth.ts`'s `jwt` callback re-reads `must_change_password` from the DB) — otherwise the stateless JWT would keep gating the user until natural token expiry.

## Reminder settings

Admin-editable config that replaced the hardcoded thresholds/recipients previously baked into `reminderScheduler.ts` — see `docs/PRODUCTION_PLAN.md` §6.6. Four rows, one per `type`: `due_soon`, `overdue`, `invoice_submitted`, `revision_requested`.

### `GET /api/admin/reminders`
Auth: `ADMIN` only. Returns all `reminder_settings` rows, ordered by `type`.

### `PATCH /api/admin/reminders/[type]`
Auth: `ADMIN` only. 404 if `type` isn't one of the four known values. Body validated by `updateReminderSettingSchema` (partial — `isActive`, `daysBefore`, `recipientRoles`, `extraEmails`, `emailEnabled`, `inAppEnabled`). `updated_by` is server-assigned to `session.user.id`. Writes: `reminder_settings` row, `audit_logs` (`action: 'reminder_setting.updated'`, `metadata: { type, fields }` — who's notified about money is worth an audit trail).

`recipientRoles`/`daysBefore` are only meaningful for `due_soon`/`overdue`/`invoice_submitted` — `revision_requested` always notifies the specific invoice's own vendor, not a role group (its `recipientRoles` field is stored but ignored by the trigger). No settings for send time/frequency exist by design — Vercel Hobby's cron cap (§4.2) means only "once daily" is actually deliverable, and a UI control that can't be honored is worse than no control.

## Cron

### `GET /api/cron/reminders`
Auth: `Authorization: Bearer <CRON_SECRET>` header — checked inside the route (not `requireAuth`/`requireRole`, since there's no NextAuth session). `src/middleware.ts` explicitly excludes `/api/cron/**` from its session-required gate so the request reaches the route at all. Registered in `vercel.json` → `crons` (`0 1 * * *`, daily — Vercel Hobby plan caps cron at once/day; see `docs/PRODUCTION_PLAN.md` §4.2). Runs `checkDueDates()` (`src/lib/services/reminderScheduler.ts`), same logic previously invoked hourly by `node-cron` from `src/instrumentation.ts` (removed — doesn't survive serverless scale-to-zero).

Writes: `notifications` rows (`type: 'due_soon'|'overdue'`) for open invoices (`status NOT IN ('PAID','CLOSED','REJECTED')`, `OPEN_STATUSES` in `reminderScheduler.ts`) due within `reminder_settings.days_before` (default 3, `due_soon` only) or overdue, recipients = active users in `reminder_settings.recipient_roles`, deduplicated per `(userId, invoiceId, type)` within a 24h window — written only when `in_app_enabled` is true. Also sends one summary email (via Resend) to the same recipients plus `extra_emails` when `email_enabled` is true — not deduplicated beyond the cron's own once-daily schedule. The whole type is skipped when `is_active` is false, or when neither channel is enabled. Returns `{ ok, dueSoonCount, overdueCount, notificationsCreated }`.

## Invoice-event notifications

One `reminder_settings`-gated trigger, fired inline from `PATCH /api/invoices/[id]` (not the cron job):

- **`status_changed`** — whenever `status` actually changes value. Notifies every active `VENDOR`-role user linked to the invoice's `vendorId` — `recipientRoles` is not consulted for this type (the recipient is always the invoice's own vendor). Gated by the `status_changed` `reminder_settings` row like every other type: `isActive`, `inAppEnabled`/`emailEnabled` independently.

If `RESEND_API_KEY` isn't configured, the email call no-ops silently (`src/lib/services/email.ts`) rather than failing the request.

> **Dead config, not yet wired up:** `invoice_submitted` and `revision_requested` exist as configurable rows/types (`REMINDER_TYPES` in `src/lib/validations.ts`, editable at `/admin/reminders`) but **nothing in the codebase fires them** — they're leftover from a removed `DRAFT`/`SUBMITTED`/`REVISION` status model that predates both the 4-value verification-workflow enum and this 17-value overhaul. An admin can toggle these settings with no effect. Left as-is per the approved plan (out of scope for the current batch of work) — flagged here so it isn't mistaken for working.

## System

### `GET /api/health`
No auth. Runs `SELECT 1` against the database. Returns `{ status: 'ok'|'degraded', app: 'ok', db: 'ok'|'error' }`. **Not Stored**.

### `POST /api/auth/[...nextauth]`, `GET /api/auth/[...nextauth]`
NextAuth v5 handler (`src/lib/auth/auth.ts`). Credentials provider: looks up `users.email`, checks `users.is_active`, verifies `bcrypt.compare(password, users.password_hash)`. On success, JWT carries `id`, `role`, `vendorId` (all from `users.*`); session mirrors the JWT.

