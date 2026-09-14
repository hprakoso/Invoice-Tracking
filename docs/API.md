# API Reference

All Next.js routes live under `src/app/api/`. Every route calls `requireAuth()` or `requireRole([...])` from `src/lib/auth/helpers.ts` first (401/403 on failure) unless noted.

**Two gates run in `src/middleware.ts` before any handler.** Unauthenticated `/api/*` gets 401. And a `VENDOR` that has not completed its forced initial password change gets **403 `{ error: 'Password change required' }` on every `/api/*` route** except `/api/auth/*` and `/api/users/me/password` (`isVendorApiBlockedPendingPasswordChange()`, `src/lib/auth/permissions.ts`). That obligation used to be a page-route redirect only, so a vendor still on the admin-issued password could drive the entire API from `curl` without ever changing it. The rule is scoped to `VENDOR`; no other role's access is affected. Response fields are traced to their source per `CLAUDE.md` — `table.column` for stored data, `formula` for computed values, `Not Stored` for pass-through/ephemeral data.

## Invoices

### `GET /api/invoices`
Auth: any authenticated user. `VENDOR` role is server-forced to `where.vendorId = session.user.vendorId` (query-param `vendorId` is ignored for vendors — prevents IDOR).

Query params: `status`, `search` (matches `invoice_number`, case-insensitive), `from`/`to` (filters `due_date`), `vendorId` (non-vendor roles only), `poNumber` (contains, case-insensitive), `picId` (exact), `amountMin`/`amountMax` (range on `total_amount`), plus `page`/`pageSize`. The filter params are applied by `applyInvoiceSearchFilters()` (`src/lib/services/dashboardStats.ts`), shared with the dashboard's filter builder so both surfaces accept the same params. Non-numeric `amountMin`/`amountMax` values are ignored rather than passed through as `NaN`.

**Pagination is opt-in and the response body is unchanged — still a bare JSON array.**

Omit `page` and `pageSize` and this route behaves exactly as it always has: one unbounded `findMany`, the same array, no extra headers. Send either and the slice is taken in the database (`skip`/`take`) and the metadata comes back in response headers rather than wrapping the body in an envelope — that would have been a breaking change to the contract this section documents, and the audit below found no need for one.

| Header (paginated requests only) | Source |
|---|---|
| `X-Total-Count` | `formula`: `COUNT(invoices)` with the same `where`, before paging — **Not Stored** |
| `X-Page` | `formula`: the clamped `?page` value — **Not Stored** |
| `X-Page-Size` | `formula`: `?pageSize` clamped to 1..100, default 20 — **Not Stored** |
| `X-Total-Pages` | `formula`: `ceil(X-Total-Count / X-Page-Size)`, min 1 — **Not Stored** |

Filters are built **before** `skip`/`take`, so a search scans the whole table and pages the matches — never only the rows already on the active page. `page` is clamped the way `GET /api/audit` clamps it (`Number('abc')` is `NaN` and `?page=0`/`-1` is negative; either used to reach Prisma as `skip` and throw). A `page` past the last one returns `[]` rather than an error; the client resets to page 1 whenever a filter changes.

`orderBy` is now `[{ createdAt: 'desc' }, { id: 'desc' }]`. The `id` tiebreak is required for correct paging, not cosmetic: `created_at` is not unique (the seed alone has 14 invoices sharing one value), so without a total order Postgres may repeat or drop rows across two `skip`/`take` pages. The order among ties was previously arbitrary, so making it deterministic changes no contract.

**Consumer audit (2026-09-14).** The collection endpoint has exactly one `GET` consumer in the repository — `src/app/(dashboard)/invoices/page.tsx`. Verified from five independent angles: literal path grep across every file type; a call-site-first enumeration of every `fetch`/`EventSource`/`axios`/`XMLHttpRequest` in the repo; tests, root scripts, CI and deploy config; indirect consumers (there is no API-client or service layer — components call `fetch` directly, and `geminiChat.ts` queries Prisma rather than HTTP); and documentation. `src/app/(dashboard)/invoices/upload/page.tsx` also calls `/api/invoices` but with `POST`, so the `GET` contract does not reach it. Because the body shape is unchanged, none of this required a consumer migration.

| Response field | Source |
|---|---|
| `id`, `vendorId`, `invoiceNumber`, `poNumber`, `invoiceDate`, `dueDate`, `sendDate`, `deliveredDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount`, `status`, `picStage`, `ocrConfidence`, `filePath`, `fileType`, `notes`, `createdById`, `createdAt`, `updatedAt` | `invoices.*` (1:1 column mapping, camelCase via Prisma `@map`) |
| `vendor.id`, `vendor.name` | `vendors.id`, `vendors.name` |
| `createdBy.id`, `createdBy.name` | `users.id`, `users.name` |
| `pic.id`, `pic.name` | `users.id`, `users.name` via `invoices.pic_id` — this is *who*, distinct from `picStage` (*which team*) |
| `items[]` | `invoice_items.*` where `invoice_id = invoices.id`, ordered by `sort_order` |

### `POST /api/invoices`
Auth: `ADMIN`, `VENDOR`, `GA_STAFF`, `GA_MANAGER`. Body validated by `createInvoiceSchema` (Zod, `src/lib/validations.ts`) — `poNumber` is required **unless `isDraft: true`**, the one exemption (see below). `VENDOR` role: `vendorId` is forced to `session.user.vendorId`, ignoring any client-supplied value; other roles pick the vendor explicitly from a dropdown in the wizard's first step — there is deliberately no "default to the first vendor" fallback (that was a real bug: an invoice could get attributed to the wrong vendor). A `VENDOR` therefore cannot submit for another vendor by any route: `vendorId` is not in `updateInvoiceSchema` either, so PATCH silently drops it for every role including ADMIN. `GA_STAFF`: `picId` defaults to the creating user (they're the hardcopy's first handler), overridable via `data.picId`.

**Draft creation, since the document-first upload flow.** The wizard no longer knows the PO or the bill-to company when it creates the row — both are read off the uploaded documents (or typed at the confirmation step), which happens after the row must exist, because every upload is addressed by invoice id. So a draft `POST` may omit both:

| Body field | Behaviour for `isDraft: true` |
|---|---|
| `poNumber` | May be omitted. The route writes `DRAFT_PO_PLACEHOLDER` (`'PENDING-OCR'`, `src/lib/validations.ts`) into `invoices.po_number`, which is `NOT NULL`. Deliberately **not** `'N/A'` — migration `20260901000000` backfilled genuine pre-PO rows with that string, so reusing it would make real history indistinguishable from an unfinished draft |
| `companyId` | May be omitted/null (the column is nullable) |

Both are then required by `validateReadyToGoLive` before the draft can go live — see `PATCH /api/invoices/[id]`. A non-draft `POST` is unchanged and still requires `poNumber`.

Writes: `invoices` row (`status = 'RECEIVED'`, `pic_stage` from body or default `'GA'`, `send_date` from body, `pic_id` per above, `created_by` = session user id), `invoice_items` rows, one `invoice_stage_history` row (`stage = picStage`, `changed_by_id` = session user id), `audit_logs` row (`action: 'invoice.created'`, `metadata: { invoiceNumber }`).

> **Abandoned drafts.** A user who abandons the wizard leaves an `isDraft: true` row behind carrying a `DRAFT-<timestamp>` invoice number and a `PENDING-OCR` PO. It is excluded from every KPI, list, export and reminder until the review step is confirmed, so nothing has to be chased or cleaned up — but the row does persist, and only `ADMIN` can delete it (`DELETE /api/invoices/[id]`).

### `GET /api/invoices/[id]`
Auth: any authenticated user; `VENDOR` gets 403 if `invoice.vendorId !== session.user.vendorId`.

Adds to the list-response shape above: `vendor` (full row, not just `id`/`name`), `company` (full `companies` row, nullable), `createdBy.role`, `pic.role`, `paidBy.{id,name,role}` (who marked it paid, via `invoices.paid_by`), `stageHistory[]` (`invoice_stage_history.*` for this invoice, ordered by `changed_at` ascending — the source for the detail page's per-stage duration display), `documents[]` (`invoice_documents.*`, ordered by `created_at` ascending — drives the detail page's document tabs), and `activity[]`. `pic` is forced to `null` for `VENDOR` callers — the PIC (GA Staff handling the hardcopy) is internal-only, not vendor-facing.

**`activity[]` — the "Riwayat & PIC" source.**

| Response field | Source |
|---|---|
| `activity[].id`, `.action`, `.metadata`, `.createdAt` | `audit_logs.id`, `.action`, `.metadata`, `.created_at` where `entity_type = 'invoice' AND entity_id = :id`, ordered by `created_at` ascending. Served by the existing `audit_logs_entity_type_entity_id_idx` (`@@index([entityType, entityId])`) — no migration |
| `activity[].user.name`, `.user.role` | `users.name`, `users.role` via `audit_logs.user_id`; `null` when the row has no user |

Both `entity_type` and `entity_id` are literals in the query, never client-supplied, and the query runs **after** the vendor-ownership 403 above — so `activity` carries exactly this endpoint's existing access rules and cannot surface another invoice's history. No new authorization rule was introduced: whoever may read the invoice may read its activity, the same way `stageHistory`, `items` and `documents` already behave.

`action = 'invoice.stage_changed'` is excluded for every role: `invoice_stage_history` already holds one row per stage move (and is what the durations are computed from), so returning both would render each move twice.

A PIC's comment has always been persisted here — `PATCH /api/invoices/[id]` writes it to `audit_logs.metadata.comment` — but this endpoint never returned audit rows, which is why the section only ever showed PIC stages.

### `PATCH /api/invoices/[id]`
Auth: any authenticated user — authorization is field- and status-aware, not a flat role gate. Body validated by `updateInvoiceSchema`. The server computes which of the submitted fields the caller's role may write given the invoice's current `status` (`allowedFields()` in the route), silently drops the rest, and 403s if nothing survives:

| Role | Writable fields | When |
|---|---|---|
| `VENDOR` (own invoice only) | `invoiceNumber`, `poNumber`, `invoiceDate`, `dueDate`, `subtotal`, `taxAmount`, `totalAmount`, `notes`, `companyId`, `isDraft`, `sendDate` | while `status` is `VENDOR`-editable (`canVendorEdit()`) |
| `GA_STAFF`, `GA_MANAGER` (any invoice) | `deliveredDate`, `picId`, `sendDate`, `status`, `paidDate`, `paidAmount` | always |
| `GA_STAFF`, `GA_MANAGER` (invoice they created) | + the same core fields as `VENDOR` above | while `status` is not terminal |
| `ADMIN` | all fields, bypasses both `allowedFields()` and the `VALID_TRANSITIONS` table | — |

`VENDOR` cannot change `status` at all — there is no self-service resubmit flow (unlike the old `REVISION → SUBMITTED` model, removed with the 2026-09-01 status overhaul).

Any `status` change is checked against `isValidStatusTransition()` (`src/lib/invoiceStatus.ts::VALID_TRANSITIONS`, skipped for `ADMIN`) — 400 with `{ error: 'Invalid status transition', from, to }` if not a valid edge. See [ARCHITECTURE.md](./ARCHITECTURE.md#invoice-status-lifecycle) for the full graph. Any `sendDate`/`deliveredDate` change is checked against `validateDeliveryDates()` (deliveredDate ≥ sendDate).

**Draft → live gate.** When a `PATCH` flips `isDraft` from true to false — the confirmation step's submit — `validateReadyToGoLive()` (`src/lib/validations.ts`) must pass or the request 400s:

| Precondition | Checked against | Rejection |
|---|---|---|
| A real PO number | `filtered.poNumber ?? invoices.po_number`, refusing blank or `DRAFT_PO_PLACEHOLDER` | `PO number is required before submitting this invoice` |
| A resolved bill-to company | `filtered.companyId` if present, else `invoices.company_id` | `Bill-to company is required before submitting this invoice` |
| At least one attached document | `count(invoice_documents WHERE invoice_id = ...)` | `At least one document is required before submitting this invoice` |

Both values were already mandatory — the pre-document-first wizard hard-blocked on them before the file was even chosen. This moves the rule from the browser to the server, which it has to be now that neither is collected up front. Neither is inert if it leaks: `poNumber` is a `contains` filter shared by the dashboard and the invoice list and is written verbatim into the Excel export, so a shared placeholder would return whole batches; a null `company_id` still lists, but is unreachable from every company-scoped filter, KPI breakdown, export and chatbot answer, with nothing anywhere flagging that it needs one.

The document check exists because that state only became reachable with this flow: a file previously had to exist before the row was created, whereas the review step can now delete documents. Without it an invoice could go live with none — nothing for GA to verify, a null `invoices.file_path`, and figures extracted from a file that no longer exists.

The gate is scoped to the **transition**, not to every `PATCH` that happens to carry `isDraft: false`, so editing a legacy live invoice that predates the company requirement is never blocked by it. It applies to `ADMIN` too — this is data integrity, not a permission.

**Duplicate auto-rejection.** When this `PATCH` changes `invoiceNumber`, the server first looks for another invoice with the same `vendorId` + `invoiceNumber` (case-insensitive, excluding `status = 'REJECTED'`). This is the only point a duplicate can be detected — at `POST /api/invoices` the number is still a `DRAFT-<timestamp>` placeholder, so a failed upload retried against the same row is never mistaken for a duplicate.

On a match, the update is **still saved** (so the row isn't stranded with a placeholder number and no way to reach it) but `status` is **forced to `REJECTED`** regardless of what the caller asked for, `paidDate`/`paidAmount`/`paidById` are not applied, and a line is appended to `invoices.notes`: `Auto-rejected: duplikat dari invoice {number} (id {id})`. Writes `audit_logs` with `action: 'invoice.auto_rejected'` and `metadata: { from, to: 'REJECTED', reason: 'duplicate', duplicateOfId, duplicateOfNumber }`. The response body gains a `duplicateOf: { id, invoiceNumber }` field — **Not Stored** on the invoice, present only so the client can explain the rejection instead of showing a generic success toast (a duplicate returns **200, not 4xx**, so clients must check this field rather than relying on the status code).

Match key is deliberately vendor-scoped, **not** company-scoped: the same vendor reusing an invoice number across different bill-to companies still counts as a duplicate. `REJECTED` rows are excluded so a rejected duplicate doesn't permanently burn the number.

The application check and the write aren't atomic, so a concurrent submission can claim the number in between; the partial unique index `invoices_vendor_invoice_number_active_uidx` (migration `20260902000000_invoice_duplicate_guard`) turns that race into a Prisma `P2002`, which the route catches and funnels into the same auto-reject path.

**Marking an invoice `PAID`** (`PAYMENT_SCHEDULED → PAID` is the only valid entry — see `VALID_TRANSITIONS`; `GA_STAFF`/`GA_MANAGER`/`ADMIN` only, never reachable by `VENDOR` since `status` isn't in its writable-fields list at all): `invoices.paid_by` is **always server-assigned** to `session.user.id`, never client-supplied. `paidDate` defaults to `now()` and `paidAmount` defaults to `invoices.total_amount` when the caller omits them (partial-payment amounts can still be supplied explicitly). `PAID`'s only outbound edge is `→ CLOSED`.

Writes: `invoices` row (partial update, only the filtered/allowed fields). `audit_logs` — `action: 'invoice.status_changed'` with `metadata: { from, to, comment }` (the optional `comment` field is **Not Stored** on the invoice itself, only in this audit metadata) when `status` changes, else `action: 'invoice.updated'` with `metadata: { fields: [...changed keys] }`. Any status change also fires the `status_changed` reminder trigger, notifying the invoice's own vendor — see § Invoice-event notifications.

### `PATCH /api/invoices/[id]/stage`
Auth: `ADMIN`, `GA_STAFF`, `GA_MANAGER` (vendors are read-only on `picStage`). Body validated by `updateInvoiceStageSchema` (`{ stage: PICStage }`) — no transition restriction, any of the 5 stages is reachable from any other (unlike `status`, this is a free control).

Writes: `invoices.pic_stage`, a new `invoice_stage_history` row (`stage`, `changed_by_id` = session user id, `changed_at` = `now()`), `audit_logs` (`action: 'invoice.stage_changed'`, `metadata: { from, to }`).

Fires the **`stage_assigned`** reminder trigger when the stage actually changes value — re-selecting the current stage still appends a history row (an explicit "still here" record) but doesn't re-notify. Unlike `status_changed`, recipients are the **role group** on the setting, never the invoice's vendor: `pic_stage` is internal routing and is scrubbed from vendor-facing responses entirely, so telling a vendor their invoice moved to SSU would leak process detail they can't act on. Gated by `isActive` and the two channel flags like every other type.

### `DELETE /api/invoices/[id]`
Auth: `ADMIN` only. **Hard delete** — the row is actually removed (there is no `CANCELLED` status in the current `InvoiceStatus` enum to soft-cancel into). Writes `audit_logs` (`action: 'invoice.deleted'`) before the delete.

### `POST /api/invoices/[id]/upload`
Auth: `ADMIN`, `VENDOR`, `GA_STAFF`, `GA_MANAGER` (vendor scoped to own invoices — 403 otherwise). Rate-limited **30 requests/min/user** (`MAX_DOCUMENTS_PER_INVOICE * 3`), sized so one full legitimate submission never rate-limits itself partway through. Before this, classification was the only unmetered paid-AI path behind plain authentication.

Validates, all from `src/lib/uploadLimits.ts` so the browser and this route enforce identical rules:

| Rule | Constant | Failure |
|---|---|---|
| MIME allowlist (`pdf`/`jpeg`/`jpg`/`png`) | `ACCEPTED_MIME_TYPES` | 400 |
| Magic-byte signature vs. the claimed extension (prevents MIME spoofing) | `hasValidSignature()` / `MAGIC_SIGNATURES` | 400 |
| Max file size 10MB | `MAX_FILE_SIZE_BYTES` | 400 |
| Max documents already on this invoice | `MAX_DOCUMENTS_PER_INVOICE` (10) | 400 |

`MAX_DOCUMENTS_PER_INVOICE` is the single knob for the file count — nothing else in the codebase hardcodes one. It is an initial technical limit, not a business rule: raise it in that one file.

**Every file is classified**, including the first. The `primary=true` form field is **gone**: it used to skip classification (the extraction call that immediately followed classified it for free) and point the legacy mirror at that file. Extraction no longer follows immediately — it runs after all uploads, and it is the classification of *all* files that decides which document it reads, so every label must exist before then.

Writes: file to storage via `saveUploadedFile()` (`src/lib/services/fileService.ts`) at `{invoiceId}/{documentId}.{ext}`, one `invoice_documents` row (`type`/`classification_confidence` from `classifyDocument()`), `invoices.file_path`/`file_type` **only when currently null** (seeding the legacy mirror so an invoice whose OCR never ran still has a readable file; the OCR route repoints it at whichever document it actually reads), and `audit_logs` (`action: 'invoice.file_uploaded'`, `metadata: { documentId, fileName, fileType, type, classificationConfidence }`). Returns the created `invoice_documents` row (**not** the invoice, unlike before this became multi-file).

**Multiple files per invoice** — each call creates a new document rather than overwriting, so the client posts once per file. Classification failure (Gemini down, no API key) is caught and falls back to `OTHER`: a classification problem must never lose a user's upload.

> **No idempotency key.** Two identical POSTs create two document rows. The wizard compensates by keeping only the *failed* files staged after a batch, so a retry uploads exactly what is missing, and by reading the document list back from `GET /api/invoices/[id]` rather than from its own responses — otherwise rows left by a partially failed attempt would be invisible in the review step, and so impossible to relabel or remove.

### `PATCH /api/invoices/[id]/documents/[documentId]`
Auth: `ADMIN`, `GA_STAFF`, `GA_MANAGER`, plus `VENDOR` **for their own invoice while `is_draft` is true** (`canMutateDocuments()`, `src/lib/auth/permissions.ts`; ownership proven by `requireInvoiceAccess`). The vendor grant exists because the confirmation step asks the uploader to check the AI's classification, and the uploader was previously the one role that could not act on it — the review UI rendered the type picker and remove button for vendors and every click 403'd. Scoped to a draft so a vendor can never relabel documents on an invoice already in GA or finance review. Body `{ type }` validated by `updateDocumentTypeSchema` (one of `INVOICE`/`TAX_INVOICE`/`BAST`/`OTHER`). 404 if the document doesn't belong to this invoice.

This is the manual override that actually guarantees a misclassified document gets corrected — the AI label is a starting point, not the final word, and the control is offered on every document, not only low-confidence ones. Writes: `invoice_documents.type`, and **clears `classification_confidence` to null** (it described certainty in a label that no longer applies; leaving it would make a human-assigned type render as a machine guess). Writes `audit_logs` (`action: 'invoice.document_reclassified'`, `metadata: { documentId, from, to }`).

### `DELETE /api/invoices/[id]/documents/[documentId]`
Auth: `ADMIN`, `GA_STAFF`, `GA_MANAGER`, plus `VENDOR` for their own draft (same `canMutateDocuments()` rule as the PATCH above). Removes a document attached by mistake. Hard-deletes the row; the **storage object is deliberately left in place** (orphaned but harmless) so an accidental click stays recoverable — every read path goes through the row, not the blob. Writes `audit_logs` (`action: 'invoice.document_removed'`, `metadata: { documentId, originalName, type }`).

### `GET /api/invoices/[id]/documents/[documentId]/file`
Auth: any authenticated user; `VENDOR` gets 403 unless the document's invoice belongs to their vendor. The lookup is scoped by `invoiceId` **and** `documentId`, so a document id from another invoice can't be read by pairing it with an invoice the caller is allowed to see. **Not Stored** — streams the raw bytes at `invoice_documents.file_path`. The older `GET /api/invoices/[id]/file` still serves the legacy single `invoices.file_path` and is unchanged.

### `GET /api/invoices/[id]/ocr` (SSE stream)
Auth: any authenticated user, rate-limited **5 requests/min/user** (`src/lib/rate-limit.ts`). Optional query param **`?documentId=`** forces extraction to read exactly that document (404-style error event if it isn't on this invoice); without it the route chooses — see below.

**Which document is read.** Every file was already classified at upload time. Extraction reads exactly one of them, and the choice is not free: pulling a bill-to company or a PO out of a faktur pajak or a BAST produces confidently wrong data, which is worse than none. So:

1. Only a document whose `invoice_documents.type` is `INVOICE` qualifies. `normalizeClassification()` has already refused to apply that label below `CLASSIFICATION_CONFIDENCE_FLOOR` (70), so "is INVOICE" already means "confident enough" — there is no second threshold here.
2. Among those, a type a **human** assigned wins over any AI guess (`classification_confidence IS NULL` marks a human decision, so `nulls: 'first'`), then the highest AI confidence, then upload order as a stable tiebreak.
3. If nothing qualifies, the route emits **`needs_invoice_selection`** and closes **without extracting anything**. There is deliberately no "use the first file" fallback. The confirmation step then asks the user which document is the invoice and re-runs with `?documentId=`.

Streams `status`, `driving_document`, `needs_invoice_selection`, `document_type`, `company`, `field`, `line_items`, `warning`, `done`/`error` events.

| Streamed field | Source |
|---|---|
| `driving_document.{documentId,originalName,type,classificationConfidence}` | `invoice_documents.*` for the document selected above — **Not Stored** as an API field, it identifies which row the rest of the stream came from |
| `needs_invoice_selection.documents[]` | `invoice_documents.{id,original_name,type,classification_confidence}` for every document on the invoice — **Not Stored**, a prompt for the user to resolve |
| `company.{companyId,status,matchedOn}` | `formula` — `matchCompany()` (`src/lib/companyMatch.ts`) over `companies` rows where `is_active = true`, keyed on `companies.npwp` then normalized `companies.name`. `status` is `MATCHED`/`UNMATCHED`/`AMBIGUOUS`; two or more hits is `AMBIGUOUS` and resolves to `companyId: null`, never a pick (`companies.name` has no unique constraint). **Not Stored** — the client sends the confirmed id back via `PATCH` |
| `company.{extractedName,extractedNpwp,confidence}` | Gemini `company_name` / `company_npwp` fields (the invoice's bill-to block) — **Not Stored**. Surfaced alongside the verdict so the confirmation page can show what was *read* versus what it *matched* |
| `field.value`, `field.confidence` (per invoice field) | Gemini vision extraction response (`extractInvoiceFields()`, `src/lib/services/geminiExtraction.ts`) — **Not Stored** as a distinct field, only the final parsed values persist |
| Persisted after stream: `invoiceDate`, `dueDate`, `currency`, `subtotal`, `taxAmount`, `totalAmount` | Written to `invoices.*` from the Gemini response, falling back to existing DB value if the field wasn't extracted |
| `invoiceNumber` | **Streamed but deliberately NOT persisted here.** It's the field the duplicate check keys on, and that check lives only in `PATCH /api/invoices/[id]` — writing it here would slip past it. The client receives it via the `field` event and submits it through `PATCH`, which duplicate-checks it properly. See the note in the route for the two failures this caused when OCR did write it |
| `po_number` (new), and `companyId` | **Streamed but deliberately NOT persisted here**, for the same class of reason: both gate the draft→live transition in `validateReadyToGoLive`, and writing them straight from OCR would satisfy that gate with data no human confirmed. They return through `PATCH` |
| `ocrConfidence` | `invoices.ocr_confidence` ← `overall_confidence`, computed in `extractInvoiceFields()` as the average confidence of the 7 `CORE_FIELDS` that came back non-null (same formula the old Python service used). Unchanged by the new fields — `company_name`, `company_npwp` and `po_number` are deliberately **not** in `CORE_FIELDS`, so this metric means the same thing it always did |
| `document_type` SSE event, and persisted | `invoice_documents.type` / `.classification_confidence` for the document this OCR ran against, refining the cheap classify-only label from upload. **Skipped entirely when `classification_confidence IS NULL`** — that marks a human-assigned type, and overwriting it would demote the very file the user just marked as the invoice, leaving the next run with nothing to read again |
| Line items | `invoice_items.*` — existing rows for the invoice are deleted and replaced from `line_items[]` in the Gemini response |
| `warning.fields[]` | `formula` — extraction keys rejected by `buildOcrUpdate()` validation; **Not Stored** |

Side effect: `invoices.file_path`/`file_type` are repointed at the document that was read, keeping the legacy mirror consistent with the three read paths still using it.

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

Query params (all optional, all combine with AND): `search` (matches `invoice_number`, case-insensitive), `status`, `vendorId` (non-vendor roles only), `companyId`, `from`/`to` (filters `due_date`), plus `poNumber`/`picId`/`amountMin`/`amountMax` via the shared `applyInvoiceSearchFilters()`, plus `kpi`.

**`kpi` — the selected KPI card, acting as a dashboard filter.** The four cards are clickable; each is identified by the *business predicate* behind its figure, never by its UI label (an unrecognised value, including a label string, is ignored and echoed back as `null`):

| `kpi` | Card | Predicate AND-ed onto the filter |
|---|---|---|
| *(absent)* | Total Invoices | none — this card is the reset |
| `payable` | Total Tagihan | `status NOT IN ('PAID','CLOSED','REJECTED')` |
| `open` | Invoice Terbuka | same as `payable` |
| `overdue` | Jatuh Tempo | the above, plus `due_date < jakartaDayStart()` |

Applied by `applyKpiScope()` as `{ AND: [filter, ...] }`, so it can only ever **narrow** — the `VENDOR` scoping inside `filter` cannot be overwritten by a card — and it does not collide with the per-bucket `due_date` the aging aggregates set on top.

`kpi` is deliberately **not** part of `buildDashboardFilter()`: that builder also backs `GET /api/invoices` (which must not start honouring it), and it is what the KPI figures are computed from. So `totalInvoices`, `totalPayable`, `overdueCount` and `openCount` **ignore** `kpi` and keep their existing business definition, while `statusBreakdown`, `agingBuckets`, `monthlyTrend`, `statusByMonth`, `companyBreakdown`, `stageLeadTimes` and `recentInvoices` all follow it. `GET /api/dashboard/export` also ignores `kpi` — only the dashboard is card-filtered.

Aside from `kpi`, every field below reflects the same filtered set; there's no partially-filtered view.

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
| `companyBreakdown[]` | `formula`: `GROUP BY invoices.company_id` over the filtered set → `{companyId, companyName, count, totalAmount}`, sorted by `totalAmount` descending. Company names come from a second `companies` query (Prisma `groupBy` can't include a relation). Invoices with no company are kept as a `companyId: null` row rather than dropped — a missing bill-to is worth seeing |
| `stageLeadTimes[]` | `formula`: `foldStageLeadTimes()` over `invoice_stage_history` rows for the filtered invoices → `{stage, avgDays, completed, currentCount}` for all 5 stages in workflow order. A stage's duration is the gap to the **next** history row of the same invoice; the last row per invoice is still open, so it counts toward `currentCount` (invoices sitting there now) but **not** the average. Rows are ordered by `(invoice_id, changed_at)`, which is what keeps every gap non-negative even when a stage was recorded out of workflow order. `avgDays` is null when no invoice has completed that stage — rendered as "—", not 0 |
| `recentInvoices[]` | `invoices.*` (10 most recent by `created_at` within the filtered set, narrowed by `kpi`) + `vendor.name` + `company.name` |
| `kpi` | `formula`: the accepted `?kpi` value, or `null` — **Not Stored** |

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
Auth: `ADMIN` only. Body: `{ role?, isActive?, vendorId?, email?, password? }`. Rejects (400) if the resulting role is `VENDOR` with no `vendorId`. Returns 409 on an email collision (`users.email` is `@unique`) instead of surfacing a Prisma `P2002` as a 500.

`email` and `password` are the **admin-side counterpart to the vendor credential lockdown**: a vendor may change neither its own login email nor (after the forced first change) its own password, so this route is the only path for either. Without it the restriction would be a dead end.

| Body field | Writes | Notes |
|---|---|---|
| `role` | `users.role`, and `users.vendor_id` forced to null for non-VENDOR | unchanged |
| `isActive` | `users.is_active` | unchanged; deactivated users fail login at `authorize()` (`!user.isActive` in `auth.ts`) |
| `vendorId` | `users.vendor_id` | unchanged |
| `email` | `users.email` | the login identity |
| `password` | `users.password_hash` = `bcrypt.hash(password, 12)` **and `users.must_change_password = true`** | applies to every role. The value an admin types is always a handover secret, never the account's live credential — the recipient is forced to replace it at their next sign-in, so no admin ends up holding a working vendor password |

Audit rows are now per credential event rather than one blanket `user.role_updated` (which previously described a password reset as a role change). The password itself is never logged.

| Condition | `audit_logs.action` | `metadata` |
|---|---|---|
| role actually changed | `user.role_updated` | `{ from, to }` |
| email actually changed | `user.email_changed` | `{ from, to }` |
| `password` supplied | `user.password_reset` | `{ role, mustChangePassword: true }` |
| `isActive` supplied | `user.active_changed` | `{ isActive }` |
| none of the above (e.g. `vendorId` only) | `user.updated` | `{ fields }` |

> **A reset does not evict a live session.** Sessions are stateless JWTs with no revocation mechanism, so an existing browser session keeps working until the token expires. To cut off access immediately, deactivate the account (`{ isActive: false }`) and then reset the password.

### `PATCH /api/users/me/password`
Auth: any authenticated user, changing their own password only (no `id` param — always `session.user.id`). Body validated by `changePasswordSchema` (`{ currentPassword, newPassword }`). Verifies `currentPassword` against `users.password_hash` first (400 if wrong).

**403 for a `VENDOR` whose `must_change_password` is already false** (`canChangeOwnPassword()`, `src/lib/auth/permissions.ts`). A vendor account gets exactly one self-service change — the forced one at first login — after which only an admin can issue a new password, which re-arms the flag and grants another single forced change. So every vendor password change is admin-initiated, and no admin ever holds a vendor's live password. The flag is read **from the database, not the session**: the JWT is stateless and its copy can lag an admin reset by the token's lifetime. Every other role keeps unrestricted self-service, exactly as before.

Writes: `users.password_hash` (rehashed), `users.must_change_password = false`, `audit_logs` (`action: 'user.password_changed'` — the row migration `20260910000000` keys on to tell who has genuinely completed a change). The `/change-password` page calls NextAuth's client-side `update()` after a successful response to refresh the JWT (`trigger: 'update'` branch in `auth.ts`'s `jwt` callback re-reads `must_change_password` from the DB) — otherwise the stateless JWT would keep gating the user until natural token expiry.

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

Two `reminder_settings`-gated triggers, fired inline from the invoice routes (not the cron job):

- **`status_changed`** — `PATCH /api/invoices/[id]`, whenever `status` actually changes value. Notifies every active `VENDOR`-role user linked to the invoice's `vendorId` — `recipientRoles` is not consulted for this type (the recipient is always the invoice's own vendor). Also fires on a duplicate auto-rejection, which is exactly when the vendor most needs to know.
- **`stage_assigned`** — `PATCH /api/invoices/[id]/stage`, when `pic_stage` changes value. Notifies active users in the configured `recipientRoles` (default `GA_STAFF`/`GA_MANAGER`) and **never the vendor** — see that route above for why.

Both are gated by their `reminder_settings` row: `isActive`, plus `inAppEnabled`/`emailEnabled` independently.

If `RESEND_API_KEY` isn't configured, the email call no-ops silently (`src/lib/services/email.ts`) rather than failing the request.

> **Dead config, not yet wired up:** `invoice_submitted` and `revision_requested` exist as configurable rows/types (`REMINDER_TYPES` in `src/lib/validations.ts`, editable at `/admin/reminders`) but **nothing in the codebase fires them** — they're leftover from a removed `DRAFT`/`SUBMITTED`/`REVISION` status model that predates both the 4-value verification-workflow enum and this 17-value overhaul. An admin can toggle these settings with no effect. Left as-is per the approved plan (out of scope for the current batch of work) — flagged here so it isn't mistaken for working.

## System

### `GET /api/health`
No auth. Runs `SELECT 1` against the database. Returns `{ status: 'ok'|'degraded', app: 'ok', db: 'ok'|'error' }`. **Not Stored**.

### `POST /api/auth/[...nextauth]`, `GET /api/auth/[...nextauth]`
NextAuth v5 handler (`src/lib/auth/auth.ts`). Credentials provider: looks up `users.email`, checks `users.is_active`, verifies `bcrypt.compare(password, users.password_hash)`. On success, JWT carries `id`, `role`, `vendorId` (all from `users.*`); session mirrors the JWT.

