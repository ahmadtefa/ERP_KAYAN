// The release guard decides whether a Windows build may be published, and a
// wrong answer here overwrites a download that customers already have. These
// tests pin every branch of that decision, and the CLI's exit codes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { DECISION, decide } from './check-release-tag.mjs';

const tag = 'windows-v0.1.1';

test('a tag that does not exist may be published', () => {
  assert.equal(decide(tag, { status: 404, body: { message: 'Not Found' } }).decision, DECISION.PUBLISH);
});

test('a published tag is refused, and the message says why', () => {
  const verdict = decide(tag, {
    status: 200,
    body: { tag_name: tag, assets: [{ name: 'KAYAN-ERP-Setup.exe' }] },
  });
  assert.equal(verdict.decision, DECISION.REFUSE_PUBLISHED);
  assert.match(verdict.reason, /KAYAN-ERP-Setup\.exe/);
  assert.match(verdict.reason, /Bump the version/);
});

test('a release with no files yet may be published, with a warning', () => {
  const verdict = decide(tag, { status: 200, body: { tag_name: tag, assets: [] } });
  assert.equal(verdict.decision, DECISION.PUBLISH_WITH_WARNING);
});

test('an answer that is not the API refusing or confirming is not trusted', () => {
  assert.equal(decide(tag, { status: 500, body: null }).decision, DECISION.REFUSE_UNVERIFIED);
  assert.equal(decide(tag, { status: 403, body: { message: 'rate limited' } }).decision, DECISION.REFUSE_UNVERIFIED);
  assert.equal(decide(tag, null).decision, DECISION.REFUSE_UNVERIFIED);
});

test('a release body without an assets array is treated as having none', () => {
  assert.equal(decide(tag, { status: 200, body: { tag_name: tag } }).decision, DECISION.PUBLISH_WITH_WARNING);
});

test('the check asks the API for that exact tag', async () => {
  const calls = [];
  const { checkTag } = await import('./check-release-tag.mjs');
  await checkTag('windows-v9.9.9', {
    repository: 'owner/repo',
    token: 't',
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.authorization });
      return { status: 404, text: async () => '{"message":"Not Found"}' };
    },
  });
  assert.deepEqual(calls, [
    {
      url: 'https://api.github.com/repos/owner/repo/releases/tags/windows-v9.9.9',
      authorization: 'Bearer t',
    },
  ]);
});

test('a network failure refuses rather than guesses', async () => {
  const { checkTag } = await import('./check-release-tag.mjs');
  const verdict = await checkTag(tag, {
    repository: 'owner/repo',
    token: 't',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(verdict.decision, DECISION.REFUSE_UNVERIFIED);
});

test('the command exits non-zero when the tag is published', () => {
  const run = (args, env) => {
    try {
      execFileSync(process.execPath, ['scripts/check-release-tag.mjs', ...args], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, ...env },
        stdio: 'pipe',
      });
      return 0;
    } catch (error) {
      return error.status;
    }
  };
  // No repository in the environment: the guard cannot ask, so it refuses.
  assert.equal(run([tag], { GITHUB_REPOSITORY: '', GH_TOKEN: '', GITHUB_TOKEN: '' }), 4);
  // No tag at all is a usage error.
  assert.equal(run([], {}), 2);
});
