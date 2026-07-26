-- Force a password change on next login for newly admin-created accounts.
-- Defaults to true for both new and existing rows — on a real (non-seed)
-- database this means every existing user is prompted once after this
-- migration ships; acceptable one-time friction for a security-relevant
-- flag with no prior signal to distinguish "safe" from "needs reset".
-- Demo seed accounts explicitly set this back to false (see prisma/seed.ts)
-- so the shared demo123 login keeps working without a forced-reset loop.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true;
