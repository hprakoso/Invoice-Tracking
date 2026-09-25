-- Transition marker for the GA_STAFF company-scoping rollout.
--
-- Additive only: one new column on "users" with a default. No existing column
-- is altered, no row is deleted, and nothing touches password_hash,
-- must_change_password, vendor_id, invoices, audit_logs or notifications.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "company_scope_exempt" BOOLEAN NOT NULL DEFAULT false;

-- Mark the GA_STAFF accounts that already existed when scoping shipped, so they
-- keep the access they have today instead of being locked out the moment the
-- feature lands. This grants nothing new — an exempt account sees exactly what
-- it saw before — and it deliberately does NOT create any company assignment.
--
-- Scoped to role = 'GA_STAFF' because no other role reads this flag. Accounts
-- created after this migration default to false, so a newly created GA_STAFF
-- can never inherit the exemption: the legacy fallback cannot become a loophole.
UPDATE "users" SET "company_scope_exempt" = true WHERE "role" = 'GA_STAFF';
