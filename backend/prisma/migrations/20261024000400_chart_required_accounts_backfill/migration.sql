-- Backfill the two accounts the account map resolves by code but the
-- original setup chart never created: 3103 (opening-balance equity)
-- and 5107 (inventory differences). Without them, opening balances
-- and stock adjustments fail on every company that was created
-- through setup — the seed chart had them, the template did not.
--
-- Rules this migration keeps:
--   * insert only when the company has no account with that code at
--     all (the (companyId, code) unique index also covers soft-deleted
--     rows; a company that deliberately deleted the account keeps its
--     decision and can re-add it from the chart screen);
--   * an account that already exists is never touched, so re-running
--     this file changes nothing the second time;
--   * accounts are chart structure, not money: no journal entry or
--     balance is created here;
--   * the parent is the company's own '3'/'5' heading when it exists;
--     a renumbered chart without one gets a top-level account instead
--     of a broken reference.

INSERT INTO "accounts" (
  "id", "companyId", "code", "nameEn", "nameAr", "type",
  "parentId", "isPostable", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '3103', 'Opening balance equity', 'أرصدة افتتاحية', 'EQUITY',
  (SELECT p."id" FROM "accounts" p
    WHERE p."companyId" = c."id" AND p."code" = '3' AND p."deletedAt" IS NULL
    LIMIT 1),
  true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a
  WHERE a."companyId" = c."id" AND a."code" = '3103'
);

INSERT INTO "accounts" (
  "id", "companyId", "code", "nameEn", "nameAr", "type",
  "parentId", "isPostable", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5107', 'Inventory differences', 'فروق المخزون', 'EXPENSE',
  (SELECT p."id" FROM "accounts" p
    WHERE p."companyId" = c."id" AND p."code" = '5' AND p."deletedAt" IS NULL
    LIMIT 1),
  true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a
  WHERE a."companyId" = c."id" AND a."code" = '5107'
);
