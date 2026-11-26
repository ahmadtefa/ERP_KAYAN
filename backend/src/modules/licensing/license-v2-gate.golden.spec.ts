import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LicenseStore } from './license-store';
import { LicensingService } from './licensing.service';
import { LICENSE_V2_BUILD } from './license-v2-gate';
import { canonical, mac } from './license-state-v2.prototype';
import { MACHINE, PUBLIC_PEM, activation, harness, renewal, seatsKey } from './licensing.harness';

// S1 evidence (development only, synthetic keys and FakeDb). The v1 licence
// state after a fixed activation / renewal / seats / clock scenario must stay
// exactly what it was before the v2 gate existed. installId and mac are random
// per run and are checked for shape, not value. Everything else is compared to
// a golden captured from the code BEFORE the gate was added.
const GOLDEN = join(__dirname, 'license-v2-gate.golden.json');

async function scenario() {
  const h = harness();
  try {
    await activation(h);
    h.setNow('2026-05-02T09:00:00.000Z');
    await h.service.status({ fresh: true });
    await renewal(h);
    await seatsKey(h);
    h.setNow('2026-05-03T09:00:00.000Z');
    await h.service.status({ fresh: true });
    const doc = JSON.parse(readFileSync(join(h.dir, 'license-state.json'), 'utf8'));
    const { installId, publicKeyFingerprint, ...rest } = doc.state;
    expect(typeof installId).toBe('string');
    expect(publicKeyFingerprint).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);   // harness key pair is random per run
    const state = rest;
    expect(doc.mac).toMatch(/^[0-9a-f]{64}$/);
    return { state, topLevelKeys: Object.keys(doc).sort(), stateKeys: Object.keys(doc.state).sort() };
  } finally {
    h.dispose();
  }
}

describe('v2 gate: v1 state golden comparison', () => {
  it('the v1 state after the scenario equals the golden', async () => {
    const got = await scenario();
    if (process.env.WRITE_GOLDEN === '1') writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(got).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });
});

describe('v2 gate: default OFF', () => {
  it('the constant is a literal false and nothing reads it from the environment', () => {
    expect(LICENSE_V2_BUILD).toBe(false);
    const src = readFileSync(join(__dirname, 'license-v2-gate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src.trim()).toBe('export const LICENSE_V2_BUILD = false;');
    // Only the gate file may define it; the service only imports it.
    for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))) {
      const text = readFileSync(join(__dirname, f), 'utf8');
      expect(text).not.toMatch(/process\.env\.[A-Z_]*V2/);
    }
  });

  it('flag off + a v2 file present: the service refuses with LICENSE_STATE_DAMAGED and writes nothing', async () => {
    const h = harness();
    try {
      await activation(h);
      const path = join(h.dir, 'license-state.json');
      const keyPath = join(h.dir, 'state.key');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      const secret = createHash('sha256').update(readFileSync(keyPath, 'utf8').trim()).digest();
      const v2 = { ...doc.state, v: 2, legacyLicenseId: doc.state.licenseId, licenses: { [doc.state.licenseId]: { companyId: 'company-1', companyRef: null } } };
      void canonical;
      const body = JSON.stringify({ state: v2, mac: mac(secret, v2) });
      writeFileSync(path, body);
      const keyBytes = readFileSync(keyPath);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-04T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      expect(installed.isEnforced()).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(body);
      expect(readFileSync(keyPath).equals(keyBytes)).toBe(true);
      void LicenseStore;
    } finally {
      h.dispose();
    }
  });
});
