/**
 * Pins the database-state classifier (database-state.mjs) without a
 * database: the four states the desktop shell routes on, and the one
 * rule that protects real data - an unanswerable question is
 * "unknown", never "empty".
 *
 * Run in CI next to the other script checks. Exit 0 = the classifier
 * still means what the shell thinks it means.
 */
import assert from 'node:assert/strict';

import {
  classifyDatabaseState,
  needsFirstAdministrator,
} from './database-state.mjs';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} -> ${actual}`);
  if (!ok) failures += 1;
};

check(
  'a just-created database (no company, no users) is empty',
  classifyDatabaseState({ companies: 0, users: 0 }),
  'empty',
);
check(
  'a company without users is incomplete, not empty',
  classifyDatabaseState({ companies: 1, users: 0 }),
  'incomplete',
);
check(
  'users without a company is incomplete, not empty',
  classifyDatabaseState({ companies: 0, users: 3 }),
  'incomplete',
);
check(
  'a company with users is ready',
  classifyDatabaseState({ companies: 1, users: 1 }),
  'ready',
);
check(
  'an unanswered question is unknown, never empty',
  classifyDatabaseState({ companies: null, users: undefined }),
  'unknown',
);
check(
  'non-integer counts are unknown, never empty',
  classifyDatabaseState({ companies: 0.5, users: 0 }),
  'unknown',
);

assert.equal(needsFirstAdministrator('empty'), true);
assert.equal(needsFirstAdministrator('incomplete'), true);
assert.equal(needsFirstAdministrator('ready'), false);
assert.equal(needsFirstAdministrator('unknown'), false);
console.log('PASS  only empty and incomplete need a first administrator');

console.log(
  failures === 0
    ? 'database-state checks: all passed'
    : `database-state checks: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
