import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';

import { LicenseStore } from './license-store';
import { FakeDb, expectCode } from './licensing.harness';
import { LicensingService } from './licensing.service';

const generatorHome = process.env.KAYAN_LICENSE_INTEGRATION_HOME;
const testIfGenerator = generatorHome ? it : it.skip;

testIfGenerator('accepts a locally issued new-key activation and rejects a changed signature', async () => {
  const root = resolve(__dirname, '../../../../');
  const legacy = readFileSync(join(root, 'distribution/windows/public-key.pem'), 'utf8');
  const next = readFileSync(join(root, 'distribution/windows/public-key-next.pem'), 'utf8');
  const supplier = readFileSync(join(generatorHome!, 'public-key.pem'), 'utf8');
  expect(createPublicKey(supplier).export({ type: 'spki', format: 'der' }))
    .toEqual(createPublicKey(next).export({ type: 'spki', format: 'der' }));
  const script = join(root, 'tools/license-generator/kayan-license.mjs');
  const run = (...args: string[]) => execFileSync(process.execPath, [script, ...args, '--home', generatorHome!], { encoding: 'utf8' });
  const created = run('licence', 'create', '--ref', `integration-${Date.now()}`, '--seats', '2', '--term', '1y');
  const licence = created.match(/lic_[A-Za-z0-9_-]+/)?.[0];
  expect(licence).toBeDefined();
  const machine = 'KM-AAAA-BBBB-CCCC-DDDD-EEEE';
  const issued = run('issue', 'activation', '--licence', licence!, '--machine', machine);
  const key = issued.match(/KYN1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  expect(key).toBeDefined();

  const dir = mkdtempSync(join(tmpdir(), 'kayan-real-keyring-'));
  try {
    writeFileSync(join(dir, 'public-key.pem'), legacy);
    writeFileSync(join(dir, 'public-key-next.pem'), next);
    writeFileSync(join(dir, 'keyring.required'), 'required');
    const now = new Date();
    const db = new FakeDb(() => now);
    const service = new LicensingService(db as never, {} as never, {
      installedDirectory: dir, machineId: machine, clock: () => now,
      trustStore: new LicenseStore(dir),
    });
    const parts = key!.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    const bad = parts.join('.');
    await expectCode(service.activate(bad), 'LICENSE_KEY_BAD_SIGNATURE');
    expect((await service.activate(key!)).state).toBe('ACTIVE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
