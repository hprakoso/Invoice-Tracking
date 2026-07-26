-- DRAFT: an invoice being assembled by the upload wizard (company/vendor
-- picked, file uploaded, OCR run) that hasn't been explicitly submitted yet.
-- Excluded from invoice lists, dashboard stats, and reminder notifications
-- until it transitions to SUBMITTED. See docs/PRODUCTION_PLAN.md follow-up notes.

ALTER TYPE "InvoiceStatus" ADD VALUE 'DRAFT';
