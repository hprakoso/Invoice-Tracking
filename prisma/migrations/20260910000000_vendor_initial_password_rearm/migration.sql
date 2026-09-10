-- Re-arms the one forced password change for vendor accounts that never had it.
--
-- Vendor accounts now get exactly one self-service password change: the forced
-- one at first login, permitted by `must_change_password`. After that only an
-- admin can issue a new password. That rule only holds if the flag actually
-- means what it claims, and for existing rows it does not: seed.ts writes
-- `must_change_password = false` for every demo/UAT account it creates
-- (prisma/seed.ts), including both vendors, which all share one seeded
-- password. Left alone, those accounts would be frozen on a shared known
-- credential with no way to ever set a private one.
--
-- This is deliberately NOT a blanket `WHERE role = 'VENDOR'`. A vendor who
-- genuinely completed a first-login change must not be forced through another
-- one, and there is a reliable record of who did: PATCH /api/users/me/password
-- is the only route in the application that has ever written users.password_hash
-- for a signed-in user, and it has written a 'user.password_changed' audit row
-- since the commit that introduced it (a067057) — there has never been a window
-- where a self-service change left no trace. Audit rows are never pruned; the
-- only statement that deletes them is seed.ts, which drops the users table in
-- the same run, so a user can never outlive its own audit history.
--
-- Data-only: no schema change, `must_change_password` already exists
-- (migration 20260726181558_add_must_change_password).
UPDATE "users" u
SET "must_change_password" = true
WHERE u."role" = 'VENDOR'
  AND u."must_change_password" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "audit_logs" a
    WHERE a."entity_type" = 'user'
      AND a."entity_id" = u."id"
      AND a."action" = 'user.password_changed'
  );
