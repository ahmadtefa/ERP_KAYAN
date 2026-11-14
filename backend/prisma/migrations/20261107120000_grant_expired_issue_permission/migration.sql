-- Make "sell an expired lot, with an approval" a permission that exists.
--
-- Issue input already carried `allowExpired`, and nothing checked who sent it:
-- any caller holding `inventory.batches.issue` could put goods that have gone
-- off into a customer's hands by typing one boolean. The item policy also had
-- `expiredIssueNeedsApproval`, but item policy is not editable through the API,
-- so in practice the flag was never set and the exception was always open.
--
-- The permission below is what turns that boolean into a decision:
--
--   * a sale may only name an expired lot when the caller holds it;
--   * the approver, the reason, the time and every lot and quantity issued go
--     into the audit log as `EXPIRED_ISSUE_APPROVED`;
--   * everybody else is refused, with the expired lots named in the message.
--
-- Purely additive and idempotent, following 20261101200000:
--
--   * the catalogue row is inserted only when the code is missing;
--   * the role link is granted only to roles that already keep the books
--     (accounting.journal.create) - the same "the money side signs the loss"
--     policy the write-off approval uses - and never when it already exists;
--   * nothing is deleted, renamed or replaced.
--
-- On a fresh database this runs before the seed creates any role, so it links
-- nothing and the seed grants everything to the administrator as before.

INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES
  (gen_random_uuid(), 'inventory.batches.expired.issue', 'Sell expired lots with a recorded approval', 'صرف دفعات منتهية الصلاحية باعتماد مسجّل', 'inventory')
ON CONFLICT (code) DO NOTHING;

-- Approving a sale of expired goods follows keeping the books.
WITH money AS (
  SELECT DISTINCT rp."roleId" AS "roleId"
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp."permissionId"
  WHERE p.code = 'accounting.journal.create'
)
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT m."roleId", p.id
FROM money m
JOIN roles r ON r.id = m."roleId" AND r."deletedAt" IS NULL
JOIN permissions p ON p.code = 'inventory.batches.expired.issue'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
