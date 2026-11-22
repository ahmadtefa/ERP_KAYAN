import { ServiceUnavailableException } from '@nestjs/common';

import { CompleteRestoreUnavailableGuard } from './complete-restore-unavailable.guard';
import type { RestoreGateReport } from './restore-gate.service';

function gate(report: Partial<RestoreGateReport>) {
  return { probe: async () => ({ ...report }) } as never;
}

describe('CompleteRestoreUnavailableGuard', () => {
  it('lets a restore through only when every safeguard passed', async () => {
    const guard = new CompleteRestoreUnavailableGuard(
      gate({ fullRestoreSupported: true, state: 'ready', reasons: [], checks: [] }),
    );
    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('refuses with the named reasons when a safeguard is missing', async () => {
    const guard = new CompleteRestoreUnavailableGuard(
      gate({
        fullRestoreSupported: false,
        state: 'blocked',
        reasons: ['pg_dump and pg_restore were not found on this machine'],
        checks: [{ name: 'postgresql-tools', ok: false, detail: 'not found' }],
      }),
    );
    await expect(guard.canActivate()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(guard.canActivate()).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FULL_RESTORE_UNAVAILABLE',
        reasons: ['pg_dump and pg_restore were not found on this machine'],
      }),
    });
  });

  it('cannot be talked past by a caller: the answer comes from the machine', async () => {
    const guard = new CompleteRestoreUnavailableGuard(
      gate({ fullRestoreSupported: false, state: 'disabled', reasons: ['switched off'], checks: [] }),
    );
    // There is no argument to pass: canActivate takes the execution context
    // and ignores it. The refusal is a property of the installation.
    await expect(guard.canActivate()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
