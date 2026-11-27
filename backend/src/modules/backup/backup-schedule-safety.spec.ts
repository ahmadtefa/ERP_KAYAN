import { Logger } from '@nestjs/common';
import { BackupScheduleService } from './backup-schedule.service';
import { MaintenanceService } from '../../common/maintenance/maintenance';

describe('scheduled backup safety', () => {
  const company = { id: 'company', code: 'synthetic', nameEn: 'synthetic' };
  const marker = 'synthetic-private-marker';
  function setup() {
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([company]) },
      backupRun: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'run' }) },
    };
    const full = {
      assertNoRestoreRunning: jest.fn().mockRejectedValue(new Error('retention paused')),
    };
    const complete = {
      capabilities: jest.fn().mockResolvedValue({ available: true }),
      createFull: jest.fn().mockResolvedValue({ file: { name: 'new.kayanbackup', sizeBytes: 10 } }),
      verify: jest.fn().mockResolvedValue({ ok: true }),
      pathOf: jest.fn().mockReturnValue('/nonexistent/new.kayanbackup'),
      list: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
    };
    const destinations = { get: jest.fn().mockResolvedValue({ path: null, startHour: 2 }) };
    const settings = { get: jest.fn().mockResolvedValue({ backupIntervalHours: 1, backupRetentionCount: 1 }) };
    const maintenance = new MaintenanceService();
    const service = new BackupScheduleService(prisma as never, full as never, settings as never, maintenance, complete as never, destinations as never);
    const prune = jest.spyOn(service, 'pruneRetention').mockResolvedValue([]);
    return { prisma, full, complete, destinations, settings, service, prune, maintenance };
  }
  afterEach(() => jest.restoreAllMocks());

  it('drains an active timer tick and does not admit a new one during maintenance', async () => {
    const { prisma, service, maintenance } = setup();
    let finish!: (value: Array<typeof company>) => void;
    prisma.company.findMany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const tick = (service as unknown as { tick(): Promise<void> }).tick();
    maintenance.begin('restore');
    let drained = false;
    const wait = maintenance.waitForBusinessRequests().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(prisma.company.findMany).toHaveBeenCalledTimes(1);
    finish([]);
    await tick;
    await wait;
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(prisma.company.findMany).toHaveBeenCalledTimes(1);
  });

  it('records a verified complete backup as SUCCESS and then applies retention', async () => {
    const { service, prune, prisma } = setup();
    const [result] = await service.runNow('company');
    expect(result.status).toBe('SUCCESS');
    expect(result.fileName).toBe('new.kayanbackup');
    expect(prisma.backupRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUCCESS', fileName: 'new.kayanbackup' }) }));
    expect(prune).toHaveBeenCalledWith(1, 'run', null);
  });

  it('a backup that fails verification stays FAILED and never prunes', async () => {
    const { service, complete, prune } = setup();
    complete.verify.mockResolvedValue({ ok: false });
    const [result] = await service.runNow('company');
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('احتُفظ بالنسخ السابقة');
    expect(prune).not.toHaveBeenCalled();
    expect(complete.remove).not.toHaveBeenCalled();
  });

  it('records a creation failure without exposing details or deleting old backups', async () => {
    const { service, complete, prisma, prune } = setup();
    complete.createFull.mockRejectedValue(new Error(marker));
    const [result] = await service.runNow('company');
    expect(result).toMatchObject({ fileName: '-', status: 'FAILED' });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(prisma.backupRun.create.mock.calls, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v)).not.toContain(marker);
    expect(prune).not.toHaveBeenCalled();
    expect(complete.remove).not.toHaveBeenCalled();
  });

  it('an unreachable chosen folder makes the run FAILED, keeps the local copy, no pruning', async () => {
    const { service, destinations, prune, complete } = setup();
    destinations.get.mockResolvedValue({ path: '/nonexistent-drive/backups', startHour: 2 });
    const [result] = await service.runNow('company');
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('المجلد المختار');
    expect(prune).not.toHaveBeenCalled();
    expect(complete.remove).not.toHaveBeenCalled();
  });

  it('records a failed capability probe without leaking details', async () => {
    const { service, complete, prisma } = setup();
    complete.capabilities.mockRejectedValue(new Error(marker));
    const [result] = await service.runNow('company');
    expect(result).toMatchObject({ fileName: '-', status: 'FAILED' });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(prisma.backupRun.create).toHaveBeenCalled();
    expect(complete.createFull).not.toHaveBeenCalled();
  });

  it('a daily-or-longer schedule waits for the chosen hour; hourly ignores it', async () => {
    const { service, complete, prisma, destinations, settings } = setup();
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    prisma.backupRun.findFirst.mockResolvedValue({ createdAt: old, status: 'SUCCESS', fileName: 'x' });
    settings.get.mockResolvedValue({ backupIntervalHours: 168, backupRetentionCount: 5 });
    destinations.get.mockResolvedValue({ path: null, startHour: 24 });
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(complete.createFull).not.toHaveBeenCalled();
    destinations.get.mockResolvedValue({ path: null, startHour: 0 });
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(complete.createFull).toHaveBeenCalledTimes(1);
  });

  it('backs off after a failed attempt, but an explicit retry still works', async () => {
    const { service, complete, prisma } = setup();
    prisma.backupRun.findFirst.mockResolvedValue({ createdAt: new Date(), status: 'FAILED', fileName: 'x' });
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(complete.createFull).not.toHaveBeenCalled();
    await service.runNow('company');
    expect(complete.createFull).toHaveBeenCalledTimes(1);
  });

  it('retention removes only older full copies this program recorded as good, and keeps the newest', async () => {
    const { service, complete, prisma, prune } = setup();
    prune.mockRestore();
    (service as unknown as { full: { assertNoRestoreRunning: jest.Mock } }).full.assertNoRestoreRunning.mockResolvedValue(undefined);
    const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
    complete.list.mockResolvedValue([
      { name: 'c.kayanbackup', createdAt: day(3), kind: 'full' },
      { name: 'b.kayanbackup', createdAt: day(2), kind: 'full' },
      { name: 'a.kayanbackup', createdAt: day(1), kind: 'full' },
      { name: 's.kayanbackup', createdAt: day(1), kind: 'safety' },
    ]);
    prisma.backupRun.findFirst.mockImplementation(({ where }: { where: { fileName: string } }) =>
      Promise.resolve(where.fileName === 'a.kayanbackup' ? { id: 'ra' } : null));
    const removed = await service.pruneRetention(2);
    expect(removed).toEqual(['a.kayanbackup']);
    expect(complete.remove).toHaveBeenCalledWith('a.kayanbackup', null);
  });

  it('refuses manual retention before listing or removing any file', async () => {
    const { service, prune, complete } = setup();
    prune.mockRestore();
    await expect(service.pruneRetention(1)).rejects.toThrow('retention paused');
    expect(complete.list).not.toHaveBeenCalled();
    expect(complete.remove).not.toHaveBeenCalled();
  });

  it('does not log raw scheduled-backup errors', async () => {
    const { service, complete } = setup();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    complete.createFull.mockRejectedValueOnce(new Error(marker));
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(marker);
  });
});
