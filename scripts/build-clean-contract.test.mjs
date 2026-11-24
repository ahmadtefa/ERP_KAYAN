// The two Windows build paths run `npm run build:clean` in backend/ before
// they package anything. The handover for this branch recorded that the script
// did not exist, so the documented packaging command failed before it produced
// a single artifact. These assertions keep the repair from drifting away again:
// the workflow command, the script entry and the clean module must all stay
// present and consistent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const backendPackage = JSON.parse(read('backend/package.json'));
const cleanModulePath = new URL('../backend/scripts/clean-build.mjs', import.meta.url);

test('the Windows packaging workflows call build:clean', () => {
  // If these change, the guard below stops covering the real command.
  const buildOnly = read('.github/workflows/windows-build-only.yml');
  assert.match(buildOnly, /working-directory: backend\n\s+run: npm run build:clean/,
    'windows-build-only.yml must run build:clean from backend/');
});

test('backend/package.json defines build:clean as a real compile, not a no-op', () => {
  const script = backendPackage.scripts['build:clean'];
  assert.equal(typeof script, 'string', 'build:clean must be defined');
  assert.match(script, /clean-build\.mjs/, 'build:clean must delete dist/ through the checked-in module');
  assert.match(script, /\bnest build\b/, 'build:clean must compile after cleaning');
  assert.ok(!/^\s*$/.test(script), 'build:clean must not be empty');
});

test('the clean module exists and targets only dist/', () => {
  assert.ok(existsSync(cleanModulePath), 'backend/scripts/clean-build.mjs must exist');
  const source = readFileSync(cleanModulePath, 'utf8');
  assert.match(source, /rmSync\(dist, \{ recursive: true, force: true \}\)/,
    'the clean module must remove dist/ recursively and tolerate its absence');
  // A cleaning step that can delete anything else is worse than a stale build.
  const removals = source.match(/rmSync\(/g) || [];
  assert.equal(removals.length, 1, 'the clean module must delete exactly one path');
});
