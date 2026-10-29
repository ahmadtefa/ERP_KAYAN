// Summarize Flutter's JSON test events as an Actions annotation. The log stays
// in runner temp; no secrets or application data should be used in CI tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarize(text) {
const lines = text.split(/\r?\n/);
const tests = new Map();
const errors = [];
for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === 'testStart' && event.test) tests.set(event.test.id, event.test.name);
  if (event.type === 'error') {
    errors.push(`${tests.get(event.testID) ?? `test ${event.testID ?? 'unknown'}`}: ${event.error ?? 'unknown error'} ${event.stackTrace ?? ''}`);
  }
}
const message = (errors.length ? errors.slice(0, 12).join(' | ') : lines.slice(-35).join(' | '))
  .slice(0, 45000).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
return message || 'No diagnostic was captured.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Expected a Flutter test log path.');
  console.log(`::error title=Flutter test failures::${summarize(readFileSync(path, 'utf8'))}`);
}
