-- Race-condition safety net for the duplicate check in
-- PATCH /api/invoices/[id]. The application-level check (findFirst, then
-- update) is not atomic: two submissions landing at the same time can both
-- see "no duplicate" and both write the same number. This index makes the
-- second write fail at the DB instead, which the route catches (P2002) and
-- handles the same way as an application-detected duplicate.
--
-- Not expressible via Prisma's @@unique: it needs both lower() and a WHERE
-- clause, so it's declared here as raw SQL and is invisible to the Prisma
-- schema (`prisma migrate diff` will not try to drop it, but `prisma db
-- push` on a fresh DB would skip it — migrations are the supported path).
--
-- Excludes REJECTED so that a rejected duplicate doesn't permanently block
-- the number, and so multiple rejected attempts can coexist.
CREATE UNIQUE INDEX "invoices_vendor_invoice_number_active_uidx"
  ON "invoices" ("vendor_id", lower("invoice_number"))
  WHERE "status" <> 'REJECTED';
