-- Extend Vendor with fields the vendor can self-service edit, and add
-- VendorContact for multiple PICs per vendor. See docs/PRODUCTION_PLAN.md §6.5.

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "address" TEXT;
ALTER TABLE "vendors" ADD COLUMN "city" TEXT;
ALTER TABLE "vendors" ADD COLUMN "phone" TEXT;
ALTER TABLE "vendors" ADD COLUMN "bank_account_holder" TEXT;
ALTER TABLE "vendors" ADD COLUMN "bank_branch" TEXT;

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
