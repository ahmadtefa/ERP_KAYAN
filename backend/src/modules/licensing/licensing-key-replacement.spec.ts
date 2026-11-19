import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LicensingService } from './licensing.service';
import { harness, MACHINE, PUBLIC_PEM } from './licensing.harness';

/**
 * The only files touched here are in the harness's fresh temporary directory;
 * the database is FakeDb and both signing pairs are synthetic. This models a
 * restarted service after Setup replaces its public key. It does not run the
 * Windows installer or prove compatibility of a real customer installation.
 */
describe('an activated licence when the installed public key changes', () => {
  it('blocks a changed verifier without rewriting its fingerprint and allows renewal after restoration', async () => {
    const h = harness();
    try {
      const publicFile = join(h.dir, 'public-key.pem');
      writeFileSync(publicFile, PUBLIC_PEM);
      const now = new Date('2026-05-01T09:00:00.000Z');
      const service = () => new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir,
        clock: () => now,
        appVersion: '0.1.0-test',
        machineId: MACHINE,
        trustStore: h.store,
      });

      const initial = service();
      const activated = await initial.activate(h.key({}));
      expect(activated.state).toBe('ACTIVE');
      expect(activated.blocked).toBe(false);
      const oldRenewal = h.key({
        keyId: 'key_old-renewal',
        type: 'RENEWAL',
        machineId: null,
        seats: null,
        term: { kind: 'MONTHS', months: 6 },
      });

      const originalFingerprint = h.store.current.publicKeyFingerprint;
      const replacement = generateKeyPairSync('ed25519');
      writeFileSync(publicFile, replacement.publicKey.export({ type: 'spki', format: 'pem' }));
      const afterUpdate = service();
      const stillActive = await afterUpdate.status({ fresh: true });
      expect(stillActive.state).toBe('ACTIVE');
      expect(stillActive.blocked).toBe(true);
      expect(stillActive.configured).toBe(false);
      expect(stillActive.expiresAt).toBe(activated.expiresAt);
      expect(stillActive.publicKeyFingerprint).toBeNull();
      expect(h.store.current.publicKeyFingerprint).toBe(originalFingerprint);
      await expect(afterUpdate.renew(oldRenewal)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_PUBLIC_KEY_MISSING' }),
      });

      // Restoring the old public key in this isolated model makes the same
      // unspent renewal verifiable again. No customer state is involved.
      writeFileSync(publicFile, PUBLIC_PEM);
      const restored = service();
      const renewed = await restored.renew(oldRenewal);
      expect(renewed.state).toBe('ACTIVE');
      expect(renewed.expiresAt).not.toBe(activated.expiresAt);
    } finally {
      h.dispose();
    }
  });
});
