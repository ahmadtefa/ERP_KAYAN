-- Adapts the source branch's company logo and branch-tree changes to the schema
-- that is already in place from 20261009120000 (companies.phone, companies.email,
-- companies.addressEn/addressAr already exist and are NOT added again here).
--
-- Additive and idempotent: existing rows keep every value they already have.
-- Safe on an empty database and on one that already holds business data.

-- Company logo stored in the database (the file-based logoPath stays as it is).
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "logoData" BYTEA,
  ADD COLUMN IF NOT EXISTS "logoMime" VARCHAR(64);

-- Headquarters vs. branch, and the parent unit of a branch.
DO $$
BEGIN
  CREATE TYPE "BranchKind" AS ENUM ('HEADQUARTERS', 'BRANCH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "kind" "BranchKind" NOT NULL DEFAULT 'BRANCH',
  ADD COLUMN IF NOT EXISTS "parentBranchId" UUID;

CREATE INDEX IF NOT EXISTS "branches_parentBranchId_idx" ON "branches"("parentBranchId");

DO $$
BEGIN
  ALTER TABLE "branches"
    ADD CONSTRAINT "branches_parentBranchId_fkey"
    FOREIGN KEY ("parentBranchId") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Backfill: the lowest-code active unit of each company without a headquarters
-- becomes its headquarters. Only the "kind" column is changed; no rows are removed.
UPDATE "branches" b
SET "kind" = 'HEADQUARTERS'
WHERE b."id" = (
  SELECT b2."id" FROM "branches" b2
  WHERE b2."companyId" = b."companyId" AND b2."deletedAt" IS NULL
  ORDER BY b2."code" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "branches" h
  WHERE h."companyId" = b."companyId" AND h."kind" = 'HEADQUARTERS'
);
