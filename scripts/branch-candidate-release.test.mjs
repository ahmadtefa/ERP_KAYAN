import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Handing a file to a customer is a release decision. This structural check
 * keeps the branch hand-over job honest: it may only publish what the pipeline
 * inspected and installed, it may never publish from main, and it may never
 * claim to be the production release.
 *
 * It is a static check of the workflow text. It does not prove GitHub ran the
 * jobs, which is why the hand-over job depends on them explicitly.
 */
const workflow = readFileSync(
  new URL('../.github/workflows/windows-installer.yml', import.meta.url),
  'utf8',
);

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:`);
  assert.ok(start > 0, `workflow has no ${name} job`);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n  [a-z-]+:/);
  return end < 0 ? rest : rest.slice(0, end);
}

test('the branch hand-over depends on the payload inspection and the installed smoke test', () => {
  const handover = job('publish-branch-candidate');
  assert.match(handover, /needs: \[build, inspect-final, smoke-final\]/);
  assert.match(handover, /name: windows-installer-inspected-internal-\$\{\{ github\.sha \}\}/);
  assert.match(handover, /name: windows-installer-runtime-evidence-\$\{\{ github\.sha \}\}/);
});

test('the branch hand-over can only run for a product build off main', () => {
  const handover = job('publish-branch-candidate');
  assert.match(handover, /github\.event_name == 'push'/);
  assert.match(handover, /github\.ref != 'refs\/heads\/main'/);
  assert.match(handover, /needs\.build\.outputs\.build_mode == 'product'/);
});

test('the branch hand-over proves the file is the one that was tested', () => {
  const handover = job('publish-branch-candidate');
  assert.match(handover, /build\.sha256 !== actual/);
  assert.match(handover, /payload\.installer\.sha256 !== actual/);
  assert.match(handover, /smoke\.installerSha256 !== actual/);
  assert.match(handover, /build\.mode !== "product"/);
});

test('the branch hand-over is a prerelease that never replaces an existing one', () => {
  const handover = job('publish-branch-candidate');
  assert.match(handover, /--prerelease/);
  assert.match(handover, /--latest=false/);
  assert.match(handover, /gh release view "\$tag"[\s\S]*?refusing to replace/);
  assert.doesNotMatch(handover, /--clobber/);
  assert.doesNotMatch(handover, /makeLatest: true/);
});

test('the production release path is unchanged and still requires signed evidence', () => {
  const publish = job('publish-windows');
  assert.match(publish, /environment: windows-production/);
  assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publish, /verify-release-evidence\.mjs/);
  assert.match(publish, /check-release-environment\.mjs/);
  // The old, unconditional publication steps stay disabled.
  const build = workflow.slice(0, workflow.indexOf('\n  publish-windows:'));
  for (const entry of build.matchAll(
    /- name: (?:Publish direct Setup\.exe download|Publish branch prerelease with direct Setup\.exe download)([\s\S]*?)(?=\n      - name:|\n  [a-z-]+:|$)/g,
  )) {
    assert.match(entry[1], /if:\s*\$\{\{\s*false\s*\}\}/);
  }
});
