-- GA_STAFF "All companies" flag, replacing the transitional company_scope_exempt.
--
-- Existing GA_STAFF with no company assignment get handles_all_companies = true,
-- so they keep today's organisation-wide access after deploy; an ADMIN narrows
-- them later from User Management. Staff that already have assignments keep them.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "handles_all_companies" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "handles_all_companies" = true
WHERE "role" = 'GA_STAFF'
  AND NOT EXISTS (SELECT 1 FROM "_GaStaffCompanies" gc WHERE gc."B" = "users"."id");

-- Superseded by handles_all_companies above.
ALTER TABLE "users" DROP COLUMN "company_scope_exempt";
