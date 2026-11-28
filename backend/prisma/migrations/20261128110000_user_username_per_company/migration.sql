-- A username only has to be unique inside its company. Sign-in names the
-- company with its code. Relaxing the rule cannot break an existing row.
DROP INDEX IF EXISTS "users_username_key";
CREATE UNIQUE INDEX "users_companyId_username_key" ON "users"("companyId", "username");
