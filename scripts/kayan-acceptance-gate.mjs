#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const failed = report.checks.filter(check => check.status === 'FAIL');
const skipped = report.skipped ?? [];
if (failed.length || skipped.length) {
  console.error(`Acceptance gate: ${failed.length} failed requirements, ${skipped.length} skipped tests.`);
  process.exitCode = 1;
} else {
  console.log(`Acceptance gate: no failed requirements or skipped tests; ${report.counts['NOT TESTED']} remain untested.`);
}
