-- Warehouses, orders and price lists.
--
-- Additive only, in the same spirit as the migration before it: four new
-- tables plus their children, one new enum, and columns added as nullable or
-- with a default. No column is dropped, renamed or rewritten, so this runs
-- against a database holding a company's full books without touching a row.
--
-- What "nullable" means here, precisely:
--   * stock_movements."warehouseId" NULL - the movement was recorded before
--     warehouses existed, or without naming one. The warehouse reports read it
--     as the branch's default warehouse, so old stock still appears.
--   * sales_invoices."warehouseId" / purchase_invoices."warehouseId" NULL -
--     the goods moved through the branch as a whole, which is what the old
--     behaviour meant.
--   * customers."priceListId" / suppliers."priceListId" NULL - no agreed list,
--     so the item's own price is used, exactly as before.
--
-- Applied by `prisma migrate deploy`, or - when the Prisma schema engine
-- cannot be downloaded, which is the normal case on an on-premise server - by
-- `node scripts/apply-migrations.mjs`, which applies this same file.

-- ────────────────────────────────────────────────────────── warehouses

CREATE TABLE IF NOT EXISTS "warehouses" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_companyId_code_key" ON "warehouses"("companyId", "code");
CREATE INDEX IF NOT EXISTS "warehouses_companyId_branchId_idx" ON "warehouses"("companyId", "branchId");

ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS "warehouses_companyId_fkey";
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS "warehouses_branchId_fkey";
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────── warehouses on the stock ledger

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "warehouseId" UUID;
CREATE INDEX IF NOT EXISTS "stock_movements_companyId_warehouseId_itemId_idx"
  ON "stock_movements"("companyId", "warehouseId", "itemId");
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_warehouseId_fkey";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_documents" ADD COLUMN IF NOT EXISTS "fromWarehouseId" UUID;
ALTER TABLE "stock_documents" ADD COLUMN IF NOT EXISTS "toWarehouseId" UUID;
ALTER TABLE "stock_documents" DROP CONSTRAINT IF EXISTS "stock_documents_fromWarehouseId_fkey";
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_fromWarehouseId_fkey"
  FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_documents" DROP CONSTRAINT IF EXISTS "stock_documents_toWarehouseId_fkey";
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_toWarehouseId_fkey"
  FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "warehouseId" UUID;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "warehouseId" UUID;
ALTER TABLE "sales_invoices" DROP CONSTRAINT IF EXISTS "sales_invoices_warehouseId_fkey";
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" DROP CONSTRAINT IF EXISTS "purchase_invoices_warehouseId_fkey";
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────── orders
-- An order is a promise, not an accounting event: nothing here touches the
-- ledger, so the enum and the two pairs of tables can arrive without any
-- effect on a single existing figure.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "subTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_companyId_orderNumber_key"
  ON "purchase_orders"("companyId", "orderNumber");
CREATE INDEX IF NOT EXISTS "purchase_orders_companyId_orderDate_idx" ON "purchase_orders"("companyId", "orderDate");
CREATE INDEX IF NOT EXISTS "purchase_orders_companyId_status_idx" ON "purchase_orders"("companyId", "status");
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_companyId_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_branchId_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_supplierId_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "invoicedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_orderId_lineNumber_key"
  ON "purchase_order_lines"("orderId", "lineNumber");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_orderId_idx" ON "purchase_order_lines"("orderId");
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT IF EXISTS "purchase_order_lines_orderId_fkey";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT IF EXISTS "purchase_order_lines_itemId_fkey";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sales_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "subTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_companyId_orderNumber_key"
  ON "sales_orders"("companyId", "orderNumber");
CREATE INDEX IF NOT EXISTS "sales_orders_companyId_orderDate_idx" ON "sales_orders"("companyId", "orderDate");
CREATE INDEX IF NOT EXISTS "sales_orders_companyId_status_idx" ON "sales_orders"("companyId", "status");
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_companyId_fkey";
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_branchId_fkey";
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_customerId_fkey";
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sales_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "invoicedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sales_order_lines_orderId_lineNumber_key"
  ON "sales_order_lines"("orderId", "lineNumber");
CREATE INDEX IF NOT EXISTS "sales_order_lines_orderId_idx" ON "sales_order_lines"("orderId");
ALTER TABLE "sales_order_lines" DROP CONSTRAINT IF EXISTS "sales_order_lines_orderId_fkey";
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_order_lines" DROP CONSTRAINT IF EXISTS "sales_order_lines_itemId_fkey";
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The invoice keeps a link back to the order it fulfilled, so the order's
-- progress can be read without matching totals by hand.
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "salesOrderId" UUID;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "purchaseOrderId" UUID;
ALTER TABLE "sales_invoices" DROP CONSTRAINT IF EXISTS "sales_invoices_salesOrderId_fkey";
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" DROP CONSTRAINT IF EXISTS "purchase_invoices_purchaseOrderId_fkey";
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────── price lists

CREATE TABLE IF NOT EXISTS "price_lists" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "validFrom" DATE,
    "validTo" DATE,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "price_lists_companyId_code_key" ON "price_lists"("companyId", "code");
CREATE INDEX IF NOT EXISTS "price_lists_companyId_idx" ON "price_lists"("companyId");
ALTER TABLE "price_lists" DROP CONSTRAINT IF EXISTS "price_lists_companyId_fkey";
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "price_list_items" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "unit" VARCHAR(32) NOT NULL DEFAULT '',
    "minQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(19,4) NOT NULL,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "price_list_items_priceListId_itemId_unit_minQuantity_key"
  ON "price_list_items"("priceListId", "itemId", "unit", "minQuantity");
CREATE INDEX IF NOT EXISTS "price_list_items_priceListId_idx" ON "price_list_items"("priceListId");
ALTER TABLE "price_list_items" DROP CONSTRAINT IF EXISTS "price_list_items_priceListId_fkey";
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_items" DROP CONSTRAINT IF EXISTS "price_list_items_itemId_fkey";
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "priceListId" UUID;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "priceListId" UUID;
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_priceListId_fkey";
ALTER TABLE "customers" ADD CONSTRAINT "customers_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_priceListId_fkey";
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────── the permissions the new screens
-- need. Written the way the migration before this one wrote its grants: it
-- never removes a grant, and it gives each new permission only to roles that
-- already hold the permission meaning the same thing in the same module.

INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), v.code, v."nameEn", v."nameAr", v.module
  FROM (VALUES
    ('inventory.warehouses.read', 'View warehouses', 'عرض المخازن', 'inventory'),
    ('inventory.warehouses.manage', 'Manage warehouses', 'إدارة المخازن', 'inventory'),
    ('purchases.orders.read', 'View purchase orders', 'عرض أوامر الشراء', 'purchases'),
    ('purchases.orders.create', 'Create purchase orders', 'إنشاء أوامر الشراء', 'purchases'),
    ('purchases.orders.approve', 'Approve purchase orders', 'اعتماد أوامر الشراء', 'purchases'),
    ('sales.orders.read', 'View sales orders', 'عرض أوامر البيع', 'sales'),
    ('sales.orders.create', 'Create sales orders', 'إنشاء أوامر البيع', 'sales'),
    ('sales.orders.approve', 'Approve sales orders', 'اعتماد أوامر البيع', 'sales'),
    ('sales.pricelists.manage', 'Manage price lists', 'إدارة قوائم الأسعار', 'sales')
  ) AS v(code, "nameEn", "nameAr", module)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = v.code);

-- Whoever may edit items may name the places they are kept.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'inventory.items.read'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'inventory.warehouses.read'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'inventory.items.update'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'inventory.warehouses.manage'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

-- Someone who could raise an invoice could already buy and sell; an order is
-- the same intention written down earlier, so it is granted alongside.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'purchases.invoices.create'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('purchases.orders.read', 'purchases.orders.create')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'purchases.invoices.post'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'purchases.orders.approve'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'sales.invoices.create'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('sales.orders.read', 'sales.orders.create')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'sales.invoices.post'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('sales.orders.approve', 'sales.pricelists.manage')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

-- ──────────────────────────────────────── the warehouse every branch needs
-- A branch that has never had a warehouse gets one, named after the branch,
-- and it becomes the default. This is what makes a document that names no
-- warehouse, and every movement recorded before today, land somewhere real
-- instead of nowhere.

INSERT INTO "warehouses" ("id", "companyId", "branchId", "code", "nameEn", "nameAr", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), b."companyId", b.id, b.code || '-MAIN', b."nameEn" || ' main store', b."nameAr" || ' - المخزن الرئيسي', true, true, now(), now()
  FROM "branches" b
 WHERE b."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "warehouses" w
      WHERE w."branchId" = b.id AND w."deletedAt" IS NULL
   );

-- Movements recorded before this migration are attributed to their branch's
-- default warehouse. This is a one-time backfill of a nullable column; the
-- quantities, costs and dates of the rows are not touched.
UPDATE "stock_movements" m
   SET "warehouseId" = w.id
  FROM "warehouses" w
 WHERE m."warehouseId" IS NULL
   AND w."branchId" = m."branchId"
   AND w."isDefault" = true
   AND w."deletedAt" IS NULL;
