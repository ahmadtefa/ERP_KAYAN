# تصنيف lint — مقارنة HEAD بالشجرة الحالية

تهيئة ESLint الحالية أضيفت مؤخرًا؛ لم يكن lint المكتمل متاحًا قبلها. المقارنة تستخدم القواعد الحالية على HEAD وعلى الشجرة، لذلك لا تثبت وقت نشوء المخالفة تاريخيًا. عمود «مطابق HEAD» يطابق الملف والقاعدة والرسالة وبصمة السطر دون كشف محتواه؛ «غير مطابق» يشمل أسطرًا معدلة أو جديدة وملفات غير متتبعة، وقد يتضمن مسائل قديمة تغيّر سطرها. scripts/tools خارج نطاق الأمر `src/**/*.ts`.

الإجمالي: 510 نتيجة (509 error، 1 warning) في 73 ملفًا. نتائج HEAD تحت القواعد الجديدة: 297. تقسيم النطاق: {'test': 429, 'integration': 2, 'production': 79}.

## أعلى القواعد

| القاعدة | العدد |
|---|---:|
| `@typescript-eslint/no-explicit-any` | 466 |
| `@typescript-eslint/no-unused-vars` | 32 |
| `@typescript-eslint/no-require-imports` | 8 |
| `no-useless-escape` | 2 |
| `unused-disable` | 1 |
| `no-control-regex` | 1 |

## أعلى الملفات

| الملف | العدد |
|---|---:|
| `src/modules/backup/full-backup.service.spec.ts` | 47 |
| `src/modules/backup/backup.service.spec.ts` | 42 |
| `src/modules/auth/auth.service.spec.ts` | 30 |
| `src/modules/admin/permission-escalation.spec.ts` | 26 |
| `src/modules/licensing/licensing.service.spec.ts` | 17 |
| `src/modules/purchases/purchase-invoices.units.spec.ts` | 17 |
| `src/modules/accounting/chart-of-accounts.service.spec.ts` | 15 |
| `src/modules/sales/sales-invoices.units.spec.ts` | 15 |
| `src/modules/backup/backup.service.ts` | 13 |
| `src/modules/import/import.controller.spec.ts` | 13 |
| `src/modules/licensing/installed-corrupt-state-safety.spec.ts` | 13 |
| `src/modules/reports/reports.service.spec.ts` | 13 |
| `src/modules/licensing/licensing.enforcement.spec.ts` | 11 |
| `src/modules/parties/parties.service.ts` | 11 |
| `src/modules/company/setup.service.spec.ts` | 10 |

## كل ملف وقاعدة

| الملف | النوع | القاعدة | الكل | مطابق HEAD | غير مطابق | تحذير |
|---|---|---|---:|---:|---:|---:|
| `src/common/filters/problem-details.filter.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 4 | 2 | 2 | 0 |
| `src/common/maintenance/maintenance.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 3 | 3 | 0 | 0 |
| `src/e2e-real/scenario.ts` | integration | `@typescript-eslint/no-unused-vars` | 2 | 0 | 2 | 0 |
| `src/modules/accounting/budgets.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 6 | 6 | 0 | 0 |
| `src/modules/accounting/chart-of-accounts.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 15 | 15 | 0 | 0 |
| `src/modules/accounting/fiscal-periods.service.ts` | production | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/accounting/opening-balances.controller.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 | 0 |
| `src/modules/accounting/year-end-close.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 4 | 0 | 4 | 0 |
| `src/modules/admin/permission-escalation.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 26 | 8 | 18 | 0 |
| `src/modules/admin/roles.service.ts` | production | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/admin/users.service.extra-permissions.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 7 | 6 | 1 | 0 |
| `src/modules/admin/users.service.ts` | production | `@typescript-eslint/no-explicit-any` | 4 | 4 | 0 | 0 |
| `src/modules/auth/auth.controller.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/auth/auth.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 30 | 24 | 6 | 0 |
| `src/modules/backup/backup.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 40 | 38 | 2 | 0 |
| `src/modules/backup/backup.service.spec.ts` | test | `@typescript-eslint/no-require-imports` | 2 | 2 | 0 | 0 |
| `src/modules/backup/backup.service.ts` | production | `@typescript-eslint/no-explicit-any` | 13 | 13 | 0 | 0 |
| `src/modules/backup/full-backup.controller.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/backup/full-backup.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 47 | 43 | 4 | 0 |
| `src/modules/cash/bank-reconciliation.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 5 | 0 | 5 | 0 |
| `src/modules/cash/cash-vouchers.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 9 | 0 | 9 | 0 |
| `src/modules/cash/cash-vouchers.service.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/company/company.service.ts` | production | `@typescript-eslint/no-unused-vars` | 3 | 3 | 0 | 0 |
| `src/modules/company/setup.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 10 | 3 | 7 | 0 |
| `src/modules/company/setup.service.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/export/documents.service.spec.ts` | test | `@typescript-eslint/no-require-imports` | 1 | 0 | 1 | 0 |
| `src/modules/export/documents.service.ts` | production | `@typescript-eslint/no-explicit-any` | 6 | 6 | 0 | 0 |
| `src/modules/export/documents.service.ts` | production | `no-useless-escape` | 2 | 2 | 0 | 0 |
| `src/modules/export/documents.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 | 0 |
| `src/modules/export/list-tables.service.ts` | production | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/export/list-tables.service.ts` | production | `@typescript-eslint/no-unused-vars` | 2 | 2 | 0 | 0 |
| `src/modules/export/writers.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 3 | 3 | 0 | 0 |
| `src/modules/health/health.controller.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 1 | 1 | 0 | 0 |
| `src/modules/import/import.controller.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 13 | 3 | 10 | 0 |
| `src/modules/import/import.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 6 | 6 | 0 | 0 |
| `src/modules/import/import.service.spec.ts` | test | `@typescript-eslint/no-unused-vars` | 4 | 4 | 0 | 0 |
| `src/modules/import/tabular.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/inventory/barcode-labels.controller.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 8 | 0 | 8 | 0 |
| `src/modules/inventory/inventory-reports.units-lifecycle.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 6 | 0 | 6 | 0 |
| `src/modules/inventory/inventory-reports.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 5 | 0 | 5 | 0 |
| `src/modules/inventory/items.barcode.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 6 | 0 | 6 | 0 |
| `src/modules/inventory/items.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 5 | 5 | 0 | 0 |
| `src/modules/inventory/items.service.ts` | production | `@typescript-eslint/no-explicit-any` | 3 | 3 | 0 | 0 |
| `src/modules/inventory/stock-documents.service.ts` | production | `@typescript-eslint/no-explicit-any` | 1 | 0 | 1 | 0 |
| `src/modules/inventory/stock-documents.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 7 | 0 | 7 | 0 |
| `src/modules/inventory/stock-documents.warehouse-guard.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 1 | 0 | 1 | 0 |
| `src/modules/licensing/installed-corrupt-state-safety.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 13 | 0 | 13 | 0 |
| `src/modules/licensing/license-generator.spec.ts` | test | `@typescript-eslint/no-require-imports` | 2 | 0 | 2 | 0 |
| `src/modules/licensing/license-generator.spec.ts` | test | `@typescript-eslint/no-unused-vars` | 5 | 0 | 5 | 0 |
| `src/modules/licensing/license.guard.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 | 0 |
| `src/modules/licensing/licensing-key-replacement.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 | 0 |
| `src/modules/licensing/licensing-upgrade-model.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 | 0 |
| `src/modules/licensing/licensing.enforcement.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 11 | 0 | 11 | 0 |
| `src/modules/licensing/licensing.harness.ts` | production | `@typescript-eslint/no-explicit-any` | 5 | 0 | 5 | 0 |
| `src/modules/licensing/licensing.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 16 | 0 | 16 | 0 |
| `src/modules/licensing/licensing.service.spec.ts` | test | `@typescript-eslint/no-unused-vars` | 1 | 0 | 1 | 0 |
| `src/modules/licensing/licensing.service.ts` | production | `@typescript-eslint/no-require-imports` | 1 | 0 | 1 | 0 |
| `src/modules/licensing/licensing.service.ts` | production | `@typescript-eslint/no-unused-vars` | 2 | 0 | 2 | 0 |
| `src/modules/licensing/licensing.service.ts` | production | `unused-disable` | 1 | 0 | 1 | 1 |
| `src/modules/parties/parties.service.ts` | production | `@typescript-eslint/no-explicit-any` | 11 | 11 | 0 | 0 |
| `src/modules/purchases/purchase-invoices.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 9 | 9 | 0 | 0 |
| `src/modules/purchases/purchase-invoices.service.ts` | production | `@typescript-eslint/no-explicit-any` | 3 | 2 | 1 | 0 |
| `src/modules/purchases/purchase-invoices.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 17 | 0 | 17 | 0 |
| `src/modules/purchases/purchase-orders.service.ts` | production | `@typescript-eslint/no-explicit-any` | 1 | 0 | 1 | 0 |
| `src/modules/purchases/purchase-orders.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 5 | 0 | 5 | 0 |
| `src/modules/reports/aging.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/reports/aging.service.ts` | production | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/reports/operations-reports.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 1 | 1 | 0 | 0 |
| `src/modules/reports/operations-reports.service.spec.ts` | test | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/reports/reports.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 11 | 8 | 3 | 0 |
| `src/modules/reports/reports.service.spec.ts` | test | `@typescript-eslint/no-require-imports` | 2 | 1 | 1 | 0 |
| `src/modules/returns/returns.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 10 | 10 | 0 | 0 |
| `src/modules/returns/returns.service.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/returns/returns.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 9 | 0 | 9 | 0 |
| `src/modules/sales/cost-redaction.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 | 0 |
| `src/modules/sales/quotation-document.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/sales/quotations.service.ts` | production | `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | 0 |
| `src/modules/sales/quotations.service.ts` | production | `no-control-regex` | 1 | 0 | 1 | 0 |
| `src/modules/sales/sales-invoices.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 3 | 3 | 0 | 0 |
| `src/modules/sales/sales-invoices.service.ts` | production | `@typescript-eslint/no-explicit-any` | 4 | 3 | 1 | 0 |
| `src/modules/sales/sales-invoices.units.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 15 | 0 | 15 | 0 |
| `src/modules/sales/sales-invoices.update.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 2 | 2 | 0 | 0 |
| `src/modules/sales/sales-orders.service.ts` | production | `@typescript-eslint/no-explicit-any` | 1 | 0 | 1 | 0 |
| `src/modules/search/search.service.spec.ts` | test | `@typescript-eslint/no-explicit-any` | 1 | 1 | 0 | 0 |
| `src/modules/search/search.service.spec.ts` | test | `@typescript-eslint/no-unused-vars` | 5 | 5 | 0 | 0 |
