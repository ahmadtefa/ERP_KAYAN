-- Customer installment plans: one dated schedule per posted sales invoice.
CREATE TABLE installment_plans (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "salesInvoiceId" uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  "downPayment" numeric(19,4) NOT NULL DEFAULT 0 CHECK ("downPayment" >= 0),
  "installmentCount" integer NOT NULL CHECK ("installmentCount" BETWEEN 2 AND 120),
  "intervalMonths" integer NOT NULL CHECK ("intervalMonths" BETWEEN 1 AND 12),
  "firstDue" date NOT NULL,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX installment_plans_invoice ON installment_plans ("salesInvoiceId");

CREATE TABLE installments (
  id uuid PRIMARY KEY,
  "planId" uuid NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
  no integer NOT NULL CHECK (no >= 1),
  "dueDate" date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  "isDownPayment" boolean NOT NULL DEFAULT false,
  UNIQUE ("planId", no)
);
CREATE INDEX installments_due ON installments ("dueDate");

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'installments.read', 'View customer installment plans', 'عرض خطط تقسيط العملاء', 'sales'),
  (gen_random_uuid(), 'installments.manage', 'Create and change customer installment plans', 'إنشاء وتعديل خطط تقسيط العملاء', 'sales')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code = CASE op.code
  WHEN 'sales.invoices.read' THEN 'installments.read'
  WHEN 'sales.invoices.post' THEN 'installments.manage' END
WHERE op.code IN ('sales.invoices.read', 'sales.invoices.post')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
