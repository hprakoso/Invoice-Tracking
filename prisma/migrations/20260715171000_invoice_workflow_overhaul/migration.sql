-- DropForeignKey
ALTER TABLE "approval_workflows" DROP CONSTRAINT "approval_workflows_invoice_id_fkey";
ALTER TABLE "approval_workflows" DROP CONSTRAINT "approval_workflows_approver_id_fkey";

-- DropTable
DROP TABLE "approval_workflows";

-- DropEnum
DROP TYPE "ApprovalStatus";

-- AlterEnum (replace InvoiceStatus values entirely — no old value maps to a new one)
ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('SUBMITTED', 'CANCELLED', 'REJECTED', 'VOID', 'REVISION');
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus" USING ('SUBMITTED'::text)::"InvoiceStatus";
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
DROP TYPE "InvoiceStatus_old";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "send_date" TIMESTAMP(3),
ADD COLUMN "delivered_date" TIMESTAMP(3),
ADD COLUMN "pic_id" TEXT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pic_id_fkey" FOREIGN KEY ("pic_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
