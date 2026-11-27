-- Sales-rep commissions: reps, one commission entry per sales document, and payouts.
CREATE TABLE sales_reps (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "nameEn" varchar(120) NOT NULL,
  "nameAr" varchar(120) NOT NULL,
  "ratePercent" numeric(7,4) NOT NULL CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100),
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sales_reps_name ON sales_reps ("companyId", lower("nameEn"));

CREATE TABLE commission_payouts (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "repId" uuid NOT NULL REFERENCES sales_reps(id) ON DELETE RESTRICT,
  "fromDate" date NOT NULL,
  "toDate" date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  "entryCount" integer NOT NULL,
  note varchar(240),
  "paidBy" uuid,
  "paidAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commission_entries (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "repId" uuid NOT NULL REFERENCES sales_reps(id) ON DELETE RESTRICT,
  "salesInvoiceId" uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  kind varchar(8) NOT NULL CHECK (kind IN ('SALE','RETURN')),
  "documentDate" date NOT NULL,
  basis numeric(19,4) NOT NULL,
  "ratePercent" numeric(7,4) NOT NULL,
  amount numeric(19,4) NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'ACCRUED' CHECK (status IN ('ACCRUED','PAID')),
  "payoutId" uuid REFERENCES commission_payouts(id) ON DELETE RESTRICT,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_paid_has_payout CHECK (status <> 'PAID' OR "payoutId" IS NOT NULL)
);
CREATE UNIQUE INDEX commission_entries_doc ON commission_entries ("salesInvoiceId");
CREATE INDEX commission_entries_rep ON commission_entries ("companyId", "repId", status, "documentDate");

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'commissions.read', 'View sales reps and commissions', 'عرض مندوبي المبيعات والعمولات', 'sales'),
  (gen_random_uuid(), 'commissions.manage', 'Manage sales reps, assign commissions and pay them out', 'إدارة المندوبين وتسجيل العمولات وصرفها', 'sales')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code = CASE op.code
  WHEN 'sales.invoices.read' THEN 'commissions.read'
  WHEN 'sales.invoices.post' THEN 'commissions.manage' END
WHERE op.code IN ('sales.invoices.read', 'sales.invoices.post')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
