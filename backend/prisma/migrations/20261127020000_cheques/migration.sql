-- Cheques: registered instruments with a life cycle. Money is booked only when
-- the bank confirms (collected / cleared), by a normal posted cash voucher.
CREATE TABLE cheques (
  id uuid PRIMARY KEY,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  "branchId" uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  direction varchar(16) NOT NULL CHECK (direction IN ('RECEIVED','ISSUED')),
  "chequeNumber" varchar(64) NOT NULL,
  "bankName" varchar(160) NOT NULL,
  "partyName" varchar(200),
  "customerId" uuid REFERENCES customers(id) ON DELETE RESTRICT,
  "supplierId" uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  "cashAccountId" uuid REFERENCES cash_accounts(id) ON DELETE RESTRICT,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  currency varchar(3) NOT NULL DEFAULT 'EGP',
  "issueDate" date NOT NULL,
  "dueDate" date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','DEPOSITED','COLLECTED','BOUNCED','CANCELLED')),
  allocations jsonb,
  "voucherId" uuid REFERENCES cash_vouchers(id) ON DELETE RESTRICT,
  notes text,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cheques_party_matches_direction CHECK (
    (direction = 'RECEIVED' AND "supplierId" IS NULL) OR (direction = 'ISSUED' AND "customerId" IS NULL))
);
-- The same cheque number at the same bank is registered once, unless it was cancelled.
CREATE UNIQUE INDEX cheques_number_unique ON cheques ("companyId", direction, lower("bankName"), "chequeNumber") WHERE status <> 'CANCELLED';
CREATE INDEX cheques_company_due ON cheques ("companyId", status, "dueDate");

CREATE TABLE cheque_events (
  id uuid PRIMARY KEY,
  "chequeId" uuid NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
  action varchar(16) NOT NULL,
  "fromStatus" varchar(16),
  "toStatus" varchar(16) NOT NULL,
  note text,
  "voucherId" uuid,
  "userId" uuid,
  "at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cheque_events_cheque ON cheque_events ("chequeId", "at");

INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'cheques.read', 'View cheques', 'عرض الشيكات', 'cheques'),
  (gen_random_uuid(), 'cheques.create', 'Register cheques', 'تسجيل الشيكات', 'cheques'),
  (gen_random_uuid(), 'cheques.manage', 'Deposit, collect, return and cancel cheques', 'إيداع وتحصيل وإرجاع وإلغاء الشيكات', 'cheques')
ON CONFLICT (code) DO NOTHING;

-- Roles that already read, create or post cash vouchers keep the matching ability.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp."permissionId"
JOIN permissions np ON np.code = CASE op.code
  WHEN 'cash.vouchers.read' THEN 'cheques.read'
  WHEN 'cash.vouchers.create' THEN 'cheques.create'
  WHEN 'cash.vouchers.post' THEN 'cheques.manage' END
WHERE op.code IN ('cash.vouchers.read', 'cash.vouchers.create', 'cash.vouchers.post')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
