import { BadRequestException } from '@nestjs/common';
import { PeriodStatus } from '@prisma/client';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

describe('fiscal period locking and range validation', () => {
  const original = {
    id:'one', companyId:'company', code:'2026', nameEn:'Year', nameAr:'سنة',
    startDate:new Date('2026-01-01T00:00:00Z'), endDate:new Date('2026-12-31T00:00:00Z'),
    status:PeriodStatus.OPEN, closedAt:null,
  };
  function setup() {
    const periods = [original, {...original,id:'two',code:'2027',
      startDate:new Date('2027-01-01T00:00:00Z'),endDate:new Date('2027-12-31T00:00:00Z')}];
    const fp = {
      findFirst: jest.fn(async ({where}:any) => periods.find(p => {
        if (p.companyId !== where.companyId) return false;
        if (typeof where.id === 'string' && p.id !== where.id) return false;
        if (where.id?.not === p.id) return false;
        if (where.code && p.code !== where.code) return false;
        if (where.startDate && p.startDate > where.startDate.lte) return false;
        if (where.endDate && p.endDate < where.endDate.gte) return false;
        return true;
      }) ?? null),
      create: jest.fn(async ({data}:any) => ({...data,id:'created',closedAt:null})),
      update: jest.fn(async ({where,data}:any) => ({...periods.find(p => p.id === where.id),...data})),
    };
    const tx = {$queryRaw:jest.fn().mockResolvedValue([]),fiscalPeriod:fp,
      journalEntry:{count:jest.fn().mockResolvedValue(0)},
      salesInvoice:{count:jest.fn().mockResolvedValue(0)},purchaseInvoice:{count:jest.fn().mockResolvedValue(0)},
      cashVoucher:{count:jest.fn().mockResolvedValue(0)},cashTransfer:{count:jest.fn().mockResolvedValue(0)},
      stockDocument:{count:jest.fn().mockResolvedValue(0)},openingBalance:{count:jest.fn().mockResolvedValue(0)}};
    const prisma = {$transaction:jest.fn(async (fn:any) => fn(tx))} as unknown as PrismaService;
    const audit = {recordRequired:jest.fn().mockResolvedValue(undefined)} as unknown as AuditService;
    return {service:new FiscalPeriodsService(prisma,audit),tx,audit,periods};
  }
  it('refuses an overlapping new range after taking a company range lock', async () => {
    const {service,tx} = setup();
    await expect(service.create('company','user',{code:'new',nameEn:'New',nameAr:'جديد',
      startDate:'2026-12-01',endDate:'2027-01-31'})).rejects.toThrow(/overlaps/);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.fiscalPeriod.create).not.toHaveBeenCalled();
  });
  it('refuses an overlapping edit after taking both locks', async () => {
    const {service,tx} = setup();
    await expect(service.update('company','user','one',{endDate:'2027-01-01'})).rejects.toThrow(/overlaps/);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.fiscalPeriod.update).not.toHaveBeenCalled();
  });
  it('checks closed status after locking and cannot edit a closed period', async () => {
    const {service,tx,periods} = setup();
    periods[0] = {...original,status:PeriodStatus.CLOSED};
    await expect(service.update('company','user','one',{nameEn:'x'})).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.fiscalPeriod.update).not.toHaveBeenCalled();
  });
  it('blocks unposted cash transfers when closing a period', async () => {
    const {service,tx} = setup();
    tx.cashTransfer.count.mockResolvedValue(1);
    await expect(service.close('company','user','one')).rejects.toThrow(/draft document/);
    expect(tx.fiscalPeriod.update).not.toHaveBeenCalled();
  });
  it('makes the close audit part of the same transaction', async () => {
    const {service,tx,audit} = setup();
    await service.close('company','user','one');
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({action:'fiscal_period.close'}),tx);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
