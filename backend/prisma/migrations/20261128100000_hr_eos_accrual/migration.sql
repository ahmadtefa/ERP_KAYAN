-- End-of-service provision. The company types the monthly accrual percent of basic pay (this
-- program never enters a legal figure), picks the expense and provision accounts, and accrues
-- month by month from posted payroll runs. A leaver is paid from the provision; anything above
-- the provision is expensed at once.
CREATE TABLE hr_eos_settings (
  "companyId" uuid PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  "accrualPercent" numeric(7,4) NOT NULL CHECK ("accrualPercent" > 0 AND "accrualPercent" <= 100),
  "expenseAccountId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "provisionAccountId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "updatedBy" uuid,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_eos_accruals (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  month char(7) NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "runId" uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  "accrualPercent" numeric(7,4) NOT NULL,
  total numeric(19,4) NOT NULL CHECK (total >= 0),
  status varchar(10) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  "journalEntryId" uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  "postedBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hr_eos_accruals_one_per_month ON hr_eos_accruals ("companyId", month) WHERE status = 'POSTED';

CREATE TABLE hr_eos_accrual_lines (
  "accrualId" uuid NOT NULL REFERENCES hr_eos_accruals(id) ON DELETE CASCADE,
  "employeeId" uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,
  basic numeric(19,4) NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY ("accrualId", "employeeId")
);

CREATE TABLE hr_eos_payouts (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "employeeId" uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,
  "payoutDate" date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  "fromProvision" numeric(19,4) NOT NULL CHECK ("fromProvision" >= 0),
  "extraExpense" numeric(19,4) NOT NULL CHECK ("extraExpense" >= 0),
  "fundingAccountId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status varchar(10) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  note varchar(300),
  "journalEntryId" uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  "postedBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'payroll.eos.read', 'View end-of-service provision', 'عرض مخصص نهاية الخدمة', 'payroll'),
  (gen_random_uuid(), 'payroll.eos.manage', 'Set the end-of-service accrual percent and accounts', 'ضبط نسبة وحسابات مخصص نهاية الخدمة', 'payroll'),
  (gen_random_uuid(), 'payroll.eos.post', 'Accrue, reverse and pay end-of-service', 'ترحيل وعكس وصرف مخصص نهاية الخدمة', 'payroll')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('payroll.eos.read','payroll.eos.manage','payroll.eos.post')
WHERE r.code = 'ADMIN' AND r."deletedAt" IS NULL
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('payroll.eos.read','payroll.eos.post')
WHERE r.code = 'ACCOUNTANT' AND r."deletedAt" IS NULL
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
