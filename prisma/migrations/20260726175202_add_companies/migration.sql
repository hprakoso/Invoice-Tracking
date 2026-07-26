-- Company: the invoice-receiving entity ("bill-to"), distinct from Vendor
-- (the sender). Nullable on invoices for now — backfilled by seed data;
-- see docs/PRODUCTION_PLAN.md §6.3.

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npwp" TEXT,
    "address" TEXT,
    "city" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "company_id" TEXT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
