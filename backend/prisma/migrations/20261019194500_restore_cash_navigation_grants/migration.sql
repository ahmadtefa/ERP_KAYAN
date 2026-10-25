-- Keep the cash/banks navigation consistent for existing installations.
-- Older databases do not rerun prisma/seed.ts, and the previous permission
-- migration only copied cash read access from sales-invoice readers. Accounting
-- users who can read the ledger also need read-only visibility of cash accounts.
-- This does not grant cash-account management, voucher creation, or posting.

INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
VALUES (
  gen_random_uuid(),
  'cash.accounts.read',
  'View cash boxes and banks',
  'عرض الخزائن والبنوك',
  'cash'
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r.id, cash_read.id
  FROM "roles" r
  JOIN "role_permissions" ledger_grant
    ON ledger_grant."roleId" = r.id
  JOIN "permissions" ledger_read
    ON ledger_read.id = ledger_grant."permissionId"
   AND ledger_read.code = 'accounting.journal.read'
  CROSS JOIN "permissions" cash_read
 WHERE cash_read.code = 'cash.accounts.read'
   AND r."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM "role_permissions" existing
      WHERE existing."roleId" = r.id
        AND existing."permissionId" = cash_read.id
   );
