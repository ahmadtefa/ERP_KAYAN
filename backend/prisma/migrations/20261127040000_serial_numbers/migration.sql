-- Serial numbers and warranty: a register of individual units, kept beside stock quantities.
CREATE TABLE serial_units (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "itemId" uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  "serialNumber" varchar(64) NOT NULL,
  "warehouseId" uuid REFERENCES warehouses(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','SOLD','RETURNED','SCRAPPED')),
  "warrantyMonths" integer NOT NULL DEFAULT 0 CHECK ("warrantyMonths" BETWEEN 0 AND 240),
  "salesInvoiceId" uuid REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  "customerId" uuid REFERENCES customers(id) ON DELETE RESTRICT,
  "soldOn" date,
  "warrantyEndsOn" date,
  reference varchar(120),
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serial_units_sold_has_invoice CHECK (status <> 'SOLD' OR ("salesInvoiceId" IS NOT NULL AND "soldOn" IS NOT NULL))
);
CREATE UNIQUE INDEX serial_units_unique ON serial_units ("companyId", "itemId", lower("serialNumber"));
CREATE INDEX serial_units_lookup ON serial_units ("companyId", lower("serialNumber"));
CREATE INDEX serial_units_invoice ON serial_units ("salesInvoiceId") WHERE "salesInvoiceId" IS NOT NULL;

CREATE TABLE serial_events (
  id uuid PRIMARY KEY,
  "serialId" uuid NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  action varchar(16) NOT NULL,
  "fromStatus" varchar(16),
  "toStatus" varchar(16) NOT NULL,
  "salesInvoiceId" uuid,
  note text,
  "userId" uuid,
  "at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX serial_events_serial ON serial_events ("serialId", "at");

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'serials.read', 'View serial numbers and warranty', 'عرض الأرقام التسلسلية والضمان', 'inventory'),
  (gen_random_uuid(), 'serials.manage', 'Register, sell, return and scrap serial numbers', 'تسجيل وبيع وإرجاع وإعدام الأرقام التسلسلية', 'inventory')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code = CASE op.code
  WHEN 'inventory.stock.read' THEN 'serials.read'
  WHEN 'inventory.items.update' THEN 'serials.manage' END
WHERE op.code IN ('inventory.stock.read', 'inventory.items.update')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
