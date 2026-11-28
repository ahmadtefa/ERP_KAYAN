-- Payroll and HR, part 2: the accounts a payroll posts to, monthly runs and their lines,
-- employee loans and the instalments taken from each run.
CREATE TABLE payroll_accounts (
  "companyId" uuid PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  "salariesExpenseId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "employerSiExpenseId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "siPayableId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "taxPayableId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "loansReceivableId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "salariesPayableId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "deductionsPayableId" uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  "updatedBy" uuid,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "branchId" uuid REFERENCES branches(id) ON DELETE RESTRICT,
  month char(7) NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CALCULATED','APPROVED','POSTED','PAID')),
  "settingsId" uuid REFERENCES payroll_settings(id) ON DELETE RESTRICT,
  "preparedBy" uuid,
  "approvedBy" uuid,
  "approvedAt" timestamptz,
  "postedBy" uuid,
  "postedAt" timestamptz,
  "journalEntryId" uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  "paidBy" uuid,
  "paidAt" timestamptz,
  "paymentJournalEntryId" uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  "totalGross" numeric(19,4) NOT NULL DEFAULT 0,
  "totalNet" numeric(19,4) NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("companyId", month)
);

CREATE TABLE payroll_run_lines (
  id uuid PRIMARY KEY,
  "runId" uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  "employeeId" uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,
  "costCenterId" uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
  basic numeric(19,4) NOT NULL,
  allowances numeric(19,4) NOT NULL,
  overtime numeric(19,4) NOT NULL,
  "absenceDeduction" numeric(19,4) NOT NULL,
  penalty numeric(19,4) NOT NULL,
  gross numeric(19,4) NOT NULL,
  "employeeSI" numeric(19,4) NOT NULL,
  "employerSI" numeric(19,4) NOT NULL,
  tax numeric(19,4) NOT NULL,
  deductions numeric(19,4) NOT NULL,
  "loanInstalment" numeric(19,4) NOT NULL,
  net numeric(19,4) NOT NULL CHECK (net >= 0),
  proration numeric(9,6) NOT NULL,
  UNIQUE ("runId", "employeeId")
);

CREATE TABLE hr_employee_loans (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "employeeId" uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,
  "loanDate" date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  instalments integer NOT NULL CHECK (instalments BETWEEN 1 AND 120),
  "firstDeductionMonth" char(7) NOT NULL CHECK ("firstDeductionMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status varchar(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED')),
  "journalEntryId" uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  "remainingBalance" numeric(19,4) NOT NULL CHECK ("remainingBalance" >= 0),
  note varchar(200),
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hr_employee_loans_employee ON hr_employee_loans ("companyId", "employeeId", status);

CREATE TABLE hr_loan_deductions (
  id uuid PRIMARY KEY,
  "loanId" uuid NOT NULL REFERENCES hr_employee_loans(id) ON DELETE RESTRICT,
  "runId" uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  applied boolean NOT NULL DEFAULT false,
  UNIQUE ("loanId", "runId")
);
