-- Currencies the company deals in, and the dated exchange rates a user enters by hand.
-- The company currency (companies.currency) is the base: it never has a rate. Documents
-- keep their own rate when they are saved, so changing or adding a rate later never
-- moves a figure that is already booked.
CREATE TABLE currencies (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code varchar(3) NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
  "nameAr" varchar(80) NOT NULL,
  "nameEn" varchar(80) NOT NULL,
  symbol varchar(8),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("companyId", code)
);

CREATE TABLE exchange_rates (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "currencyCode" varchar(3) NOT NULL,
  "rateDate" date NOT NULL,
  -- units of the company currency for one unit of the foreign currency
  rate numeric(19,8) NOT NULL CHECK (rate > 0),
  note varchar(200),
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("companyId", "currencyCode") REFERENCES currencies ("companyId", code) ON DELETE RESTRICT,
  UNIQUE ("companyId", "currencyCode", "rateDate")
);

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'currency.read', 'View currencies and exchange rates', 'عرض العملات وأسعار الصرف', 'cash'),
  (gen_random_uuid(), 'currency.manage', 'Add and edit currencies', 'إضافة العملات وتعديلها', 'cash'),
  (gen_random_uuid(), 'currency.rates.manage', 'Enter exchange rates', 'إدخال أسعار الصرف', 'cash')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code IN (
  CASE op.code WHEN 'cash.vouchers.read' THEN 'currency.read' ELSE NULL END,
  CASE op.code WHEN 'cash.accounts.manage' THEN 'currency.manage' ELSE NULL END,
  CASE op.code WHEN 'cash.accounts.manage' THEN 'currency.rates.manage' ELSE NULL END)
WHERE op.code IN ('cash.vouchers.read', 'cash.accounts.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
