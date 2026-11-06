// Only aggregates JSON reporter events. Never copies test output or names,
// which can contain application data, into the public check annotations.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function countTests(text) {
  const tests = new Map();
  let completed = false;
  for (const line of text.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'testStart' && event.test) {
      tests.set(event.test.id, { hidden: Boolean(event.test.hidden) });
    } else if (event.type === 'testDone' && tests.has(event.testID)) {
      const test = tests.get(event.testID);
      test.hidden ||= Boolean(event.hidden);
      test.skipped = Boolean(event.skipped);
      test.result = event.result;
    } else if (event.type === 'done') {
      completed = true;
    }
  }
  if (!completed || !tests.size) throw new Error('Flutter JSON reporter did not produce a complete test run');
  const counts = { passed: 0, failed: 0, skipped: 0, unfinished: 0 };
  for (const test of tests.values()) {
    if (test.hidden) continue;
    if (!test.result) counts.unfinished++;
    else if (test.skipped) counts.skipped++;
    else if (test.result === 'success') counts.passed++;
    else counts.failed++;
  }
  return counts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Expected a Flutter JSON log path');
  const { passed, failed, skipped, unfinished } = countTests(readFileSync(path, 'utf8'));
  console.log(`::notice title=Flutter test counts::passed=${passed}; failed=${failed}; skipped=${skipped}; unfinished=${unfinished}`);
  if (unfinished) process.exitCode = 1;
}
