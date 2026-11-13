import { Logger } from '@nestjs/common';
import { BackupScheduleService } from './backup-schedule.service';

describe('scheduled backup safety', () => {
  const company = { id: 'company', code: 'synthetic', nameEn: 'synthetic' };
  const marker = 'synthetic-private-marker';
  function setup() {
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([company]) },
      backupRun: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'run' }) },
    };
    const full = {
      capabilities: jest.fn().mockResolvedValue({ available: true }),
      createFull: jest.fn().mockResolvedValue({ file: { name: 'new.dump' } }),
      verify: jest.fn().mockResolvedValue({ entries: 1 }),
      list: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
      assertDeletionSafe: jest.fn().mockRejectedValue(new Error('retention paused')),
    };
    const settings = { get: jest.fn().mockResolvedValue({ backupIntervalHours: 1, backupRetentionCount: 1 }) };
    const service = new BackupScheduleService(prisma as any, full as any, settings as any);
    const prune = jest.spyOn(service, 'pruneRetention').mockResolvedValue([]);
    return { prisma, full, service, prune };
  }
  afterEach(() => jest.restoreAllMocks());

  it('never prunes automatically when verification fails or records raw error details', async () => {
    const { service, full, prisma, prune } = setup();
    full.verify.mockRejectedValue(new Error(marker));
    const result = await service.runNow('company');
    expect(result[0].status).toBe('FAILED');
    expect(result[0].message).toContain('فشل إنشاء أرشيف قاعدة البيانات');
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(prisma.backupRun.create.mock.calls, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(marker);
    expect(prune).not.toHaveBeenCalled();
    expect(full.remove).not.toHaveBeenCalled();
  });

  it('retains previous backups even after archive content is readable', async () => {
    const { service, prune, full } = setup();
    const result = await service.runNow('company');
    expect(result[0].status).toBe('FAILED');
    expect(result[0].fileName).toBe('new.dump');
    expect(result[0].message).toContain('الملفات والترخيص والاستعادة الكاملة لم يتم التحقق منها');
    expect(result[0].message).toContain('احتُفظ بالنسخ السابقة');
    expect(prune).not.toHaveBeenCalled();
    expect(full.remove).not.toHaveBeenCalled();
  });

  it('records dump creation failure without exposing tool details or deleting old backups', async () => {
    const { service, full, prisma, prune } = setup();
    full.createFull.mockRejectedValue(new Error(marker));
    const [result] = await service.runNow('company');
    expect(result).toMatchObject({fileName:'-', status:'FAILED'});
    expect(result.message).toContain('فشل إنشاء أرشيف قاعدة البيانات');
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(prisma.backupRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data:expect.objectContaining({fileName:'-',status:'FAILED',companyId:'company'})}));
    expect(prune).not.toHaveBeenCalled();
    expect(full.remove).not.toHaveBeenCalled();
  });

  it('records a failed capability probe without leaking details', async () => {
    const { service, full, prisma } = setup();
    full.capabilities.mockRejectedValue(new Error(marker));
    const [result] = await service.runNow('company');
    expect(result).toMatchObject({fileName:'-',status:'FAILED'});
    expect(result.message).toContain('أدوات قاعدة البيانات غير متاحة');
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(prisma.backupRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data:expect.objectContaining({fileName:'-',status:'FAILED'})}));
    expect(full.createFull).not.toHaveBeenCalled();
  });

  it('backs off after a failed or incomplete attempt, but an explicit retry still works', async () => {
    const { service, full, prisma } = setup();
    prisma.backupRun.findFirst.mockResolvedValue({createdAt:new Date(),status:'FAILED',fileName:'new.dump'});
    await (service as any).tick();
    expect(full.createFull).not.toHaveBeenCalled();
    const [result] = await service.runNow('company');
    expect(result.status).toBe('FAILED');
    expect(full.createFull).toHaveBeenCalledTimes(1);
    expect(prisma.backupRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where:{kind:'SCHEDULED',status:{in:['SUCCESS','VERIFIED','FAILED']}}}));
  });

  it('refuses manual retention before listing or removing any file', async () => {
    const { service, prune, full } = setup();
    prune.mockRestore();
    await expect(service.pruneRetention(1)).rejects.toThrow('retention paused');
    expect(full.list).not.toHaveBeenCalled();
    expect(full.remove).not.toHaveBeenCalled();
  });

  it('does not log raw scheduled-backup or retention errors', async () => {
    const { service, full, prune } = setup();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warningLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    full.createFull.mockRejectedValueOnce(new Error(marker));
    await (service as any).tick();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(marker);
    await service.runNow('company');
    expect(prune).not.toHaveBeenCalled();
    expect(JSON.stringify(warningLog.mock.calls)).not.toContain(marker);
  });
});
