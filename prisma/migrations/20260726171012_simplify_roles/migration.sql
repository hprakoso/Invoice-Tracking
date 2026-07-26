-- Reduce Role enum from 7 values to the 4 actually in use: ADMIN, GA_STAFF,
-- GA_MANAGER, VENDOR. MANAGER and VIEWER were already deprecated read-only
-- roles; FINANCE's responsibilities are redistributed to GA_STAFF/GA_MANAGER
-- in application code (see docs/PRODUCTION_PLAN.md §4.9).

-- Safety net: remap any existing rows off the roles being removed before the
-- enum swap. No-op on a freshly seeded database.
UPDATE "users" SET "role" = 'GA_STAFF' WHERE "role" IN ('MANAGER', 'FINANCE', 'VIEWER');

-- Postgres has no direct "remove enum value" — swap the type.
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
