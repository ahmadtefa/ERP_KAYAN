import { Prisma } from '@prisma/client';
import { CompanySettingsService } from './company-settings.module';

const before = {
  companyId:'company',taxRate:new Prisma.Decimal(14),pricesIncludeTax:false,
  allowNegativeStock:false,inventoryValuation:'WEIGHTED_AVERAGE',approvalRequiredForJournal:false,
  segregationOfDuties:false,backupRetentionCount:10,backupIntervalHours:24,
  maxDiscountPercent:new Prisma.Decimal(100),showTaxIdOnQuotations:true,
  managerName:null,salesManagerName:null,salesManagerPhone:null,
};
function fixture() {
  const tx={companySetting:{findUnique:jest.fn().mockResolvedValue(before),
    upsert:jest.fn().mockResolvedValue({...before,managerName:'Synthetic manager'})},
    stockBalance:{count:jest.fn().mockResolvedValue(0)}};
  const prisma={$transaction:jest.fn(async (fn:(client:unknown)=>unknown)=>fn(tx))};
  const audit={recordRequired:jest.fn().mockResolvedValue(undefined)};
  return {tx,prisma,audit,service:new CompanySettingsService(prisma as any,audit as any)};
}
describe('company settings mandatory audit', () => {
  it('writes settings and audit through the same serializable transaction', async () => {
    const {tx,prisma,audit,service}=fixture();
    const result=await service.update('company','actor',{managerName:' Synthetic manager '});
    expect(result.managerName).toBe('Synthetic manager');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'});
    expect(tx.companySetting.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({managerName:'Synthetic manager'})}));
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({entity:'company_settings',action:'UPDATE'}),tx);
  });
  it('propagates audit failure instead of reporting success', async () => {
    const {audit,service}=fixture();
    audit.recordRequired.mockRejectedValueOnce(new Error('synthetic audit failure'));
    await expect(service.update('company','actor',{managerName:'Synthetic manager'})).rejects.toThrow('synthetic audit failure');
  });
});

describe('first read of a company with no settings row', () => {
  it('creates the defaults with one upsert (safe when two first requests arrive together), never a bare create', async () => {
    const created = { ...before };
    const client = { companySetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(created),
      create: jest.fn().mockRejectedValue(new Error('a bare create races: two first requests would collide')),
    } };
    const service = new CompanySettingsService({} as any, {} as any);
    const result = await service.get('company', client as any);
    expect(result.companyId).toBe('company');
    expect(client.companySetting.create).not.toHaveBeenCalled();
    expect(client.companySetting.upsert).toHaveBeenCalledWith({ where: { companyId: 'company' }, update: {}, create: { companyId: 'company' } });
  });
});
