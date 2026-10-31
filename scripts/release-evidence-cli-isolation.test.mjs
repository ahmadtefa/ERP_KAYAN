// End-to-end CLI test in a unique disposable directory: a synthetic authority
// public key and synthetic artifacts are the only files written. The private
// half is generated and retained in memory only; it is never logged or saved.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIRED_CHECKS } from './verify-release-evidence.mjs';

test('real evidence CLI binds bytes, commit, run and authority in an isolated synthetic setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kayan-evidence-cli-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'distribution', 'release'), { recursive: true });
    const program = join(dir, 'scripts', 'verify-release-evidence.mjs');
    copyFileSync(fileURLToPath(new URL('./verify-release-evidence.mjs', import.meta.url)), program);
    const authority = generateKeyPairSync('ed25519');
    const other = generateKeyPairSync('ed25519');
    writeFileSync(join(dir, 'distribution', 'release', 'approved-evidence-public.pem'), authority.publicKey.export({ type: 'spki', format: 'pem' }));
    const artifact = join(dir, 'candidate.exe');
    const different = join(dir, 'different.exe');
    const bytes = Buffer.from('synthetic installer A');
    writeFileSync(artifact, bytes);
    writeFileSync(different, 'synthetic installer B');
    const now = Date.now();
    const payload = {
      version: 1, platform: 'windows', artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      commit: 'ab'.repeat(20), runId: '123', runAttempt: '1',
      issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
      checks: Object.fromEntries(REQUIRED_CHECKS.windows.map(name => [name, true])),
    };
    const signEnvelope = key => {
      const message = Buffer.from(JSON.stringify(payload));
      return JSON.stringify({ payload: message.toString('base64url'), signature: sign(null, message, key).toString('base64url') });
    };
    const good = signEnvelope(authority.privateKey);
    const env = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '',
      GITHUB_REPOSITORY: 'ahmadtefa/ERP_KAYAN', GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: payload.commit, GITHUB_RUN_ID: payload.runId, GITHUB_RUN_ATTEMPT: payload.runAttempt };
    const run = (path, evidence, overrides = {}) => spawnSync(process.execPath, [program, '--artifact', path], {
      encoding: 'utf8', env: { ...env, ...overrides, KAYAN_WINDOWS_RELEASE_EVIDENCE: evidence },
    });
    assert.equal(run(artifact, good).status, 0);
    const absentRoot = join(dir, 'without-approved-authority');
    mkdirSync(join(absentRoot, 'scripts'), { recursive: true });
    const absentProgram = join(absentRoot, 'scripts', 'verify-release-evidence.mjs');
    copyFileSync(fileURLToPath(new URL('./verify-release-evidence.mjs', import.meta.url)), absentProgram);
    const noAuthority = spawnSync(process.execPath, [absentProgram, '--artifact', artifact], {
      encoding: 'utf8', env: { ...env, KAYAN_WINDOWS_RELEASE_EVIDENCE: good },
    });
    assert.notEqual(noAuthority.status, 0);
    assert.match(noAuthority.stderr, /authority public key is missing or invalid/);
    for (const result of [run(artifact, ''), run(artifact, signEnvelope(other.privateKey)),
      run(different, good), run(artifact, good, { GITHUB_SHA: 'cd'.repeat(20) }),
      run(artifact, good, { GITHUB_RUN_ID: '124' }), run(artifact, good, { GITHUB_RUN_ATTEMPT: '2' })]) {
      assert.notEqual(result.status, 0);
    }
  } finally {
    // Only the new directory created by this test is removed.
    rmSync(dir, { recursive: true, force: true });
  }
});
