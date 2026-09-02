-- Multi-file attachments per invoice. A real submission carries more than the
-- invoice itself (tax invoice / faktur pajak, BAST, supporting docs), which
-- the single invoices.file_path/file_type pair could not represent — the
-- storage key was literally "{invoiceId}.{ext}", one slot, overwritten on
-- re-upload.
--
-- Expand/contract: invoices.file_path/file_type are deliberately LEFT IN
-- PLACE here and backfilled into the new table, so nothing already uploaded
-- becomes unreachable. Dropping them is a separate later migration, once
-- every read path has moved over.

CREATE TYPE "InvoiceDocumentType" AS ENUM ('INVOICE', 'TAX_INVOICE', 'BAST', 'OTHER');

CREATE TABLE "invoice_documents" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "type" "InvoiceDocumentType" NOT NULL DEFAULT 'OTHER',
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "classification_confidence" DOUBLE PRECISION,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_documents_invoice_id_idx" ON "invoice_documents" ("invoice_id");

ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one INVOICE-typed row per invoice that already has a file.
-- classification_confidence stays NULL — these were never AI-classified, the
-- type is an assumption based on the old single-file-is-the-invoice model.
-- file_path keeps the OLD "{invoiceId}.{ext}" key (not the new
-- "{invoiceId}/{documentId}.{ext}" layout) because that's where the bytes
-- actually are; getFileBuffer() reads the stored path verbatim, so both
-- layouts coexist without a storage migration.
INSERT INTO "invoice_documents" ("id", "invoice_id", "type", "file_path", "file_type", "original_name", "uploaded_by", "created_at")
SELECT gen_random_uuid()::text, "id", 'INVOICE', "file_path", "file_type", "file_path", "created_by", "created_at"
FROM "invoices"
WHERE "file_path" IS NOT NULL AND "file_type" IS NOT NULL;
