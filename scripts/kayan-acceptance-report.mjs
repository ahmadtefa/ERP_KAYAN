#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const resultFile = process.argv[2] ?? 'build/acceptance/results.json';
const outputFile = process.argv[3] ?? 'build/acceptance/report.json';
let results = {};
try { results = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { /* no run is not a pass */ }
const requirements = [
  ['A01', 'Manually cleared tax becomes zero; otherwise item or company tax applies', ['tax_widget', 'tax_backend']],
  ['A02', 'Data refreshes after save, posting, and migration', ['refresh_widget', 'migration_integration']],
  ['A03', 'Refresh control obtains current backend data', ['refresh_control_widget']],
  ['A04', 'Back navigation protects unsaved changes', ['back_guard_widget']],
  ['A05', 'Eight navigation groups expand exclusively with distinct active state', ['groups_widget']],
  ['A06', 'User photo survives logout and restart', ['photo_widget', 'photo_runtime']],
  ['A07', 'Home navigation works without breaking the route stack', ['home_widget']],
  ['A08', 'Chart of accounts create, edit, deactivate, hierarchy and conflicts', ['accounts_widget', 'accounts_postgres']],
  ['A09', 'Localized central errors and inline field errors across forms', ['backend_contract', 'network_contract', 'dialog_widget', 'form_widget', 'screen_audit']],
  ['A10', 'Stock voucher lifecycle, permissions, printing, search and required cost center', ['voucher_widget', 'voucher_postgres']],
  ['A11', 'Stock and cost center postings prevent negative stock and duplicate journals', ['stock_postgres']],
  ['X01', 'Sales invoice posting shows actual shortage in Arabic and English', ['invoice_widget', 'error_resolver']],
  ['X02', 'Internal screens share theme without dashboard regression', ['theme_widget', 'dashboard_widget', 'screen_audit']],
  ['X03', 'Warehouse, location, barcode, units, batches, FEFO, counts and write-offs', ['inventory_widget', 'inventory_postgres']],
  ['X04', 'Cash, bank, opening balances, returns and voucher allocations', ['finance_widget', 'finance_postgres']],
  ['X05', 'Price and cost permissions, bilingual names, reports and administrator profile', ['permissions_widget', 'reports_widget']],
  ['X06', 'Complete backup, restore and failed-restore recovery', ['backup_postgres', 'restore_runtime']],
  ['X07', 'Offline Windows Setup installs Flutter, Backend, Node, Prisma and PostgreSQL', ['windows_setup', 'windows_install']],
  ['X08', 'Licensed installed product enforces activation', ['licence_runtime']],
  ['X09', 'Skipped tests are disclosed', ['skip_audit']],
  ['X10', 'Full Flutter suite completes with no failures or skips', ['flutter_full_suite']],
];
const values = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT TESTED']);
const checks = requirements.map(([id, requirement, tests]) => {
  const evidence = tests.map(test => ({ test, ...(results[test] ?? { status: 'NOT TESTED' }) }));
  const status = evidence.some(e => e.status === 'FAIL') ? 'FAIL'
    : evidence.some(e => e.status === 'BLOCKED') ? 'BLOCKED'
    : evidence.every(e => e.status === 'PASS') ? 'PASS' : 'NOT TESTED';
  return { id, requirement, status, evidence };
});
for (const check of checks) for (const entry of check.evidence) {
  if (!values.has(entry.status)) throw new Error(`Invalid acceptance status: ${entry.status}`);
}
const report = { generatedAt: new Date().toISOString(), checks,
  skipped: results.skipped ?? [], counts: Object.fromEntries([...values].map(status =>
    [status, checks.filter(check => check.status === status).length])) };
mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.counts));
