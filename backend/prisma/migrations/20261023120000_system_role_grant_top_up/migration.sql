-- Heal system-role grants that fell behind the permission catalogue.
--
-- Why this exists: role grants are data, and two events leave them stale
-- while the program moves on —
--   * restoring a company JSON backup written by an older version replaces
--     "role_permissions" with that version's snapshot (the bundled demo
--     backup, for instance, predates the opening-balances, cash and
--     quotation permissions entirely);
--   * a grant migration that ran before any role existed had nothing to
--     grant to.
-- The visible symptom was an authorized accountant refused the
-- opening-balances import template with "Missing permission:
-- accounting.openingbalances.manage".
--
-- The repair mirrors what prisma/seed.ts and the first-run setup install on
-- a fresh company, and it is additive only:
--   * the ADMIN system role holds the whole catalogue (that is its
--     documented meaning in the seed);
--   * the ACCOUNTANT system role holds the accounting/parties/inventory/
--     cash/reports modules plus read-only sales and purchase invoices;
--   * any role that can post journal entries can open the books
--     (accounting.openingbalances.manage) — the same rule as
--     20261012234500_grant_cash_reports_permissions, re-applied because a
--     later restore may have overwritten its result.
-- Custom (non-system) roles other than the journal-post rule are untouched,
-- and no grant is ever removed here. Idempotent: running it twice changes
-- nothing. Restores performed after this migration are reconciled by the
-- restore itself (BackupService.reconcileRestoredAccess).

-- The opening-balances catalogue row itself, in case a database restored
-- from a full dump predates it.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'accounting.openingbalances.manage',
       'Open the books: opening balances', 'إدخال الأرصدة الافتتاحية', 'accounting'
 WHERE NOT EXISTS (
   SELECT 1 FROM "permissions" p WHERE p.code = 'accounting.openingbalances.manage'
 );

-- ADMIN (system): the whole catalogue.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r.code = 'ADMIN'
   AND r."isSystem" = true
   AND r."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "role_permissions" x
      WHERE x."roleId" = r.id AND x."permissionId" = p.id
   );

-- ACCOUNTANT (system): the bookkeeping modules + read-only invoices.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" p
    ON p.module IN ('accounting', 'parties', 'inventory', 'cash', 'reports')
    OR p.code IN ('sales.invoices.read', 'purchases.invoices.read')
 WHERE r.code = 'ACCOUNTANT'
   AND r."isSystem" = true
   AND r."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "role_permissions" x
      WHERE x."roleId" = r.id AND x."permissionId" = p.id
   );

-- Whoever may post journal entries may open the books.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'accounting.journal.post'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'accounting.openingbalances.manage'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x
    WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );
