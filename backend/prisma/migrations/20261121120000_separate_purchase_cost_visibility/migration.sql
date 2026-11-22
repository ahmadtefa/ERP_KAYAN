-- Purchase price access is independent of both inventory valuation and the
-- ability to process purchase documents. Writes to sale prices, purchase
-- prices and valuation costs are also separate from read access.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
VALUES
  (gen_random_uuid(), 'inventory.items.saleprice.manage', 'Set item sale prices', 'إدخال وتعديل أسعار بيع الأصناف', 'inventory'),
  (gen_random_uuid(), 'inventory.items.purchaseprice.manage', 'Set item purchase prices', 'إدخال وتعديل أسعار شراء الأصناف', 'inventory'),
  (gen_random_uuid(), 'inventory.cost.manage', 'Enter inventory valuation costs', 'إدخال تكاليف التقييم المخزني', 'inventory')
ON CONFLICT ("code") DO NOTHING;

-- Blank catalogue purchase prices must stay unknown (NULL), not become a
-- fabricated zero-price/cost. Existing stored numbers are left untouched.
ALTER TABLE "items" ALTER COLUMN "purchasePrice" DROP DEFAULT;
ALTER TABLE "items" ALTER COLUMN "purchasePrice" DROP NOT NULL;

-- The previous migration copied the new purchase-price permission from older,
-- broader purchase/cost grants. Remove inferred grants from built-in roles
-- (ADMIN keeps its wildcard). Custom roles retain administrator-configured grants.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" purchase
WHERE rp."roleId" = r.id
  AND rp."permissionId" = purchase.id
  AND purchase.code = 'purchases.price.read'
  AND r.code IN (
    'GENERAL_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER',
    'SALES_CLERK', 'PURCHASING_MANAGER', 'PURCHASING_CLERK',
    'WAREHOUSE_MANAGER', 'STOREKEEPER', 'STOCK_AUDITOR', 'TREASURER',
    'BANK_OFFICER', 'COLLECTION_OFFICER', 'INTERNAL_AUDITOR', 'REPORT_USER',
    'READ_ONLY'
  );

-- The earlier compatibility backfill copied the source assignment timestamp
-- and deny flag verbatim. Remove only those inferred user grants. A direct
-- purchase-price grant edited after that backfill has its own updatedAt and
-- remains intact.
DELETE FROM "user_permissions" inferred
USING "permissions" purchase, "permissions" old_permission
WHERE inferred."permissionId" = purchase.id
  AND purchase.code = 'purchases.price.read'
  AND old_permission.code IN (
    'inventory.cost.read', 'purchases.invoices.read', 'purchases.orders.read'
  )
  AND EXISTS (
    SELECT 1
    FROM "user_permissions" source
    WHERE source."userId" = inferred."userId"
      AND source."permissionId" = old_permission.id
      AND source."updatedAt" = inferred."updatedAt"
      AND source."isDenied" = inferred."isDenied"
  );

-- Preserve the existing print choice while adding an independent switch.
ALTER TABLE "print_price_settings"
  ADD COLUMN "showPurchasePrice" BOOLEAN NOT NULL DEFAULT TRUE;
