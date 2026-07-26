-- Payment tracking: invoices can now be marked PAID (system-recorded, not a
-- real payment gateway) by GA_STAFF/GA_MANAGER/ADMIN. See docs/PRODUCTION_PLAN.md §5.3.

ALTER TYPE "InvoiceStatus" ADD VALUE 'PAID';

ALTER TABLE "invoices" ADD COLUMN "paid_date" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "paid_amount" DECIMAL(15,2);
ALTER TABLE "invoices" ADD COLUMN "paid_by" TEXT;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_by_fkey"
  FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
