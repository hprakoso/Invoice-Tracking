# API Reference

All Next.js routes live under `src/app/api/`. Every route calls `requireAuth()` or `requireRole([...])` from `src/lib/auth/helpers.ts` first (401/403 on failure) unless noted. Response fields are traced to their source per `CLAUDE.md` — `table.column` for stored data, `formula` for computed values, `Not Stored` for pass-through/ephemeral data.

## Invoices

### `GET /api/invoices`
Auth: any authenticated user. `VENDOR` role is server-forced to `where.vendorId = session.user.vendorId` (query-param `vendorId` is ignored for vendors — prevents IDOR). `status = 'DRAFT'` invoices are always excluded, regardless of the `status` query param — an in-progress upload-wizard session isn't a real invoice yet (see § Invoice status lifecycle in ARCHITECTURE.md).

Query params: `status`, `search` (matches `invoice_number`, case-insensitive), `from`/`to` (filters `due_date`), `vendorId` (non-vendor roles only).

| Response field | Source |
|---|---|
| `id`, `vendorId`, `invoiceNumber`, `invoiceDate`, `dueDate`, `sendDate`, `deliveredDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount`, `status`, `ocrConfidence`, `filePath`, `fileType`, `notes`, `createdById`, `createdAt`, `updatedAt` | `invoices.*` (1:1 column mapping, camelCase via Prisma `@map`) |
| `vendor.id`, `vendor.name` | `vendors.id`, `vendors.name` |
| `createdBy.id`, `createdBy.name` | `users.id`, `users.name` |
| `pic.id`, `pic.name` | `users.id`, `users.name` via `invoices.pic_id` |
| `items[]` | `invoice_items.*` where `invoice_id = invoices.id`, ordered by `sort_order` |

### `POST /api/invoices`
Auth: `ADMIN`, `VENDOR`, `GA_STAFF`, `GA_MANAGER`. Body validated by `createInvoiceSchema` (Zod, `src/lib/validations.ts`). `VENDOR` role: `vendorId` is forced to `session.user.vendorId`, ignoring any client-supplied value. `GA_STAFF`: `picId` defaults to the creating user (they're the hardcopy's first handler), overridable via `data.picId`. `companyId` (which PT/entity the invoice bills) is optional here — the upload wizard creates a placeholder-data draft first and collects `companyId` in its review step via `PATCH`, same pattern as `sendDate`/`picId`.

Writes: `invoices` row (`status` = `'DRAFT'`, `send_date` from body, `pic_id` per above, `created_by` = session user id), `invoice_items` rows, `audit_logs` row (`action: 'invoice.created'`, `metadata: { invoiceNumber }`). No reminder notification fires here — `invoice_submitted` fires later, from `PATCH`, when the wizard actually confirms the invoice (`DRAFT → SUBMITTED`), not at this placeholder-creation step. See § Invoice-event notifications.

### `GET /api/invoices/[id]`
Auth: any authenticated user; `VENDOR` gets 403 if `invoice.vendorId !== session.user.vendorId`.

Adds to the list-response shape above: `vendor` (full row, not just `id`/`name`), `company` (full `companies` row, nullable), `createdBy.role`, `pic.role`, `paidBy.{id,name,role}` (who marked it paid, via `invoices.paid_by`). `pic` is forced to `null` for `VENDOR` callers — the PIC (GA Staff handling the hardcopy) is internal-only, not vendor-facing.

### `PATCH /api/invoices/[id]`
Auth: any authenticated user — authorization is field- and status-aware, not a flat role gate. Body validated by `updateInvoiceSchema`. The server computes which of the submitted fields the caller's role may write given the invoice's current `status` (`allowedFields()` in the route), silently drops the rest, and 403s if nothing survives:

| Role | Writable fields | When |
|---|---|---|
| `VENDOR` (own invoice only) | `sendDate` | any status |
| | + `invoiceNumber`, `invoiceDate`, `dueDate`, `subtotal`, `taxAmount`, `totalAmount`, `notes`, `companyId`, `status→SUBMITTED` | while `status ∈ {DRAFT, REVISION}` (finishing the wizard, or fixing and resubmitting) |
| | + same core fields (no `status`) | while `status = SUBMITTED` **and** this VENDOR created the invoice — finishes the post-OCR review step from the upload wizard |
| `GA_STAFF`, `GA_MANAGER` | `deliveredDate`, `picId`, `sendDate`, `status` (`DRAFT→SUBMITTED`, `SUBMITTED→*`, and `REVISION→SUBMITTED`), `paidDate`, `paidAmount` | always |
| | + core fields above | while `status ∈ {DRAFT, SUBMITTED, REVISION}` **and** this GA_STAFF/GA_MANAGER created the invoice |
| `ADMIN` | all fields, bypasses the `VALID_TRANSITIONS` table | — |

Any `status` change is checked against `isValidStatusTransition()` (`src/lib/validations.ts::VALID_TRANSITIONS`, skipped for `ADMIN`). The one exception `VALID_TRANSITIONS` itself doesn't encode: `REVISION → SUBMITTED` (resubmit) is further restricted to `VENDOR`/`ADMIN` only — `GA_STAFF` can request every other transition but not this one, since fixing a revision is the vendor's responsibility. Any `sendDate`/`deliveredDate` change is checked against `validateDeliveryDates()` (deliveredDate ≥ sendDate).

**`DRAFT → SUBMITTED`** is the wizard's final confirm step. When the caller is `VENDOR`, this is also what fires the `invoice_submitted` reminder trigger (moved here from `POST /api/invoices` — see § Invoice-event notifications) — a `GA_STAFF`/`GA_MANAGER`/`ADMIN` submitting on a vendor's behalf does not, same as before.

**Marking an invoice `PAID`** (`SUBMITTED → PAID`, `GA_STAFF`/`GA_MANAGER`/`ADMIN` only — never reachable by `VENDOR`, structurally: `status` isn't in `VENDOR`'s allowed-field list while `status = SUBMITTED`): `invoices.paid_by` is **always server-assigned** to `session.user.id`, never client-supplied. `paidDate` defaults to `now()` and `paidAmount` defaults to `invoices.total_amount` when the caller omits them (partial-payment amounts can still be supplied explicitly). `PAID` is terminal (`VALID_TRANSITIONS.PAID = []`) — marking an already-paid invoice paid again returns 400.

Writes: `invoices` row (partial update, only the filtered/allowed fields). `audit_logs` — `action: 'invoice.status_changed'` with `metadata: { from, to, comment }` (the optional `comment` field is **Not Stored** on the invoice itself, only in this audit metadata) when `status` changes, else `action: 'invoice.updated'` with `metadata: { fields: [...changed keys] }`. A transition to `REVISION` also fires the `revision_requested` reminder trigger — see § Invoice-event notifications.

### `DELETE /api/invoices/[id]`
Auth: `ADMIN` only. Soft-delete: sets `invoices.status = 'CANCELLED'` (no row is actually deleted). Writes `audit_logs` (`action: 'invoice.cancelled'`).

### `POST /api/invoices/[id]/upload`
Auth: `ADMIN`, `VENDOR`, `GA_STAFF`, `GA_MANAGER` (vendor scoped to own invoices — 403 otherwise). Validates: MIME type allowlist (`pdf`/`jpeg`/`jpg`/`png`), magic-byte signature check against the claimed extension (prevents MIME spoofing), 10MB max size.

Writes: file to `uploads/invoices/` via `saveUploadedFile()` (`src/lib/services/fileService.ts`), `invoices.file_path`, `invoices.file_type` (status is untouched — stays `DRAFT`), `audit_logs` (`action: 'invoice.file_uploaded'`, `metadata: { fileName, fileType }`).

### `GET /api/invoices/[id]/ocr` (SSE stream)
Auth: any authenticated user, rate-limited **5 requests/min/user** (`src/lib/rate-limit.ts`). Streams `status`, `field`, `line_items`, `done`/`error` events.

| Streamed field | Source |
|---|---|
| `field.value`, `field.confidence` (per invoice field) | Gemini vision extraction response (`extractInvoiceFields()`, `src/lib/services/geminiExtraction.ts`) — **Not Stored** as a distinct field, only the final parsed values persist |
| Persisted after stream: `invoiceNumber`, `invoiceDate`, `dueDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount` | Written to `invoices.*` from the Gemini response, falling back to existing DB value if the field wasn't extracted |
| `ocrConfidence` | `invoices.ocr_confidence` ← `overall_confidence`, computed in `extractInvoiceFields()` as the average confidence of the 7 core fields that came back non-null (same formula the old Python service used) |
| Line items | `invoice_items.*` — existing rows for the invoice are deleted and replaced from `line_items[]` in the Gemini response |

OCR no longer changes `invoices.status` on success or error — the invoice stays `DRAFT` throughout; the frontend review step (`PATCH /api/invoices/[id]`) is what persists corrected data and transitions to `SUBMITTED`.

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
Auth: any authenticated user. `VENDOR` role scoped to `vendorId = session.user.vendorId` on every query below. Aggregation logic shared with the export route via `getDashboardStats()` (`src/lib/services/dashboardStats.ts`), so the two always agree.

| Response field | Source |
|---|---|
| `totalInvoices` | `formula`: `COUNT(invoices)` where `status != 'DRAFT'` (vendor-scoped for VENDOR role) |
| `totalPayable` | `formula`: `SUM(invoices.total_amount)` where `status IN ('SUBMITTED','REVISION')` (the two "open" statuses — see [ARCHITECTURE.md](./ARCHITECTURE.md#invoice-status-lifecycle)) |
| `overdueCount` | `formula`: `COUNT(invoices)` where `due_date < now()` and `status IN ('SUBMITTED','REVISION')` |
| `openCount` | `formula`: `COUNT(invoices)` where `status IN ('SUBMITTED','REVISION')` (replaces the old `pendingApprovalCount`, no more approval concept) |
| `statusBreakdown[]` | `formula`: `GROUP BY invoices.status`, count per group |
| `agingBuckets[]` | `formula`: `SUM(invoices.total_amount)` bucketed by `due_date` relative to now (0–30 / 31–60 / 61–90 / >90 days), status filtered same as `totalPayable` |
| `recentInvoices[]` | `invoices.*` (10 most recent by `created_at`) + `vendor.name` |

### `GET /api/dashboard/export`
Auth: any authenticated user, same `VENDOR` scoping as `GET /api/dashboard`. **Not Stored** — generates an `.xlsx` file on demand via `exceljs`, streamed as the response body (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), not persisted anywhere.

- Sheet "KPI Summary": same fields/formulas as `GET /api/dashboard` above (`totalInvoices`, `totalPayable`, `overdueCount`, `openCount`, `statusBreakdown`, `agingBuckets`).
- Sheet "Invoices": one row per invoice (unfiltered — the Dashboard page has no filter UI), columns Invoice Number/Vendor/**Company (Bill To)**/Invoice Date/Due Date/Send Date/Delivered Date/PIC/Status/Currency/Subtotal/Tax/Total/Paid Date/Paid Amount/Created By/Created At/Notes, all sourced from `invoices.*` + `vendor.name` + `company.name` + `createdBy.name` + `pic.name`.

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
Auth: `ADMIN`, `GA_MANAGER` only, rate-limited **10 requests/min/user**. Body `{ message, history }` passed to `runChat()` (`src/lib/services/geminiChat.ts`). Gemini is given a `query_invoices` function declaration and instructed to call it for anything involving real invoice data; when it does, the route runs an actual Prisma query (see [ARCHITECTURE.md](./ARCHITECTURE.md) for the two-turn function-calling flow) — deliberately **not** scoped to any invoice status the model can explicitly ask for, since the requirement is that chat can answer about any invoice, not just `PAID` ones — the one exception is `DRAFT`, always excluded, since an in-progress upload-wizard session isn't a real invoice yet. `answer` field is **Not Stored** — no chat history table exists; conversation history is client-held and replayed per request. If `GOOGLE_API_KEY` isn't configured, or the Gemini call throws, returns `{ answer: "Maaf, layanan AI sedang tidak tersedia..." }` with a 200 (never surfaces a raw error to the chat UI).

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

Writes: `notifications` rows (`type: 'due_soon'|'overdue'`) for `SUBMITTED`/`REVISION` invoices due within `reminder_settings.days_before` (default 3, `due_soon` only) or overdue, recipients = active users in `reminder_settings.recipient_roles`, deduplicated per `(userId, invoiceId, type)` within a 24h window — written only when `in_app_enabled` is true. Also sends one summary email (via Resend) to the same recipients plus `extra_emails` when `email_enabled` is true — not deduplicated beyond the cron's own once-daily schedule. The whole type is skipped when `is_active` is false, or when neither channel is enabled. Returns `{ ok, dueSoonCount, overdueCount, notificationsCreated }`.

## Invoice-event notifications

Two more `reminder_settings`-gated triggers, fired inline from the invoice routes (not the cron job):

- **`invoice_submitted`** — `PATCH /api/invoices/[id]`, when `status` transitions `DRAFT → SUBMITTED` and the confirming user's role is `VENDOR`. Notifies active users in `recipientRoles` (default `GA_STAFF`). Fires at the wizard's actual confirm step, not at the earlier `POST /api/invoices` placeholder-creation step (that just creates the `DRAFT` row the wizard attaches the upload/OCR to) — a vendor closing the browser mid-upload never triggers a false "new invoice" notification.
- **`revision_requested`** — `PATCH /api/invoices/[id]`, when `status` transitions to `REVISION`. Always notifies every active `VENDOR`-role user linked to the invoice's `vendorId` — `recipientRoles` is not consulted for this type.

Both channels are gated independently: `inAppEnabled` controls whether `notifications` rows are written, `emailEnabled` controls whether a Resend email is sent to the same recipients (plus `extraEmails`) — either, both, or neither can be on. If `RESEND_API_KEY` isn't configured, the email call no-ops silently (`src/lib/services/email.ts`) rather than failing the request.

## System

### `GET /api/health`
No auth. Runs `SELECT 1` against the database. Returns `{ status: 'ok'|'degraded', app: 'ok', db: 'ok'|'error' }`. **Not Stored**.

### `POST /api/auth/[...nextauth]`, `GET /api/auth/[...nextauth]`
NextAuth v5 handler (`src/lib/auth/auth.ts`). Credentials provider: looks up `users.email`, checks `users.is_active`, verifies `bcrypt.compare(password, users.password_hash)`. On success, JWT carries `id`, `role`, `vendorId` (all from `users.*`); session mirrors the JWT.

