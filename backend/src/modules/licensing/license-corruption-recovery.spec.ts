import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activation, FakeDb, harness, MACHINE, PUBLIC_PEM } from './licensing.harness';
import { LicensingService } from './licensing.service';

/**
 * Runtime recovery from a corrupted on-disk licence state.
 *
 * `license-store.spec.ts` proves the store *detects* the three corruption
 * shapes (garbage JSON, missing MAC, wrong MAC). These tests prove the
 * service-level behaviour that detection is supposed to trigger: the bad
 * file remains untouched, no new state is created, and business operations
 * fail closed even in warn mode while database-side counters remain intact.
 * This is still a Node-level test: the equivalent Windows
 * installer/RepairTool path cannot be exercised on this Linux sandbox.
 */
describe('LicensingService corrupted-state recovery', () => {
  let h: ReturnType<typeof harness>;
  let corruptDir: string;

  beforeEach(async () => {
    h = harness({ enforcement: 'warn' });
    await activation(h);
    corruptDir = mkdtempSync(join(tmpdir(), 'kayan-corrupt-license-'));
  });

  afterEach(() => {
    h.dispose();
    rmSync(corruptDir, { recursive: true, force: true });
  });

  const recoveryService = (db: FakeDb, directory: string) =>
    new LicensingService(
      db as never,
      {} as never,
      {
        directory,
        publicKeyText: PUBLIC_PEM,
        enforcement: 'warn',
        machineId: MACHINE,
      },
    );

  it.each([
    ['unreadable JSON', 'this is not json at all'],
    ['state without a MAC', JSON.stringify({ state: { v: 1 } })],
    ['state with a wrong MAC', JSON.stringify({ state: { v: 1 }, mac: 'deadbeef' })],
  ])('preserves %s, blocks operations, and keeps database counters', async (_label, body) => {
    const statePath = join(corruptDir, 'license-state.json');
    writeFileSync(statePath, body, 'utf8');

    const installationIdsBefore = h.db.installations.map((row) => row.id);
    expect(installationIdsBefore.length).toBeGreaterThan(0);
    const seatsBefore = h.db.seats.length;

    const service = recoveryService(h.db, corruptDir);
    await expect(service.status({ fresh: true })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
    });
    expect(service.isEnforced()).toBe(true);
    expect(existsSync(statePath)).toBe(true);
    expect(readFileSync(statePath, 'utf8')).toBe(body);
    expect(existsSync(join(corruptDir, 'state.key'))).toBe(false);
    expect(readdirSync(corruptDir)).toEqual(['license-state.json']);

    // Database-side counters survived untouched.
    expect(h.db.installations.map((row) => row.id)).toEqual(installationIdsBefore);
    expect(h.db.seats).toHaveLength(seatsBefore);
  });

  it('does not quarantine an intact signed state file', async () => {
    const service = recoveryService(h.db, corruptDir);
    await service.status({ fresh: true }); // first run creates a valid store
    const firstRunFiles = readdirSync(corruptDir);
    expect(firstRunFiles.filter((n) => n.startsWith('license-state.quarantined-'))).toHaveLength(0);

    await service.status({ fresh: true }); // second run must accept it
    const secondRunFiles = readdirSync(corruptDir);
    expect(secondRunFiles.filter((n) => n.startsWith('license-state.quarantined-'))).toHaveLength(0);
  });
});
