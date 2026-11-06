import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { signPayload, splitKey } from './license-key';
import { LicensingService } from './licensing.service';
import { expectCode, harness, MACHINE, PUBLIC_PEM } from './licensing.harness';

// Service-level model only: FakeDb, a fresh temporary state directory, and
// synthetic signing keys in memory. This is not an installed Windows upgrade.
describe('synthetic active licence across a service upgrade model', () => {
  it('preserves synthetic data on restart and rejects a forged renewal', async () => {
    const h = harness();
    try {
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      h.db.users.push({ id: 'synthetic-user', displayName: 'Synthetic Company' });
      const service = (version: string) => new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir,
        clock: () => new Date('2026-05-01T09:00:00.000Z'),
        appVersion: version,
        machineId: MACHINE,
        trustStore: h.store,
      });
      const initial = service('0.1.0-test');
      const before = await initial.activate(h.key({}));
      expect(before.state).toBe('ACTIVE');
      expect(before.blocked).toBe(false);
      const usersBefore = structuredClone(h.db.users);
      const installationBefore = structuredClone(h.db.installations);
      const renewedToken = h.key({ keyId: 'key_upgrade-renewal', type: 'RENEWAL', machineId: null,
        seats: null, term: { kind: 'MONTHS', months: 6 } });
      const wrong = generateKeyPairSync('ed25519');
      const forged = signPayload(splitKey(renewedToken).payload, wrong.privateKey);

      const restarted = service('0.2.0-test');
      const after = await restarted.status({ fresh: true });
      expect(after.state).toBe('ACTIVE');
      expect(after.blocked).toBe(false);
      expect(after.expiresAt).toBe(before.expiresAt);
      expect(h.db.users).toEqual(usersBefore);
      await expectCode(restarted.renew(forged), 'LICENSE_KEY_BAD_SIGNATURE');
      expect(h.db.installations).toEqual(installationBefore);
      expect(h.db.users).toEqual(usersBefore);
      const accepted = await restarted.renew(renewedToken);
      expect(accepted.state).toBe('ACTIVE');
      expect(accepted.expiresAt).not.toBe(before.expiresAt);
    } finally {
      h.dispose();
    }
  });
});
