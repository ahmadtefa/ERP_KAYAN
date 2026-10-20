-- An account reset must invalidate existing access JWTs, not only refresh
-- tokens. Older JWTs omit the claim and are treated as version zero.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
