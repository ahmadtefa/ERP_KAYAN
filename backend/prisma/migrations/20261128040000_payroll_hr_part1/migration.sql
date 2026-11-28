-- Payroll and HR, part 1: employee file, salary structures, monthly attendance and the
-- insurance/tax parameter sets. Every figure in payroll_settings is typed in by the
-- company and confirmed before a run may use it; nothing ships pre-filled.
CREATE TABLE hr_employees (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  "nameAr" varchar(160) NOT NULL,
  "nameEn" varchar(160),
  "nationalId" varchar(14),
  "siNumber" varchar(32),
  "hireDate" date NOT NULL,
  "leaveDate" date,
  status varchar(8) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT')),
  "branchId" uuid REFERENCES branches(id) ON DELETE RESTRICT,
  "costCenterId" uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
  "jobTitle" varchar(120),
  "bankAccount" varchar(64),
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("leaveDate" IS NULL OR "leaveDate" >= "hireDate"),
  CHECK (status = 'ACTIVE' OR "leaveDate" IS NOT NULL)
);
CREATE UNIQUE INDEX hr_employees_code ON hr_employees ("companyId", lower(code));
CREATE INDEX hr_employees_status ON hr_employees ("companyId", status);

CREATE TABLE hr_salary_structures (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "employeeId" uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,
  "effectiveFrom" date NOT NULL,
  basic numeric(19,4) NOT NULL CHECK (basic >= 0),
  "coveredBySI" boolean NOT NULL DEFAULT true,
  "coveredByTax" boolean NOT NULL DEFAULT true,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("employeeId", "effectiveFrom")
);

CREATE TABLE hr_salary_structure_items (
  id uuid PRIMARY KEY,
  "structureId" uuid NOT NULL REFERENCES hr_salary_structures(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind IN ('ALLOWANCE','DEDUCTION')),
  "nameAr" varchar(120) NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  "subjectToSI" boolean NOT NULL DEFAULT true,
  "subjectToTax" boolean NOT NULL DEFAULT true
);
CREATE INDEX hr_salary_items_structure ON hr_salary_structure_items ("structureId");

CREATE TABLE hr_attendance_summaries (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "employeeId" uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,
  month char(7) NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "workingDays" numeric(5,2) NOT NULL CHECK ("workingDays" >= 0),
  "absenceDays" numeric(5,2) NOT NULL DEFAULT 0 CHECK ("absenceDays" >= 0),
  "overtimeHours" numeric(7,2) NOT NULL DEFAULT 0 CHECK ("overtimeHours" >= 0),
  "penaltyAmount" numeric(19,4) NOT NULL DEFAULT 0 CHECK ("penaltyAmount" >= 0),
  "createdBy" uuid,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("companyId", "employeeId", month)
);

CREATE TABLE payroll_settings (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "effectiveFrom" date NOT NULL,
  "siEmployeeRate" numeric(7,4) NOT NULL CHECK ("siEmployeeRate" >= 0 AND "siEmployeeRate" <= 100),
  "siEmployerRate" numeric(7,4) NOT NULL CHECK ("siEmployerRate" >= 0 AND "siEmployerRate" <= 100),
  "siCeiling" numeric(19,4) NOT NULL CHECK ("siCeiling" >= 0),
  "taxBrackets" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "personalExemption" numeric(19,4) NOT NULL DEFAULT 0 CHECK ("personalExemption" >= 0),
  "overtimeFactor" numeric(5,2) NOT NULL DEFAULT 1 CHECK ("overtimeFactor" >= 0),
  "monthDivisor" smallint NOT NULL DEFAULT 30 CHECK ("monthDivisor" BETWEEN 20 AND 31),
  "confirmedBy" uuid,
  "confirmedAt" timestamptz,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("companyId", "effectiveFrom")
);

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'hr.employee.read', 'View the employee file', 'عرض ملف الموظفين', 'hr'),
  (gen_random_uuid(), 'hr.employee.manage', 'Add and edit employees', 'إضافة الموظفين وتعديلهم', 'hr'),
  (gen_random_uuid(), 'hr.attendance.read', 'View monthly attendance', 'عرض الحضور الشهري', 'hr'),
  (gen_random_uuid(), 'hr.attendance.manage', 'Enter monthly attendance', 'إدخال الحضور الشهري', 'hr'),
  (gen_random_uuid(), 'hr.salary.read', 'View salary figures', 'عرض أرقام الرواتب', 'hr'),
  (gen_random_uuid(), 'hr.salary.manage', 'Set salary structures', 'تحديد هياكل الرواتب', 'hr'),
  (gen_random_uuid(), 'hr.loan.read', 'View employee loans and advances', 'عرض سلف وقروض الموظفين', 'hr'),
  (gen_random_uuid(), 'hr.loan.manage', 'Record employee loans and advances', 'تسجيل سلف وقروض الموظفين', 'hr'),
  (gen_random_uuid(), 'payroll.run.read', 'View payroll runs', 'عرض مسيرات الرواتب', 'payroll'),
  (gen_random_uuid(), 'payroll.run.create', 'Prepare and calculate payroll runs', 'إعداد مسيرات الرواتب واحتسابها', 'payroll'),
  (gen_random_uuid(), 'payroll.run.approve', 'Approve payroll runs', 'اعتماد مسيرات الرواتب', 'payroll'),
  (gen_random_uuid(), 'payroll.run.post', 'Post and reverse payroll runs', 'ترحيل مسيرات الرواتب وعكسها', 'payroll'),
  (gen_random_uuid(), 'payroll.run.pay', 'Link payment to payroll runs', 'ربط الدفع بمسيرات الرواتب', 'payroll'),
  (gen_random_uuid(), 'payroll.payslip.print', 'Print payslips', 'طباعة قسائم الرواتب', 'payroll'),
  (gen_random_uuid(), 'payroll.settings.read', 'View insurance and tax settings', 'عرض إعدادات التأمينات والضريبة', 'payroll'),
  (gen_random_uuid(), 'payroll.settings.manage', 'Change insurance and tax settings', 'تغيير إعدادات التأمينات والضريبة', 'payroll'),
  (gen_random_uuid(), 'payroll.report.read', 'View payroll reports', 'عرض تقارير الرواتب', 'payroll')
ON CONFLICT (code) DO NOTHING;

-- Existing roles: the administrator gets everything new; the accountant gets the run
-- steps and totals but never the per-employee salary or personal data.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'hr.employee.read','hr.employee.manage','hr.attendance.read','hr.attendance.manage','hr.salary.read','hr.salary.manage',
  'hr.loan.read','hr.loan.manage','payroll.run.read','payroll.run.create','payroll.run.approve','payroll.run.post','payroll.run.pay',
  'payroll.payslip.print','payroll.settings.read','payroll.settings.manage','payroll.report.read')
WHERE r.code = 'ADMIN' AND r."deletedAt" IS NULL
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'payroll.run.read','payroll.run.approve','payroll.run.post','payroll.run.pay','payroll.report.read')
WHERE r.code = 'ACCOUNTANT' AND r."deletedAt" IS NULL
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
