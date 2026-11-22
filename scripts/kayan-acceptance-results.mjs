#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [log, output] = process.argv.slice(2);
if (!log || !output) throw new Error('Expected Flutter JSONL log and output path');
const groups = {
  form_widget: /form_sheet_test\.dart$/,
  network_contract: /order_edit_error_code_test\.dart$/,
  error_resolver: /app_error_text_test\.dart$/,
  dialog_widget: /app_error_dialog_lifecycle_test\.dart$/,
  // The screens that act on a row - marking a notification read, archiving
  // one, scanning for expiry - report a failure through the dialog, keep the
  // server's sentence, and must not leave a spinner running behind it.
  action_error_widget: /action_errors_use_dialog_test\.dart$/,
  expiry_scan_widget: /expiry_alerts_screen_test\.dart$/,
  invoice_widget: /invoice_action_refresh_error_test\.dart$/,
  theme_widget: /module_scaffold_navigation_test\.dart$|app_theme_font_test\.dart$/,
  groups_widget: /erp_shell_groups_test\.dart$/,
  menu_pictures: /menu_accordion_screenshots_test\.dart$/,
  dashboard_widget: /dashboard_screen_test\.dart$/,
  tax_widget: /item_blank_tax_test\.dart$/,
  photo_widget: /user_photo_test\.dart$/,
  voucher_widget: /stock_voucher_flow_test\.dart$/,
  accounts_widget: /chart_of_accounts_interaction_test\.dart$/,
};
const suites = new Map();
const tests = new Map();
const errors = new Map();
const verdicts = new Map(Object.keys(groups).map(key => [key, []]));
const skipped = [];
const allTests = [];
const bytes = readFileSync(log === '-' ? 0 : log);
const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8';
for (const line of bytes.toString(encoding).replace(/^\uFEFF/, '').split(/\r?\n/)) {
  if (!line.trim()) continue;
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === 'suite') suites.set(event.suite.id, event.suite.path);
  if (event.type === 'testStart') tests.set(event.test.id, event.test);
  if (event.type === 'error' && typeof event.error === 'string') {
    errors.set(event.testID, event.error.slice(0, 2000));
  }
  if (event.type !== 'testDone') continue;
  const test = tests.get(event.testID);
  const path = suites.get(test?.suiteID) ?? '';
  if (event.hidden) continue;
  allTests.push({ path, name: test?.name ?? 'unknown', status: event.skipped ? 'NOT TESTED' : event.result === 'success' ? 'PASS' : 'FAIL', ...(errors.has(event.testID) ? { error: errors.get(event.testID) } : {}) });
  if (event.skipped) skipped.push({ path, name: test?.name ?? 'unknown' });
  for (const [group, pattern] of Object.entries(groups)) {
    if (pattern.test(path)) verdicts.get(group).push(event.skipped ? 'NOT TESTED' : event.result === 'success' ? 'PASS' : 'FAIL');
  }
}
const results = { skipped };
const failedTests = allTests.filter(test => test.status === 'FAIL');
results.flutter_full_suite = {
  status: process.env.FLUTTER_STATUS == null || allTests.length === 0 ? 'NOT TESTED'
    : process.env.FLUTTER_STATUS !== '0' || failedTests.length ? 'FAIL'
    : skipped.length ? 'FAIL' : 'PASS',
  evidence: `${allTests.length} Flutter tests, ${failedTests.length} failed, ${skipped.length} skipped in ${log}`,
  failures: failedTests,
};
for (const [group, statuses] of verdicts) {
  results[group] = { status: statuses.includes('FAIL') ? 'FAIL'
    : statuses.length && statuses.every(status => status === 'PASS') ? 'PASS' : 'NOT TESTED',
    evidence: `${statuses.length} Flutter test results in ${log}` };
}
results.backend_contract = { status: process.env.BACKEND_STATUS == null ? 'NOT TESTED'
  : process.env.BACKEND_STATUS === '0' ? 'PASS' : 'FAIL',
  evidence: 'backend/problem-details.filter.spec.ts; see backend.log' };
if (process.env.FLUTTER_STATUS != null && process.env.FLUTTER_STATUS !== '0') for (const group of Object.keys(groups)) {
  if (results[group].status === 'NOT TESTED') results[group].status = 'BLOCKED';
}
results.screen_audit = { status: 'NOT TESTED', evidence: 'screen-audit.json lists review candidates; structure alone cannot prove behavior' };
results.skip_audit = { status: skipped.length ? 'FAIL' : 'PASS', evidence: `${skipped.length} skipped Flutter tests` };
writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
