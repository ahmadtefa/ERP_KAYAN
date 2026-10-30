import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifySyntheticProbe } from './verify-synthetic-inno-probe.mjs';

test('only the expected synthetic public key is accepted', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kayan-synthetic-probe-'));
  try {
    const root = join(base, 'extracted');
    await mkdir(join(root, 'app'), { recursive: true });
    const key = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    const expected = join(base, 'expected.pem');
    const extracted = join(root, 'app', 'public-key.pem');
    await writeFile(expected, key);
    await writeFile(extracted, key);
    await verifySyntheticProbe(root, expected);
    await writeFile(extracted, 'not a public key');
    await assert.rejects(verifySyntheticProbe(root, expected), /does not match/);
    await writeFile(extracted, key);
    await writeFile(join(root, 'app', 'unexpected.txt'), 'unexpected');
    await assert.rejects(verifySyntheticProbe(root, expected), /exactly app\/public-key.pem/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
