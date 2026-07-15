# Database

PostgreSQL 16 + pgvector extension. Schema managed by Prisma (`prisma/schema.prisma`), migrations in `prisma/migrations/`. Local instance runs via `docker-compose.yml`, mapped to host port **5433** (container port 5432) to avoid clashing with a locally installed Postgres.

## Connection & SSL

`src/lib/db/prisma.ts` does **not** rely on `sslmode` in the connection string — it strips `sslmode`/`sslaccept` query params and builds an explicit `pg.Pool` with `ssl: { rejectUnauthorized: false }` only when `DATABASE_SSL_REJECT_UNAUTHORIZED=false` is set. This exists because Supabase's pooler ignores `sslmode` URL params under the Prisma v7 `@prisma/adapter-pg` driver adapter — see commits `880802f`, `ee4298c`, `da12472`, `7341c82`. Local dev does not need this flag (docker-compose Postgres has no TLS).

## Entity-relationship summary

```
User ──(vendorId, optional)──> Vendor
User ──1:N──> Invoice (createdBy)
User ──1:N──> Invoice (pic, optional — GA Staff who received the hardcopy)
User ──1:N──> AuditLog (optional)
User ──1:N──> Notification

Vendor ──1:N──> Invoice
Vendor ──1:N──> User (vendor-portal users)

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
| role | enum `Role` | `ADMIN`, `MANAGER` (deprecated, kept for back-compat), `FINANCE`, `VIEWER`, `GA_STAFF`, `GA_MANAGER`, `VENDOR` |
| password_hash | text | bcrypt, cost 12 (migrated from SHA-256, commit `dc87d56`) |
| is_active | bool, default true | inactive users cannot authenticate |
| created_at / updated_at | timestamp | |
| vendor_id | uuid FK → `vendors.id`, nullable | set only for `VENDOR` role; drives data isolation |

### `vendors`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| npwp | text, nullable | Indonesian tax ID |
| contact_name / contact_email | text, nullable | |
| bank_name / bank_account | text, nullable | |
| is_active | bool, default true | |
| created_at | timestamp | |

### `invoices`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| vendor_id | uuid FK → `vendors.id` | |
| invoice_number | text | |
| invoice_date / due_date | timestamp, nullable | |
| currency | text, default `IDR` | |
| subtotal / tax_amount | decimal(15,2), nullable | |
| total_amount | decimal(15,2) | |
| status | enum `InvoiceStatus` | `SUBMITTED` (default, set on create) → one of `CANCELLED`, `REJECTED`, `VOID` (terminal), or `REVISION` (loops back to `SUBMITTED`) — see [ARCHITECTURE.md](./ARCHITECTURE.md#invoice-status-lifecycle) and `src/lib/validations.ts::VALID_TRANSITIONS`. `PAID` was removed — this app never records actual payment, Finance pays outside the system. |
| send_date | timestamp, nullable | date the vendor sent the physical hardcopy to the office; set by `VENDOR` (own invoice) or `GA_STAFF`/`ADMIN` |
| delivered_date | timestamp, nullable | date GA Staff physically received the hardcopy; set by `GA_STAFF`/`ADMIN`; must not be earlier than `send_date` (`validateDeliveryDates()`) |
| pic_id | uuid FK → `users.id`, nullable | person in charge — the `GA_STAFF` user handling this invoice's intake; defaults to the creating `GA_STAFF` user, reassignable |
| ocr_confidence | float, nullable | overall confidence score written by the OCR route (0–100), sourced from the AI service's `overall_confidence` |
| file_path / file_type | text, nullable | local disk path under `uploads/invoices/`; never returned raw to VENDOR-role users from other vendors (IDOR check in `/api/invoices/[id]/file`) |
| notes | text, nullable | |
| created_by | uuid FK → `users.id` | now settable by `FINANCE`, `ADMIN`, `VENDOR`, or `GA_STAFF` (previously FINANCE/ADMIN/VENDOR only) |
| created_at / updated_at | timestamp | |

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

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → `users.id` | recipient |
| invoice_id | uuid FK → `invoices.id`, nullable | |
| type | text | `due_soon`, `overdue` (sent to `FINANCE`/`GA_STAFF` for `SUBMITTED`/`REVISION` invoices) |
| title / body | text | Indonesian copy, generated server-side |
| is_read | bool, default false | |
| created_at / read_at | timestamp | |

Deduplication: the reminder scheduler skips creating a `due_soon`/`overdue` notification for a given `(userId, invoiceId, type)` if one was already created in the last 24h (checked via `createdAt >= now - 24h`).

## Migrations

| Migration | Adds |
|---|---|
| `20260608182209_init` | Initial schema — all 7 tables, base `Role` enum (`ADMIN`, `MANAGER`, `FINANCE`, `VIEWER`) |
| `20260618082131_add_vendor_ga_roles` | `VENDOR`, `GA_STAFF`, `GA_MANAGER` roles; `vendor_id` FK on `users` |
| `20260715171000_invoice_workflow_overhaul` | Drops `approval_workflows` table and `ApprovalStatus` enum; replaces `InvoiceStatus` enum values entirely (`SUBMITTED`/`CANCELLED`/`REJECTED`/`VOID`/`REVISION`, `PAID` removed); adds `invoices.send_date`, `delivered_date`, `pic_id` |

## Seed data (`prisma/seed.ts`)

Blocked from running when `NODE_ENV=production` (commit `7b55a52`). Creates 9 demo users (see [SETUP.md](./SETUP.md#demo-accounts)) with bcrypt-hashed `demo123` passwords (incl. a second `GA_STAFF` account for PIC-reassignment demos), demo vendors, and 20 demo invoices distributed across the 5 statuses with `sendDate`/`deliveredDate`/`picId` populated. Destructive — deletes all rows in dependency order before reseeding.
