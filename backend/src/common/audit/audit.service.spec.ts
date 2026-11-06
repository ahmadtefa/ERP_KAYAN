import { Logger } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('audit failure logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps best-effort failures visible without logging database details', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const prisma = {auditLog:{create:jest.fn().mockRejectedValue(
      new Error('SYNTHETIC_PRIVATE_DATABASE_DETAIL'),
    )}} as unknown as PrismaService;
    const service = new AuditService(prisma);
    await service.record({action:'UPDATE',entity:'test'});
    expect(log).toHaveBeenCalledWith('Failed to write an audit record');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DATABASE_DETAIL');
  });

  it('still propagates required audit errors to abort caller transactions', async () => {
    const tx = {auditLog:{create:jest.fn().mockRejectedValue(new Error('audit unavailable'))}};
    const service = new AuditService({} as PrismaService);
    await expect(service.recordRequired({action:'UPDATE',entity:'test'},tx as never))
      .rejects.toThrow('audit unavailable');
  });
});
