-- Withholding tax: rates the company sets up, and the amount held back on a cash voucher.
-- Each rate names the ledger account that holds the tax (a liability for tax we
-- withhold from suppliers, an asset for tax customers withhold from us), so no
-- fixed account has to exist in the chart.
CREATE TABLE withholding_rates (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  "nameAr" varchar(160) NOT NULL,
  "nameEn" varchar(160) NOT NULL,
  direction varchar(16) NOT NULL CHECK (direction IN ('PAYABLE','RECEIVABLE')),
  "ratePercent" numeric(7,4) NOT NULL CHECK ("ratePercent" > 0 AND "ratePercent" <= 100),
  "accountId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX withholding_rates_code ON withholding_rates ("companyId", lower(code));

CREATE TABLE voucher_withholdings (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "voucherId" uuid NOT NULL UNIQUE REFERENCES cash_vouchers(id) ON DELETE RESTRICT,
  "rateId" uuid NOT NULL REFERENCES withholding_rates(id) ON DELETE RESTRICT,
  direction varchar(16) NOT NULL CHECK (direction IN ('PAYABLE','RECEIVABLE')),
  "ratePercent" numeric(7,4) NOT NULL,
  base numeric(19,4) NOT NULL CHECK (base > 0),
  amount numeric(19,4) NOT NULL CHECK (amount > 0 AND amount < base),
  "accountId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voucher_withholdings_company ON voucher_withholdings ("companyId", "rateId");

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'withholding.read', 'View withholding tax and its report', 'عرض ضريبة الخصم والإضافة وتقريرها', 'cash'),
  (gen_random_uuid(), 'withholding.manage', 'Set up withholding tax rates', 'إعداد نسب ضريبة الخصم والإضافة', 'cash')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code = CASE op.code
  WHEN 'cash.vouchers.read' THEN 'withholding.read'
  WHEN 'cash.accounts.manage' THEN 'withholding.manage' END
WHERE op.code IN ('cash.vouchers.read', 'cash.accounts.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
