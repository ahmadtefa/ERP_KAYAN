import { ConflictException } from '@nestjs/common';
import { SetupService } from './setup.service';

const dto = {
  companyCode: 'SYNTHETIC', companyNameEn: 'Synthetic', companyNameAr: 'تجريبي',
  adminUsername: 'synthetic-admin', adminPassword: 'synthetic-password',
  seedChartOfAccounts: false,
} as any;

function fixture(dormant: any[] = [], activeInside = 0) {
  let committed = false;
  const company = {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue(dormant),
    findFirst: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({ id: 'company', code: dto.companyCode, nameEn: dto.companyNameEn, nameAr: dto.companyNameAr }),
  };
  const txCompany = { ...company, count: jest.fn().mockResolvedValue(activeInside) };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1), company: txCompany,
    branch: { create: jest.fn().mockResolvedValue({ id: 'branch', code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' }) },
    warehouse: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'admin', username: dto.adminUsername }) },
    userRole: { create: jest.fn().mockResolvedValue({}) },
    userBranch: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    company,
    $transaction: jest.fn(async (fn: any) => { const result = await fn(tx); committed = true; return result; }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined), recordRequired: jest.fn().mockResolvedValue(undefined) };
  const licensing = { reserveSeat: jest.fn().mockResolvedValue({ reserved: true }) };
  const service = new SetupService(prisma as any, audit as any, licensing as any);
  jest.spyOn(service as any, 'seedPermissions').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'seedRoles').mockResolvedValue({ admin: 'role', accountant: 'accountant' });
  jest.spyOn(service as any, 'seedFiscalPeriod').mockResolvedValue(undefined);
  return { service, prisma, tx, audit, get committed() { return committed; } };
}

describe('first-run setup data safety', () => {
  it('never deletes dormant companies, even if setup finds ambiguous companies and fails', async () => {
    const dormant = [
      { id: 'empty-looking', code: 'OLD', _count: { users: 0, auditLogs: 0 } },
      { id: 'one', code: 'ONE', _count: { users: 1, auditLogs: 0 } },
      { id: 'two', code: 'TWO', _count: { users: 1, auditLogs: 0 } },
    ];
    const f = fixture(dormant);
    await expect(f.service.initialSetup(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.company.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.company.deleteMany).not.toHaveBeenCalled();
    expect(f.committed).toBe(false);
  });

  it('rechecks the active company under the transaction lock before any mutation', async () => {
    const f = fixture([], 1);
    await expect(f.service.initialSetup(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.$executeRaw).toHaveBeenCalled();
    expect(f.tx.company.create).not.toHaveBeenCalled();
    expect(f.committed).toBe(false);
  });

  it('refuses to reuse a dormant company code rather than deleting history', async () => {
    const f = fixture([{ id: 'history', code: dto.companyCode, _count: { users: 0, auditLogs: 0 } }]);
    f.tx.company.findFirst.mockResolvedValueOnce({ id: 'history' });
    await expect(f.service.initialSetup(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.company.create).not.toHaveBeenCalled();
    expect(f.tx.company.deleteMany).not.toHaveBeenCalled();
    expect(f.committed).toBe(false);
  });

  it('rolls back setup if its required audit fails', async () => {
    const f = fixture();
    f.audit.recordRequired.mockRejectedValueOnce(new Error('synthetic audit failure'));
    await expect(f.service.initialSetup(dto)).rejects.toThrow('synthetic audit failure');
    expect(f.audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({ entity: 'companies', action: 'CREATE' }), f.tx);
    expect(f.committed).toBe(false);
  });
});
