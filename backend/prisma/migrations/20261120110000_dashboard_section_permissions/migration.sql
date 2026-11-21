-- Per-section dashboard permissions. Existing roles keep their existing grants;
-- these additive grants bring the shipped roles in line with their catalogue
-- definitions. Companies can then edit every section independently in Roles.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'dashboard.sales', 'View total sales on the dashboard', 'عرض إجمالي المبيعات في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.purchases', 'View total purchases on the dashboard', 'عرض إجمالي المشتريات في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.revenue', 'View revenue and expenses on the dashboard', 'عرض الإيرادات والمصروفات في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.profit', 'View net result on the dashboard', 'عرض صافي النتيجة في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.cash', 'View cash and bank balances on the dashboard', 'عرض أرصدة الخزائن والبنوك في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.movements', 'View receipts and payments on the dashboard', 'عرض المقبوضات والمدفوعات في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.receivables', 'View customer receivables on the dashboard', 'عرض أرصدة ومستحقات العملاء في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.payables', 'View supplier payables on the dashboard', 'عرض أرصدة ومستحقات الموردين في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.stock', 'View stock value on the dashboard', 'عرض قيمة المخزون في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.charts', 'View dashboard charts and comparisons', 'عرض الرسوم البيانية والمقارنات في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.top', 'View top customers and items on the dashboard', 'عرض أفضل العملاء والأصناف في لوحة التحكم', 'dashboard'),
  (gen_random_uuid(), 'dashboard.recent', 'View recent documents on the dashboard', 'عرض آخر العمليات في لوحة التحكم', 'dashboard')
ON CONFLICT (code) DO NOTHING;

-- Add only the grants that correspond to each built-in role. Do not remove or
-- rewrite any company-specific assignment or explicit user denial.
WITH role_section("roleCode", permissionCode) AS (
  VALUES
    ('ADMIN', 'dashboard.sales'), ('ADMIN', 'dashboard.purchases'), ('ADMIN', 'dashboard.revenue'), ('ADMIN', 'dashboard.profit'), ('ADMIN', 'dashboard.cash'), ('ADMIN', 'dashboard.movements'), ('ADMIN', 'dashboard.receivables'), ('ADMIN', 'dashboard.payables'), ('ADMIN', 'dashboard.stock'), ('ADMIN', 'dashboard.charts'), ('ADMIN', 'dashboard.top'), ('ADMIN', 'dashboard.recent'),
    ('GENERAL_MANAGER', 'dashboard.sales'), ('GENERAL_MANAGER', 'dashboard.purchases'), ('GENERAL_MANAGER', 'dashboard.revenue'), ('GENERAL_MANAGER', 'dashboard.profit'), ('GENERAL_MANAGER', 'dashboard.cash'), ('GENERAL_MANAGER', 'dashboard.movements'), ('GENERAL_MANAGER', 'dashboard.receivables'), ('GENERAL_MANAGER', 'dashboard.payables'), ('GENERAL_MANAGER', 'dashboard.stock'), ('GENERAL_MANAGER', 'dashboard.charts'), ('GENERAL_MANAGER', 'dashboard.top'), ('GENERAL_MANAGER', 'dashboard.recent'),
    ('REPORT_USER', 'dashboard.sales'), ('REPORT_USER', 'dashboard.purchases'), ('REPORT_USER', 'dashboard.revenue'), ('REPORT_USER', 'dashboard.profit'), ('REPORT_USER', 'dashboard.cash'), ('REPORT_USER', 'dashboard.movements'), ('REPORT_USER', 'dashboard.receivables'), ('REPORT_USER', 'dashboard.payables'), ('REPORT_USER', 'dashboard.stock'), ('REPORT_USER', 'dashboard.charts'), ('REPORT_USER', 'dashboard.top'), ('REPORT_USER', 'dashboard.recent'),
    ('INTERNAL_AUDITOR', 'dashboard.sales'), ('INTERNAL_AUDITOR', 'dashboard.purchases'), ('INTERNAL_AUDITOR', 'dashboard.revenue'), ('INTERNAL_AUDITOR', 'dashboard.profit'), ('INTERNAL_AUDITOR', 'dashboard.cash'), ('INTERNAL_AUDITOR', 'dashboard.movements'), ('INTERNAL_AUDITOR', 'dashboard.receivables'), ('INTERNAL_AUDITOR', 'dashboard.payables'), ('INTERNAL_AUDITOR', 'dashboard.stock'), ('INTERNAL_AUDITOR', 'dashboard.charts'), ('INTERNAL_AUDITOR', 'dashboard.top'), ('INTERNAL_AUDITOR', 'dashboard.recent'),
    ('ACCOUNTANT', 'dashboard.sales'), ('ACCOUNTANT', 'dashboard.purchases'), ('ACCOUNTANT', 'dashboard.revenue'), ('ACCOUNTANT', 'dashboard.profit'), ('ACCOUNTANT', 'dashboard.cash'), ('ACCOUNTANT', 'dashboard.movements'), ('ACCOUNTANT', 'dashboard.receivables'), ('ACCOUNTANT', 'dashboard.payables'), ('ACCOUNTANT', 'dashboard.stock'), ('ACCOUNTANT', 'dashboard.charts'), ('ACCOUNTANT', 'dashboard.top'), ('ACCOUNTANT', 'dashboard.recent'),
    ('FINANCE_MANAGER', 'dashboard.sales'), ('FINANCE_MANAGER', 'dashboard.purchases'), ('FINANCE_MANAGER', 'dashboard.receivables'), ('FINANCE_MANAGER', 'dashboard.payables'), ('FINANCE_MANAGER', 'dashboard.stock'), ('FINANCE_MANAGER', 'dashboard.charts'), ('FINANCE_MANAGER', 'dashboard.top'), ('FINANCE_MANAGER', 'dashboard.recent'),
    ('SALES_MANAGER', 'dashboard.sales'), ('SALES_MANAGER', 'dashboard.receivables'), ('SALES_MANAGER', 'dashboard.charts'), ('SALES_MANAGER', 'dashboard.top'), ('SALES_MANAGER', 'dashboard.recent'),
    ('SALES_CLERK', 'dashboard.sales'),
    ('PURCHASING_MANAGER', 'dashboard.purchases'), ('PURCHASING_MANAGER', 'dashboard.payables'), ('PURCHASING_MANAGER', 'dashboard.charts'), ('PURCHASING_MANAGER', 'dashboard.top'), ('PURCHASING_MANAGER', 'dashboard.recent'),
    ('PURCHASING_CLERK', 'dashboard.purchases'),
    ('WAREHOUSE_MANAGER', 'dashboard.stock'), ('STOREKEEPER', 'dashboard.stock'),
    ('TREASURER', 'dashboard.cash'), ('TREASURER', 'dashboard.movements'),
    ('BANK_OFFICER', 'dashboard.cash'),
    ('COLLECTION_OFFICER', 'dashboard.receivables'), ('COLLECTION_OFFICER', 'dashboard.movements')
)
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id
FROM role_section rs
JOIN roles r ON r.code = rs."roleCode" AND r."deletedAt" IS NULL
JOIN permissions p ON p.code = rs.permissionCode
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
