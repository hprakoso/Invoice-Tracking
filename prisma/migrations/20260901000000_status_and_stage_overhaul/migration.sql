-- Bundles three pending schema changes into one migration: (1) `po_number` on
-- invoices, (2) `PICStage` + `invoice_stage_history` (who currently holds an
-- invoice, and the timestamped trail used for lead-time/SLA calculations),
-- (3) a full `InvoiceStatus` overhaul replacing the old
-- DRAFT/SUBMITTED/PAID/CANCELLED/REJECTED/VOID/REVISION lifecycle with the
-- 17-value workflow described in the "Smart Invoice Payment" business
-- requirement doc (minus PR/PO/Advance states — out of scope for this
-- system per product decision, PR/PO already exist before an invoice
-- reaches here). See docs/PRODUCTION_PLAN.md history for the old enum and
-- the approved plan for the new one.
--
-- (1) and (2) were already reflected in prisma/schema.prisma from earlier
-- work but never migrated — this is the first migration to actually apply
-- them, alongside the status overhaul.

-- ============================================================
-- 1. po_number
-- ============================================================
-- Nullable-then-backfill-then-NOT NULL: existing rows have no PO number on
-- record, so a placeholder is required before the NOT NULL constraint can
-- be applied. 'N/A' flags these for follow-up review by GA staff rather
-- than silently fabricating a real-looking PO number.
ALTER TABLE "invoices" ADD COLUMN "po_number" TEXT;
UPDATE "invoices" SET "po_number" = 'N/A' WHERE "po_number" IS NULL;
ALTER TABLE "invoices" ALTER COLUMN "po_number" SET NOT NULL;

-- ============================================================
-- 2. PICStage + invoice_stage_history
-- ============================================================
CREATE TYPE "PICStage" AS ENUM ('GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY');

ALTER TABLE "invoices" ADD COLUMN "pic_stage" "PICStage" NOT NULL DEFAULT 'GA';

CREATE TABLE "invoice_stage_history" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "stage" "PICStage" NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" TEXT,

    CONSTRAINT "invoice_stage_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_stage_history" ADD CONSTRAINT "invoice_stage_history_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_stage_history" ADD CONSTRAINT "invoice_stage_history_changed_by_id_fkey"
  FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one GA-stage history row per existing invoice, dated at
-- creation and attributed to whoever created it (the closest available
-- proxy for "who first touched it") — every invoice needs at least one
-- stage-history row for the lead-time UI to have a starting point.
INSERT INTO "invoice_stage_history" ("id", "invoice_id", "stage", "changed_at", "changed_by_id")
SELECT gen_random_uuid()::text, "id", 'GA', "created_at", "created_by" FROM "invoices";

-- ============================================================
-- 3. InvoiceStatus overhaul (type-swap, same pattern as migration
--    20260726171012_simplify_roles)
-- ============================================================
CREATE TYPE "InvoiceStatus_new" AS ENUM (
  'RECEIVED', 'REGISTERED', 'DOC_VERIFICATION', 'FINANCE_VERIFICATION', 'READY_FOR_PAYMENT',
  'TREASURY_PROCESS', 'PAYMENT_SCHEDULED', 'PAID', 'CLOSED',
  'DOC_INCOMPLETE', 'RETURNED_TO_VENDOR', 'WAITING_USER_CONFIRMATION', 'WAITING_APPROVAL',
  'WAITING_TAX_DOCUMENT', 'REJECTED', 'PAYMENT_HOLD', 'VENDOR_BANK_ISSUE'
);

ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;

-- Data mapping (old -> new), a judgment call over demo/seed data (confirmed
-- safe to auto-remap): DRAFT (never-submitted wizard session) -> RECEIVED;
-- SUBMITTED (the old generic "in review" bucket, no finer-grained stage
-- info available) -> REGISTERED; PAID -> PAID; CANCELLED and VOID (both
-- "abandoned, no longer valid") -> REJECTED; REJECTED -> REJECTED;
-- REVISION (sent back to vendor for correction) -> RETURNED_TO_VENDOR, its
-- direct semantic match in the new model.
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING (
  (CASE "status"::text
    WHEN 'DRAFT'     THEN 'RECEIVED'
    WHEN 'SUBMITTED' THEN 'REGISTERED'
    WHEN 'PAID'      THEN 'PAID'
    WHEN 'CANCELLED' THEN 'REJECTED'
    WHEN 'REJECTED'  THEN 'REJECTED'
    WHEN 'VOID'      THEN 'REJECTED'
    WHEN 'REVISION'  THEN 'RETURNED_TO_VENDOR'
  END)::"InvoiceStatus_new"
);

ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

DROP TYPE "InvoiceStatus";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
