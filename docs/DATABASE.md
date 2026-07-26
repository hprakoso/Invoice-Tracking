# Database

PostgreSQL 16. Schema managed by Prisma (`prisma/schema.prisma`), migrations in `prisma/migrations/`. Local instance runs via `docker-compose.yml`, mapped to host port **5433** (container port 5432) to avoid clashing with a locally installed Postgres. Previously `pgvector/pgvector:pg16` — no `vector` column ever existed in the schema (chat has always answered from a static context string, not a live vector search, per `docs/ARCHITECTURE.md`), so downgraded to plain `postgres:16`. Chat itself is being rebuilt onto a structured `query_invoices` tool per `docs/PRODUCTION_PLAN.md` §5.2, independent of this change.

## Connection & SSL

`src/lib/db/prisma.ts` does **not** rely on `sslmode` in the connection string — it strips `sslmode`/`sslaccept` query params and builds an explicit `pg.Pool` with `ssl: { rejectUnauthorized: false }` only when `DATABASE_SSL_REJECT_UNAUTHORIZED=false` is set. This exists because Supabase's pooler ignores `sslmode` URL params under the Prisma v7 `@prisma/adapter-pg` driver adapter — see commits `880802f`, `ee4298c`, `da12472`, `7341c82`. Local dev does not need this flag (docker-compose Postgres has no TLS).

## Entity-relationship summary

```
User ──(vendorId, optional)──> Vendor
User ──1:N──> Invoice (createdBy)
User ──1:N──> Invoice (pic, optional — GA Staff who received the hardcopy)
User ──1:N──> Invoice (paidBy, optional — who marked it PAID)
User ──1:N──> AuditLog (optional)
User ──1:N──> Notification
User ──1:N──> ReminderSetting (updatedBy, optional)

Vendor ──1:N──> Invoice
Vendor ──1:N──> User (vendor-portal users)
Vendor ──1:N──> VendorContact (cascade delete)

Company ──1:N──> Invoice (optional — the bill-to entity, distinct from Vendor)

Invoice ──1:N──> InvoiceItem (cascade delete)
Invoice ──1:N──> AuditLog (optional)
Invoice ──1:N──> Notification (optional)
```

## Tables

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `default(uuid())` |
| email | text, unique | login identifier |
| name | text | |
| role | enum `Role` | `ADMIN`, `GA_STAFF`, `GA_MANAGER`, `VENDOR`. `MANAGER`/`FINANCE`/`VIEWER` were removed in migration `20260726171012_simplify_roles` (see `docs/PRODUCTION_PLAN.md` §4.9) — `GA_MANAGER` now carries `GA_STAFF`'s operational permissions plus supervisory access (audit log, AI chat) |
| password_hash | text | bcrypt, cost 12 (migrated from SHA-256, commit `dc87d56`) |
| is_active | bool, default true | inactive users cannot authenticate |
| must_change_password | bool, default true | set on every `POST /api/users`-created account; cleared by `PATCH /api/users/me/password`. `middleware.ts` redirects any page route to `/change-password` while true — added in migration `20260726181558_add_must_change_password`. Demo seed accounts explicitly set this `false` so the shared `demo123` login isn't gated |
| created_at / updated_at | timestamp | |
| vendor_id | uuid FK → `vendors.id`, nullable | set only for `VENDOR` role; drives data isolation |

### `vendors`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | **`ADMIN`-only to change** — used to match tax documents |
| npwp | text, nullable | Indonesian tax ID — **`ADMIN`-only to change**, same reason |
| contact_name / contact_email | text, nullable | primary contact; self-editable by the linked `VENDOR` |
| bank_name / bank_account | text, nullable | self-editable |
| address / city / phone | text, nullable | self-editable — added in migration `20260726180556_extend_vendor_profile` |
| bank_account_holder / bank_branch | text, nullable | self-editable — added in the same migration |
| is_active | bool, default true | |

### `vendor_contacts`
Multiple PICs per vendor (finance, sales, ops, ...) — kept as a separate table rather than flat fields on `vendors`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| vendor_id | uuid FK → `vendors.id`, `onDelete: Cascade` | |
| name | text | |
| email / phone | text, nullable | |
| role | text, nullable | free text, e.g. "Finance", "Sales" |
| created_at | timestamp | |

### `companies`
The invoice-receiving entity ("bill-to") a vendor submits against — distinct from `vendors` (the sender). A vendor may bill several companies; a company may be billed by several vendors.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "PT Sumber Makmur" |
| npwp | text, nullable | Indonesian tax ID |
| address / city | text, nullable | |
| email | text, nullable | billing contact address |
| is_active | bool, default true | soft-delete flag — `DELETE /api/companies/[id]` sets this rather than removing the row |
| created_at / updated_at | timestamp | |

### `invoices`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| vendor_id | uuid FK → `vendors.id` | the sender |
| company_id | uuid FK → `companies.id`, nullable | the bill-to entity; nullable to avoid backfill churn on existing rows (see `docs/PRODUCTION_PLAN.md` §6.3). Required in practice for `VENDOR`-submitted invoices (enforced client-side in the upload wizard, not a DB `NOT NULL`) |
| invoice_number | text | |
| invoice_date / due_date | timestamp, nullable | |
| currency | text, default `IDR` | |
| subtotal / tax_amount | decimal(15,2), nullable | |
| total_amount | decimal(15,2) | |
| status | enum `InvoiceStatus` | `SUBMITTED` (default, set on create) → one of `PAID`, `CANCELLED`, `REJECTED`, `VOID` (all terminal), or `REVISION` (loops back to `SUBMITTED`) — see [ARCHITECTURE.md](./ARCHITECTURE.md#invoice-status-lifecycle) and `src/lib/validations.ts::VALID_TRANSITIONS`. `PAID` re-added in migration `20260726173942_add_payment_tracking` — this is a system record of an outcome decided outside the app (there's no payment gateway integration), not a live payment execution. |
| send_date | timestamp, nullable | date the vendor sent the physical hardcopy to the office; set by `VENDOR` (own invoice) or `GA_STAFF`/`ADMIN` |
| delivered_date | timestamp, nullable | date GA Staff physically received the hardcopy; set by `GA_STAFF`/`ADMIN`; must not be earlier than `send_date` (`validateDeliveryDates()`) |
| pic_id | uuid FK → `users.id`, nullable | person in charge — the `GA_STAFF`/`GA_MANAGER` user handling this invoice's intake; defaults to the creating `GA_STAFF` user, reassignable |
| ocr_confidence | float, nullable | overall confidence score written by the OCR route (0–100), sourced from the AI service's `overall_confidence` |
| file_path / file_type | text, nullable | local disk path under `uploads/invoices/`; never returned raw to VENDOR-role users from other vendors (IDOR check in `/api/invoices/[id]/file`) |
| notes | text, nullable | |
| created_by | uuid FK → `users.id` | settable by `ADMIN`, `VENDOR`, `GA_STAFF`, or `GA_MANAGER` |
| created_at / updated_at | timestamp | |
| paid_date | timestamp, nullable | set when `status → PAID`; defaults to `now()` if the caller doesn't supply one |
| paid_amount | decimal(15,2), nullable | set when `status → PAID`; defaults to `total_amount` if the caller doesn't supply one — an explicit lower value records a partial payment (still a terminal `PAID` status; there's no `PARTIALLY_PAID` state) |
| paid_by | uuid FK → `users.id`, nullable | **always server-assigned** to the acting user's id — never accepted from the request body, regardless of role (including `ADMIN`) |

### `invoice_items`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| invoice_id | uuid FK → `invoices.id`, `onDelete: Cascade` | |
| description | text | |
| quantity | decimal(10,3), nullable | |
| unit_price | decimal(15,2), nullable | |
| total | decimal(15,2) | |
| sort_order | int, default 0 | display order; set from array index on write |

### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → `users.id`, nullable | actor; null for system-initiated actions |
| action | text | dot-namespaced, e.g. `invoice.created`, `invoice.status_changed`, `invoice.file_uploaded`, `user.created`, `user.role_updated` |
| entity_type | text | e.g. `invoice` |
| entity_id | text | id of the affected entity |
| invoice_id | uuid FK → `invoices.id`, nullable | convenience join for invoice-scoped queries |
| metadata | jsonb, nullable | action-specific payload (e.g. `{ fileName, fileType }`, `{ from, to, comment }`) |
| created_at | timestamp | |

Every mutating API route writes one `AuditLog` row per action — see [API.md](./API.md) for the exact `action` string per endpoint.

### `reminder_settings`
Admin-editable config, one row per notification type — replaces what used to be hardcoded constants in `reminderScheduler.ts`. See [API.md](./API.md#reminder-settings).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | text, unique | `due_soon`, `overdue`, `invoice_submitted`, `revision_requested` — the 4 rows `prisma/seed.ts` creates by default |
| is_active | bool, default true | turns the whole trigger off, no deploy needed |
| days_before | int, nullable | only meaningful for `due_soon`; default 3 |
| recipient_roles | jsonb | array of `Role` strings, e.g. `["GA_STAFF","GA_MANAGER"]`. Ignored by `revision_requested`, which always targets the invoice's own vendor |
| extra_emails | jsonb | array of email strings outside the user system (not yet acted on — see `email_enabled`) |
| email_enabled | bool, default true | stored but not yet acted on — email delivery needs Resend, not wired up |
| in_app_enabled | bool, default true | gates whether `notifications` rows get written at all |
| updated_at | timestamp | |
| updated_by | uuid FK → `users.id`, nullable | server-assigned from the session on every `PATCH` |

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → `users.id` | recipient |
| invoice_id | uuid FK → `invoices.id`, nullable | |
| type | text | `due_soon`/`overdue` (cron, `SUBMITTED`/`REVISION` invoices, recipients from `reminder_settings.recipient_roles`), `invoice_submitted` (on `VENDOR`-created invoices, recipients from settings), `revision_requested` (on `status → REVISION`, always the invoice's own `VENDOR` users) |
| title / body | text | Indonesian copy, generated server-side |
| is_read | bool, default false | |
| created_at / read_at | timestamp | |

Deduplication: the reminder scheduler skips creating a `due_soon`/`overdue` notification for a given `(userId, invoiceId, type)` if one was already created in the last 24h (checked via `createdAt >= now - 24h`). `invoice_submitted`/`revision_requested` have no such window — each is a one-shot event tied to a specific action, not a recurring scan.

## Migrations

| Migration | Adds |
|---|---|
| `20260608182209_init` | Initial schema — all 7 tables, base `Role` enum (`ADMIN`, `MANAGER`, `FINANCE`, `VIEWER`) |
| `20260618082131_add_vendor_ga_roles` | `VENDOR`, `GA_STAFF`, `GA_MANAGER` roles; `vendor_id` FK on `users` |
| `20260715171000_invoice_workflow_overhaul` | Drops `approval_workflows` table and `ApprovalStatus` enum; replaces `InvoiceStatus` enum values entirely (`SUBMITTED`/`CANCELLED`/`REJECTED`/`VOID`/`REVISION`, `PAID` removed); adds `invoices.send_date`, `delivered_date`, `pic_id` |
| `20260726171012_simplify_roles` | Drops `MANAGER`, `FINANCE`, `VIEWER` from `Role` enum via type-swap (`UPDATE` remaps any existing rows to `GA_STAFF` first, then `CREATE TYPE ... AS ENUM` + `ALTER TABLE ... TYPE` + `DROP TYPE`); down to 4 roles: `ADMIN`, `GA_STAFF`, `GA_MANAGER`, `VENDOR` |
| `20260726173942_add_payment_tracking` | `ALTER TYPE "InvoiceStatus" ADD VALUE 'PAID'` (additive — no type-swap needed, unlike removing enum values); adds `invoices.paid_date`/`paid_amount`/`paid_by` (FK → `users.id`) |
| `20260726175202_add_companies` | New `companies` table (8th table); adds `invoices.company_id` (nullable FK → `companies.id`) |
| `20260726180556_extend_vendor_profile` | Adds `vendors.address`/`city`/`phone`/`bank_account_holder`/`bank_branch`; new `vendor_contacts` table (9th table) |
| `20260726181558_add_must_change_password` | Adds `users.must_change_password` (`NOT NULL DEFAULT true`) |
| `20260726182449_add_reminder_settings` | New `reminder_settings` table (unique `type`, FK `updated_by` → `users.id`) |

## Seed data (`prisma/seed.ts`)

Blocked from running when `NODE_ENV=production` (commit `7b55a52`). Creates 6 demo users (see [SETUP.md](./SETUP.md#demo-accounts), all with `mustChangePassword: false` so the shared `demo123` quick-login isn't gated) with bcrypt-hashed `demo123` passwords (incl. a second `GA_STAFF` account for PIC-reassignment demos), demo vendors, 2 demo companies (cycled across all 20 invoices by index — see the `company` field on `docs/API.md`'s invoice responses), the 4 default `reminder_settings` rows, and 20 demo invoices distributed across the 6 statuses (2 pre-seeded as `PAID`) with `sendDate`/`deliveredDate`/`picId` populated. Destructive — deletes all rows in dependency order before reseeding.
