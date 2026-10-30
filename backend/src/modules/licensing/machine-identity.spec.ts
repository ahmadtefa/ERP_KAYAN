import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  chooseMachineIdentity,
  LicensingService,
  machineIdentity,
} from './licensing.service';
import { PUBLIC_PEM } from './licensing.harness';

/**
 * The licence is bound to this computer, so "who is this computer" has to be a
 * stable answer. These tests cover the difference between a *real* change of
 * hardware (the machine GUID changed: report it, the licence really does not
 * belong here any more) and a *temporary* loss of a weaker signal (a registry
 * read fails, an adapter is disabled: keep the recorded identity, or a valid
 * licence would be destroyed by a reboot).
 */
describe('machine identity for licensing', () => {
  it('keeps the recorded identity when only a weaker source is available', () => {
    const choice = chooseMachineIdentity('KM-AAAA-BBBB-CCCC', {
      id: 'KM-ZZZZ-YYYY-XXXX',
      source: 'host-mac',
    });
    expect(choice).toEqual({ id: 'KM-AAAA-BBBB-CCCC', reusedRecorded: true });
  });

  it('reports a changed machine GUID instead of hiding it', () => {
    const choice = chooseMachineIdentity('KM-AAAA-BBBB-CCCC', {
      id: 'KM-ZZZZ-YYYY-XXXX',
      source: 'machine-guid',
    });
    // A different machine GUID is a different computer. Silently keeping the
    // old identity would let a licence appear to follow the hardware.
    expect(choice).toEqual({ id: 'KM-ZZZZ-YYYY-XXXX', reusedRecorded: false });
  });

  it('uses the resolved identity when nothing was recorded', () => {
    expect(
      chooseMachineIdentity(null, { id: 'KM-ZZZZ-YYYY-XXXX', source: 'host-mac' }),
    ).toEqual({ id: 'KM-ZZZZ-YYYY-XXXX', reusedRecorded: false });
  });

  it('derives a stable, well-printed identity on this machine', () => {
    const first = machineIdentity();
    const second = machineIdentity();
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^KM(-[A-Z0-9]{4}){5}$/);
    expect(['machine-guid', 'host-mac']).toContain(first.source);
  });

  it('records the identity once and reuses it across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-machine-id-'));
    const make = () =>
      new LicensingService({} as never, {} as never, {
        directory: dir,
        publicKeyText: PUBLIC_PEM,
        enforcement: 'warn',
      });
    try {
      const first = make().machineId();
      expect(readFileSync(join(dir, 'machine-id'), 'utf8').trim()).toBe(first);

      // A new process, as after a reboot: it reads what was recorded instead
      // of deriving a fresh identity, so a licence issued for this machine
      // stays valid.
      const restarted = make();
      expect(restarted.machineId()).toBe(first);
      expect(restarted.machineId()).toBe(first); // and stays cheap to ask
      expect(readFileSync(join(dir, 'machine-id'), 'utf8').trim()).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a corrupted identity file rather than trusting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-machine-id-'));
    try {
      writeFileSync(join(dir, 'machine-id'), 'not a machine id\n');
      const service = new LicensingService({} as never, {} as never, {
        directory: dir,
        publicKeyText: PUBLIC_PEM,
        enforcement: 'warn',
      });
      const id = service.machineId();
      expect(id).toMatch(/^KM(-[A-Z0-9]{4}){5}$/);
      expect(readFileSync(join(dir, 'machine-id'), 'utf8').trim()).toBe(id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
