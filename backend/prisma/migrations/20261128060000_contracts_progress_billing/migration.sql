-- Contracting: contracts with a customer, progress claims (المستخلصات) that become ordinary sales
-- invoices, variations, and the retention the customer holds back. Advance recovery works through
-- the customer's advance receipt, which is allocated to the claim's invoice in the cash screen.
CREATE TABLE contracts (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  "titleAr" varchar(200) NOT NULL,
  "customerId" uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  "serviceItemId" uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  "costCenterId" uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
  "contractValue" numeric(19,4) NOT NULL CHECK ("contractValue" > 0),
  "advanceAmount" numeric(19,4) NOT NULL DEFAULT 0 CHECK ("advanceAmount" >= 0),
  "retentionPercent" numeric(7,4) NOT NULL DEFAULT 0 CHECK ("retentionPercent" >= 0 AND "retentionPercent" <= 100),
  "taxRatePercent" numeric(9,4) CHECK ("taxRatePercent" IS NULL OR ("taxRatePercent" >= 0 AND "taxRatePercent" <= 100)),
  "startDate" date,
  status varchar(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("advanceAmount" <= "contractValue")
);
CREATE UNIQUE INDEX contracts_code ON contracts ("companyId", lower(code));

CREATE TABLE contract_variations (
  id uuid PRIMARY KEY,
  "contractId" uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  "variationDate" date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount <> 0),
  note varchar(200) NOT NULL,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_claims (
  id uuid PRIMARY KEY,
  "contractId" uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  "claimNo" integer NOT NULL,
  "claimDate" date NOT NULL,
  "cumulativeWork" numeric(19,4) NOT NULL,
  "previousWork" numeric(19,4) NOT NULL,
  "periodWork" numeric(19,4) NOT NULL CHECK ("periodWork" > 0),
  "advanceRecovery" numeric(19,4) NOT NULL CHECK ("advanceRecovery" >= 0),
  retention numeric(19,4) NOT NULL CHECK (retention >= 0),
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','INVOICED','CANCELLED')),
  note varchar(200),
  "salesInvoiceId" uuid REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  "preparedBy" uuid,
  "approvedBy" uuid,
  "approvedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("contractId", "claimNo")
);

CREATE TABLE contract_retention_releases (
  id uuid PRIMARY KEY,
  "contractId" uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  "releaseDate" date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  note varchar(200),
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'contracts.read', 'View contracts and progress claims', 'عرض العقود والمستخلصات', 'sales'),
  (gen_random_uuid(), 'contracts.manage', 'Create contracts, variations and retention releases', 'إنشاء العقود وأوامر التغيير وصرف المحتجز', 'sales'),
  (gen_random_uuid(), 'contracts.claim.create', 'Prepare and cancel progress claims', 'إعداد المستخلصات وإلغاؤها', 'sales'),
  (gen_random_uuid(), 'contracts.claim.approve', 'Approve progress claims and issue their invoices', 'اعتماد المستخلصات وإصدار فواتيرها', 'sales')
ON CONFLICT (code) DO NOTHING;

-- Existing roles: whoever may read invoices may read contracts; whoever may post invoices may do the rest.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code IN (
  CASE op.code WHEN 'sales.invoices.read' THEN 'contracts.read' END,
  CASE op.code WHEN 'sales.invoices.post' THEN 'contracts.manage' END,
  CASE op.code WHEN 'sales.invoices.post' THEN 'contracts.claim.create' END,
  CASE op.code WHEN 'sales.invoices.post' THEN 'contracts.claim.approve' END)
WHERE op.code IN ('sales.invoices.read', 'sales.invoices.post')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
