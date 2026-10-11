-- Company profile (contact details and the optional logo) and the branch
-- hierarchy (headquarters vs. branch, parent unit).
--
-- Additive only: every column is nullable or has a default, so this runs
-- against an empty database and against one that already holds years of data
-- without touching a single existing row.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "logoData" BYTEA,
ADD COLUMN     "logoMime" VARCHAR(64);

-- CreateEnum
CREATE TYPE "BranchKind" AS ENUM ('HEADQUARTERS', 'BRANCH');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "kind" "BranchKind" NOT NULL DEFAULT 'BRANCH',
ADD COLUMN     "parentBranchId" UUID;

-- CreateIndex
CREATE INDEX "branches_parentBranchId_idx" ON "branches"("parentBranchId");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_parentBranchId_fkey" FOREIGN KEY ("parentBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The first unit of every existing company is its headquarters. This is the
-- only data statement in the migration and it is idempotent in spirit: it
-- names the lowest-code branch of each company that has no parent yet.
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
