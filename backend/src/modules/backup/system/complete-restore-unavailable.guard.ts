import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { RestoreGateService } from './restore-gate.service';

/**
 * The safety gate in front of every destructive restore, as a Nest guard.
 *
 * It runs before the request body is parsed, so a 2 GB upload is refused
 * before it is read from the network when the machine cannot restore it
 * anyway. The guard is deliberately still here: the answer is not "restores
 * are switched off forever", it is "restores are available only where the
 * checks pass and the safeguards are in place". Nothing a caller sends can
 * change that answer — only the state of the machine can.
 */
@Injectable()
export class CompleteRestoreUnavailableGuard implements CanActivate {
  constructor(private readonly gate: RestoreGateService) {}

  async canActivate(): Promise<boolean> {
    const report = await this.gate.probe();
    if (report.fullRestoreSupported) return true;
    throw new ServiceUnavailableException({
      code: 'FULL_RESTORE_UNAVAILABLE',
      message:
        'الاستعادة الكاملة متوقفة على هذا الجهاز حتى تكتمل ضمانات الأمان. / ' +
        'Full restore is unavailable on this machine until every safeguard is in place.',
      detail: report.reasons.join('; '),
      reasons: report.reasons,
      checks: report.checks,
    });
  }
}
