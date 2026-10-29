import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// This is a structural check, not execution of GitHub Actions or evidence of
// a protected environment. The metadata and independent authority must be
// verified separately by the release job.
test('the same-run production candidate cannot be uploaded ahead of signed evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  const split = workflow.indexOf('\n  publish-windows:');
  assert.ok(split > 0);
  const build = workflow.slice(0, split);
  const publish = workflow.slice(split);
  const upload = build.match(/- name: Upload product installer \(diagnostic artifact\)([\s\S]*?)(?=\n      - name:|\n  [a-z-]+:|$)/);
  assert.ok(upload && /if:\s*\$\{\{ false \}\}/.test(upload[1]));
  const oldReleases = [...build.matchAll(/- name: (?:Publish direct Setup\.exe download|Publish branch prerelease with direct Setup\.exe download)([\s\S]*?)(?=\n      - name:|\n  [a-z-]+:|$)/g)];
  assert.equal(oldReleases.length, 2);
  for (const entry of oldReleases) assert.match(entry[1], /if:\s*\$\{\{ false \}\}/);
  assert.doesNotMatch(publish, /actions\/upload-artifact/);
  assert.match(publish, /needs: build/);
  assert.match(publish, /environment: windows-production/);
  const environment = publish.indexOf('check-release-environment.mjs');
  const download = publish.indexOf('actions/download-artifact@v4');
  const inspect = publish.indexOf('inspect-final-inno.mjs');
  const evidence = publish.indexOf('verify-release-evidence.mjs');
  const release = publish.indexOf('publish-verified-windows.mjs');
  assert.ok(environment >= 0 && environment < download && download < inspect && inspect < evidence && evidence < release);
});
