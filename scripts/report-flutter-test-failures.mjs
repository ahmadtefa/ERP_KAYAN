// Summarize Flutter's JSON test events as an Actions annotation. The log stays
// in runner temp; no secrets or application data should be used in CI tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarize(text) {
const lines = text.split(/\r?\n/);
const tests = new Map();
const printed = new Map();
const errors = [];
for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === 'testStart' && event.test) tests.set(event.test.id, event.test.name);
  // Only attach exception output for screenshot tests; other test output may
  // contain synthetic credentials and must not be copied into annotations.
  if (event.type === 'print' && tests.get(event.testID)?.startsWith('screenshot:') &&
      /EXCEPTION|Error|Exception|Unable to|golden/i.test(event.message ?? '')) {
    printed.set(event.testID, String(event.message).slice(0, 5000));
  }
  // These three widget tests use only the checked-in synthetic invoice data.
  // Retain assertion counts and test file locations, not arbitrary log output.
  if (event.type === 'print' && /^(an invoice line carries the chosen cost center to the API|without cost centers the line form stays as it was|purchase editor sends multiple named landed-cost charges and their total)$/.test(tests.get(event.testID) ?? '')) {
    const details = String(event.message ?? '').split(/\r?\n/).map(line =>
      line.match(/^\s*(?:Expected:|Actual:)\s*(?:<\d+>|exactly \d+ matching candidates|no matching candidates)/)?.[0]?.trim() ??
      line.match(/test\/widget\/invoice_(?:cost_center|editor_landed_cost)_test\.dart:\d+:\d+/)?.[0] ?? ''
    ).filter(Boolean).join(' ');
    if (details) printed.set(event.testID, `${printed.get(event.testID) ?? ''} ${details}`.slice(0, 1000));
  }
  if (event.type === 'error') {
    errors.push(`${tests.get(event.testID) ?? `test ${event.testID ?? 'unknown'}`}: ${event.error ?? 'unknown error'} ${event.stackTrace ?? ''} ${printed.get(event.testID) ?? ''}`);
  }
}
const message = (errors.length ? errors.slice(0, 12).join(' | ') : lines.slice(-35).join(' | '))
  .replace(/postgres(?:ql)?:\/\/[^\s'"@]*@/gi, 'postgresql://[redacted]@')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
  .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
  .slice(0, 45000).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
return message || 'No diagnostic was captured.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Expected a Flutter test log path.');
  console.log(`::error title=Flutter test failures::${summarize(readFileSync(path, 'utf8'))}`);
}
