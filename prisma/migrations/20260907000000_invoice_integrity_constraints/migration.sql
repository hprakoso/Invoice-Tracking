-- Integrity constraints and indexes for the invoice table.
--
-- Hand-written rather than generated: `prisma migrate dev` needs a shadow
-- database, which the local Postgres container refuses to create (template1
-- collation version mismatch), and the CHECK constraints and the date
-- normalisation below have no schema-diff equivalent anyway.

-- 1. Draft flag ------------------------------------------------------------
-- The upload wizard has to create the invoice row before OCR runs (it needs an
-- id to attach the uploaded file to). Abandoning the wizard therefore left a
-- fully live RECEIVED invoice behind: counted in every KPI, listed like any
-- other invoice, and emailed about daily by the reminder cron once OCR had
-- written a past due date onto it. Rows stay drafts until the review step is
-- confirmed.
ALTER TABLE "invoices" ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false;

-- Existing placeholder rows are drafts by definition: the wizard names them
-- DRAFT-<timestamp> and only replaces that with a real number on confirmation.
UPDATE "invoices" SET "is_draft" = true WHERE "invoice_number" LIKE 'DRAFT-%';

-- 2. Normalise date-valued columns to calendar dates -----------------------
-- These columns hold dates, not instants: the app writes them from
-- 'YYYY-MM-DD' strings (UTC midnight), but rows created by older seed runs
-- carried the run's time-of-day. A due date of 2026-09-07T18:44 is excluded by
-- a `due_date <= '2026-09-07'` range filter, so an invoice could vanish from
-- the dashboard and the Excel export on its own due day while the unfiltered
-- list still showed it.
UPDATE "invoices"
SET "invoice_date"   = date_trunc('day', "invoice_date"),
    "due_date"       = date_trunc('day', "due_date"),
    "send_date"      = date_trunc('day', "send_date"),
    "delivered_date" = date_trunc('day', "delivered_date"),
    "paid_date"      = date_trunc('day', "paid_date")
WHERE "invoice_date"   <> date_trunc('day', "invoice_date")
   OR "due_date"       <> date_trunc('day', "due_date")
   OR "send_date"      <> date_trunc('day', "send_date")
   OR "delivered_date" <> date_trunc('day', "delivered_date")
   OR "paid_date"      <> date_trunc('day', "paid_date");

-- 3. CHECK constraints -----------------------------------------------------
-- An invoice cannot fall due before it was issued. Nothing enforced this at
-- any layer: not zod, not the routes, not the database — which is how the
-- dashboard came to report overdue invoices that no invoice detail page could
-- explain.
--
-- NOTE: this statement fails if the target database still holds rows where
-- due_date < invoice_date. That is deliberate — those rows are wrong financial
-- data and silently rewriting them in a migration would hide the problem.
-- Inspect them first:
--   SELECT id, invoice_number, invoice_date, due_date
--   FROM invoices WHERE due_date < invoice_date;
-- and correct or clear them before re-running.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_date_after_invoice_date"
  CHECK ("due_date" IS NULL OR "invoice_date" IS NULL OR "due_date" >= "invoice_date");

-- Amounts are Decimal(15,2) with no lower bound, so a bad OCR read ('-500000',
-- previously written straight through with parseFloat) could store a negative
-- and quietly subtract from every dashboard SUM.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_non_negative"
  CHECK (
    "total_amount" >= 0
    AND ("subtotal"    IS NULL OR "subtotal"    >= 0)
    AND ("tax_amount"  IS NULL OR "tax_amount"  >= 0)
    AND ("paid_amount" IS NULL OR "paid_amount" >= 0)
  );

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_total_non_negative"
  CHECK ("total" >= 0);

-- 4. Indexes ---------------------------------------------------------------
-- The schema declared no @@index at all, and Postgres does not index foreign
-- keys automatically, so every dashboard aggregate, list filter, notification
-- poll and cron sweep was a sequential scan.
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");
CREATE INDEX "invoices_vendor_id_idx" ON "invoices"("vendor_id");
CREATE INDEX "invoices_company_id_idx" ON "invoices"("company_id");
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");
CREATE INDEX "invoice_stage_history_invoice_id_changed_at_idx" ON "invoice_stage_history"("invoice_id", "changed_at");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");
CREATE INDEX "notifications_type_created_at_idx" ON "notifications"("type", "created_at");
