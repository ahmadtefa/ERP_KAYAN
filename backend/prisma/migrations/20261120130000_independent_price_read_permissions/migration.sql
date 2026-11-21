-- Split the former implicit selling-price visibility from purchase-cost access.
-- Additive only: users, roles, documents and existing grants are preserved.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
VALUES
  (gen_random_uuid(), 'purchases.price.read', 'View purchase prices', 'عرض أسعار الشراء', 'purchases'),
  (gen_random_uuid(), 'sales.price.read', 'View selling prices', 'عرض أسعار البيع', 'sales')
ON CONFLICT ("code") DO NOTHING;

-- Existing roles that could read sales documents were already receiving
-- selling prices from their APIs. Preserve that access explicitly. Item-only
-- and warehouse roles are intentionally not included: price visibility is now
-- independently configurable instead of being implied by reading stock.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT source."roleId", sale.id
FROM "role_permissions" source
JOIN "permissions" items ON items.id = source."permissionId"
  AND items.code IN ('sales.invoices.read', 'sales.orders.read')
JOIN "permissions" sale ON sale.code = 'sales.price.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- The old cost permission remains a supported compatibility grant in the API.
-- Copy existing assignments to the new named permission so role screens can
-- manage the split directly after upgrade, without changing current access.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT source."roleId", purchase.id
FROM "role_permissions" source
JOIN "permissions" legacy ON legacy.id = source."permissionId"
  AND legacy.code IN ('inventory.cost.read', 'purchases.invoices.read', 'purchases.orders.read')
JOIN "permissions" purchase ON purchase.code = 'purchases.price.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "user_permissions" ("userId", "permissionId", "isDenied", "updatedAt")
SELECT source."userId", purchase.id, source."isDenied", source."updatedAt"
FROM "user_permissions" source
JOIN "permissions" legacy ON legacy.id = source."permissionId"
  AND legacy.code IN ('inventory.cost.read', 'purchases.invoices.read', 'purchases.orders.read')
JOIN "permissions" purchase ON purchase.code = 'purchases.price.read'
ON CONFLICT ("userId", "permissionId") DO NOTHING;

INSERT INTO "user_permissions" ("userId", "permissionId", "isDenied", "updatedAt")
SELECT source."userId", sale.id, source."isDenied", source."updatedAt"
FROM "user_permissions" source
JOIN "permissions" readPermission ON readPermission.id = source."permissionId"
  AND readPermission.code IN ('sales.invoices.read', 'sales.orders.read')
JOIN "permissions" sale ON sale.code = 'sales.price.read'
ON CONFLICT ("userId", "permissionId") DO NOTHING;
