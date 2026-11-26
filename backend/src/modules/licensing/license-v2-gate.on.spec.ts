import { activation, harness } from './licensing.harness';
import { LicensingService } from './licensing.service';
import { MACHINE, PUBLIC_PEM } from './licensing.harness';

jest.mock('./license-v2-gate', () => ({ LICENSE_V2_BUILD: true }));

// Test-only override of the build constant. It shows what a build with the
// gate set does while the v2 adapter does not exist: refuse and enforce.
describe('v2 gate set to true without an adapter', () => {
  it('refuses with LICENSE_V2_UNAVAILABLE, keeps enforcement on, and never opens the v1 store', async () => {
    const h = harness();
    try {
      const svc = new LicensingService(h.db as any, {} as any, {
        directory: h.dir, installedDirectory: null, publicKeyText: PUBLIC_PEM, enforcement: 'warn',
        machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await svc.onModuleInit().catch(() => undefined);
      await expect(svc.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_V2_UNAVAILABLE' }),
      });
      expect(svc.isEnforced()).toBe(true);
      expect(h.db.installations).toHaveLength(0);
      void activation;
    } finally { h.dispose(); }
  });
});
