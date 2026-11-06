import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Limited runtime checks: no keys, MACs, or signatures are created. This is
// not proof that native processes or WebCrypto cannot generate key material.
const guard = fileURLToPath(new URL('./ci-no-hmac.cjs', import.meta.url));

test('ordinary reviewed Node tests reject HMAC, symmetric keys and signing APIs before use', () => {
  const program = `
    const crypto = require('node:crypto');
    for (const name of ['createHmac', 'createSecretKey', 'generateKeyPair',
      'generateKeyPairSync', 'createPrivateKey', 'sign', 'createSign']) {
      let refused = false;
      try { crypto[name](); } catch (error) { refused = /CI policy forbids/.test(error.message); }
      if (!refused) throw new Error(name + ' was not refused by the preload');
    }
  `;
  const result = spawnSync(process.execPath, ['--require', guard, '-e', program], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('the guard still permits ordinary unkeyed hashing', () => {
  const result = spawnSync(process.execPath, ['--require', guard, '-e',
    "require('node:crypto').createHash('sha256').update('public').digest('hex')"], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
