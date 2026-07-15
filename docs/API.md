# API Reference

All Next.js routes live under `src/app/api/`. Every route calls `requireAuth()` or `requireRole([...])` from `src/lib/auth/helpers.ts` first (401/403 on failure) unless noted. Response fields are traced to their source per `CLAUDE.md` — `table.column` for stored data, `formula` for computed values, `Not Stored` for pass-through/ephemeral data.

## Invoices

### `GET /api/invoices`
Auth: any authenticated user. `VENDOR` role is server-forced to `where.vendorId = session.user.vendorId` (query-param `vendorId` is ignored for vendors — prevents IDOR).

Query params: `status`, `search` (matches `invoice_number`, case-insensitive), `from`/`to` (filters `due_date`), `vendorId` (non-vendor roles only).

| Response field | Source |
|---|---|
| `id`, `vendorId`, `invoiceNumber`, `invoiceDate`, `dueDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount`, `status`, `ocrConfidence`, `filePath`, `fileType`, `notes`, `createdById`, `createdAt`, `updatedAt` | `invoices.*` (1:1 column mapping, camelCase via Prisma `@map`) |
| `vendor.id`, `vendor.name` | `vendors.id`, `vendors.name` |
| `createdBy.id`, `createdBy.name` | `users.id`, `users.name` |
| `items[]` | `invoice_items.*` where `invoice_id = invoices.id`, ordered by `sort_order` |

### `POST /api/invoices`
Auth: `FINANCE`, `ADMIN`, `VENDOR`. Body validated by `createInvoiceSchema` (Zod, `src/lib/validations.ts`). `VENDOR` role: `vendorId` is forced to `session.user.vendorId`, ignoring any client-supplied value.

Writes: `invoices` row (`status` forced to `PENDING_REVIEW`, `created_by` = session user id), `invoice_items` rows, `audit_logs` row (`action: 'invoice.created'`, `metadata: { invoiceNumber }`).

### `GET /api/invoices/[id]`
Auth: any authenticated user; `VENDOR` gets 403 if `invoice.vendorId !== session.user.vendorId`.

Adds to the list-response shape above: `vendor` (full row, not just `id`/`name`), `createdBy.role`, `approvals[]` (`approval_workflows.*` where `invoice_id = id`, with `approver.{id,name,role}`, ordered by `step`).

### `PATCH /api/invoices/[id]`
Auth: `FINANCE`, `ADMIN`. Body validated by `updateInvoiceSchema`. If `status` is present, the transition is checked against `isValidStatusTransition()` (`src/lib/validations.ts::VALID_TRANSITIONS`) against the current `invoices.status` before writing.

Writes: `invoices` row (partial update), `audit_logs` (`action: 'invoice.updated'`, `metadata: { fields: [...changed keys] }`).

### `DELETE /api/invoices/[id]`
Auth: `ADMIN` only. Soft-delete: sets `invoices.status = 'REJECTED'` (no row is actually deleted). Writes `audit_logs` (`action: 'invoice.cancelled'`).

### `POST /api/invoices/[id]/upload`
Auth: `FINANCE`, `ADMIN`, `VENDOR` (vendor scoped to own invoices — 403 otherwise). Validates: MIME type allowlist (`pdf`/`jpeg`/`jpg`/`png`), magic-byte signature check against the claimed extension (prevents MIME spoofing), 10MB max size.

Writes: file to `uploads/invoices/` via `saveUploadedFile()` (`src/lib/services/fileService.ts`), `invoices.file_path`, `invoices.file_type`, `invoices.status = 'PENDING_OCR'`, `audit_logs` (`action: 'invoice.file_uploaded'`, `metadata: { fileName, fileType }`).

### `GET /api/invoices/[id]/ocr` (SSE stream)
Auth: any authenticated user, rate-limited **5 requests/min/user** (`src/lib/rate-limit.ts`). Streams `status`, `field`, `line_items`, `done`/`error` events.

| Streamed field | Source |
|---|---|
| `field.value`, `field.confidence` (per invoice field) | AI service `POST /ocr/extract` response — **Not Stored** as a distinct field, only the final parsed values persist |
| Persisted after stream: `invoiceNumber`, `invoiceDate`, `dueDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount` | Written to `invoices.*` from the AI service response, falling back to existing DB value if the field wasn't extracted |
| `ocrConfidence` | `invoices.ocr_confidence` ← AI service `overall_confidence` (average confidence of non-null extracted fields, computed in `ai-service/app/api/ocr.py`) |
| Line items | `invoice_items.*` — existing rows for the invoice are deleted and replaced from `line_items[]` in the AI response |

On error, `invoices.status` is force-set to `PENDING_REVIEW` so the user can enter data manually.

### `GET /api/invoices/[id]/file`
Auth: any authenticated user; `VENDOR` 403 if not their invoice. Returns 503 when `process.env.VERCEL === '1'` (no persistent disk on Vercel). Path is resolved and confined to `uploads/invoices/` before reading (`path.resolve` + prefix check) to block path traversal. **Not Stored as an API field** — streams the raw file bytes referenced by `invoices.file_path`.

## Approvals

### `GET /api/approvals`
Auth: `GA_STAFF`, `GA_MANAGER`, `FINANCE`, `MANAGER`, `ADMIN`. Step filter by role: `GA_MANAGER` → `step=1`, `FINANCE`/`MANAGER` → `step=2`, `GA_STAFF`/`ADMIN` → all pending steps (read-only for `GA_STAFF` — enforced by the absence of `GA_STAFF` in the approve/reject route's allowed roles, not by this route).

| Response field | Source |
|---|---|
| Workflow fields | `approval_workflows.*` where `status = 'PENDING'` (+ role-based `step` filter) |
| `invoice.*` | `invoices.*` |
| `invoice.vendor.name` | `vendors.name` |
| `invoice.items[]` | `invoice_items.*` |
| `approver.{id,name}` | `users.id`, `users.name` |

### `POST /api/approvals/[invoiceId]/approve`
Auth: `GA_MANAGER`, `FINANCE`, `MANAGER`, `ADMIN`. `step` derived from role: `FINANCE`/`MANAGER` → `2`, else → `1`. Fails 404 if no `PENDING` `approval_workflows` row exists for that `(invoiceId, step)`.

Writes: `approval_workflows` row → `status='APPROVED'`, `approver_id`, `comment`, `actioned_at`. If step 1: creates a new step-2 `approval_workflows` row, sets `invoices.status='PENDING_APPROVAL'`, creates `notifications` rows for all active `FINANCE` users (`type: 'approval_required'`). If step 2: `invoices.status='APPROVED'`. Always writes `audit_logs` (`action: 'invoice.approved_step_{n}'`).

### `POST /api/approvals/[invoiceId]/reject`
Auth: same as approve. Writes: `approval_workflows.status='REJECTED'`, `invoices.status='REJECTED'`, `audit_logs` (`action: 'invoice.rejected_step_{n}'`).

## Vendors

### `GET /api/vendors`
Auth: any authenticated user. Returns `vendors.{id,name,npwp,contactEmail,bankName}` where `is_active = true`, ordered by `name`.

## Dashboard

### `GET /api/dashboard`
Auth: any authenticated user. `VENDOR` role scoped to `vendorId = session.user.vendorId` on every query below.

| Response field | Source |
|---|---|
| `totalInvoices` | `formula`: `COUNT(invoices)` (vendor-scoped for VENDOR role) |
| `totalPayable` | `formula`: `SUM(invoices.total_amount)` where `status IN ('PENDING_APPROVAL','APPROVED')` |
| `overdueCount` | `formula`: `COUNT(invoices)` where `due_date < now()` and `status IN ('PENDING_APPROVAL','APPROVED')` |
| `pendingApprovalCount` | `formula`: `COUNT(invoices)` where `status='PENDING_APPROVAL'` |
| `statusBreakdown[]` | `formula`: `GROUP BY invoices.status`, count per group |
| `agingBuckets[]` | `formula`: `SUM(invoices.total_amount)` bucketed by `due_date` relative to now (0–30 / 31–60 / 61–90 / >90 days), status filtered same as `totalPayable` |
| `recentInvoices[]` | `invoices.*` (10 most recent by `created_at`) + `vendor.name` |

## Audit

### `GET /api/audit`
Auth: `ADMIN`, `MANAGER`, `FINANCE`. Paginated (`page`, fixed `limit=20`), filterable by `entityType`, `userId`.

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

### `GET /api/notifications/stream` (SSE)
Auth: any authenticated user. Polls `COUNT(notifications) WHERE user_id = session.user.id AND is_read=false` every 15s, pushes `{ unreadCount }` only when it changes. **Not Stored** as a field — computed on each poll.

## Chat

### `POST /api/chat`
Auth: any authenticated user, rate-limited **10 requests/min/user**. Proxies `{ message, history }` to AI service `POST /chat` with a 30s timeout. On AI-service failure or timeout, returns a canned Indonesian fallback message with HTTP 200 (not an error status — see [Known Limitations](./ARCHITECTURE.md#known-architectural-limitations-demo-mvp)). `answer` field is **Not Stored** — no chat history table exists; conversation history is client-held and replayed per request.

## System

### `GET /api/health`
No auth. Runs `SELECT 1` against the database. Returns `{ status: 'ok'|'degraded', app: 'ok', db: 'ok'|'error' }`. **Not Stored**.

### `POST /api/auth/[...nextauth]`, `GET /api/auth/[...nextauth]`
NextAuth v5 handler (`src/lib/auth/auth.ts`). Credentials provider: looks up `users.email`, checks `users.is_active`, verifies `bcrypt.compare(password, users.password_hash)`. On success, JWT carries `id`, `role`, `vendorId` (all from `users.*`); session mirrors the JWT.

## AI service (`ai-service/`, port 8000)

Not authenticated — trusted-network assumption (see [ARCHITECTURE.md](./ARCHITECTURE.md)). CORS restricted to `http://localhost:3000`.

### `POST /ocr/extract`
Body: `{ file_path, invoice_id }`. Pipeline: `ocr_service.extract_text_from_file()` (Tesseract) → `extraction_chain.extract_invoice_fields()` (LangChain LLM call against the configured provider) → per-field `{ value, confidence }` mapped into `OCRExtractResponse`. `overall_confidence` = average confidence of fields with a non-null value (`ai-service/app/api/ocr.py`). Returns 404 if the file doesn't exist, 500 (sanitized message, no internal detail leaked) on any other failure.

### `POST /chat`
Body: `{ message (max 4000 chars), history (last 20 entries kept server-side, only last 6 used in the prompt) }`. Runs the LangChain chain (`PromptTemplate | llm`) in a thread-pool executor so the FastAPI event loop isn't blocked. `SYSTEM_CONTEXT` is a static string describing the domain (statuses, Indonesian terminology) — **not** a pgvector similarity search.

### `GET /health`
No auth, no DB check — always returns `{status: "ok"}` if the process is up (distinct from the Next.js `/api/health`, which does check the DB).
