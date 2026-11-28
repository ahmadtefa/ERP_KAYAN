import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { ContractsService } from './contracts.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const BOSS = '33333333-3333-4333-8333-333333333334';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const SERVICE = 'e0000000-0000-4000-8000-000000000001';
const STOCK = 'e0000000-0000-4000-8000-000000000002';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Contracts and progress claims against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('contracts and progress claims (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let svc: ContractsService;
  let invoiceCalls: any[] = [];
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','cm','Cm','ش','x',now()), ('${BOSS}','${COMPANY}','boss','Boss','م','x',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','Customer','عميل',now())`);
    await run(`INSERT INTO items(id,"companyId",code,"nameEn","nameAr","isStockTracked","updatedAt") VALUES ('${SERVICE}','${COMPANY}','SRV','Works','أعمال',false,now()), ('${STOCK}','${COMPANY}','STK','Goods','بضاعة',true,now())`);
    const audit = { record: async () => {}, recordRequired: async () => {} };
    // The sales invoice service has its own specs; here it is replaced by one that stores a draft row.
    const invoices = {
      create: async (_c: string, _b: string, _u: string, dto: any) => {
        invoiceCalls.push(dto);
        const id = `d0000000-0000-4000-8000-0000000000${String(invoiceCalls.length).padStart(2, '0')}`;
        const total = Number(dto.lines[0].unitPrice);
        await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
          VALUES ('${id}','${COMPANY}','${BRANCH}','SI-${invoiceCalls.length}','${dto.invoiceDate}','${dto.customerId}',now(),'DRAFT','INVOICE',${total},0,${total},0)`);
        return { id };
      },
    };
    svc = new ContractsService(prisma as never, audit as never, invoices as never);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  let id = '';
  it('creates a contract, refuses a stock item, a bad value and a repeated code', async () => {
    const base = { code: 'K-1', titleAr: 'عقد توريد وتركيب', customerId: CUST, serviceItemId: SERVICE, contractValue: '1000000', advanceAmount: '100000', retentionPercent: '5', taxRatePercent: '14' };
    id = (await svc.create(COMPANY, USER, base)).id;
    await expect(svc.create(COMPANY, USER, { ...base, code: 'k-1' })).rejects.toMatchObject({ response: { code: 'CONTRACT_CODE_EXISTS' } });
    await expect(svc.create(COMPANY, USER, { ...base, code: 'K-2', serviceItemId: STOCK })).rejects.toMatchObject({ response: { code: 'CONTRACT_ITEM_NOT_SERVICE' } });
    await expect(svc.create(COMPANY, USER, { ...base, code: 'K-3', contractValue: '0' })).rejects.toMatchObject({ response: { code: 'CONTRACT_AMOUNT_BAD' } });
    await expect(svc.create(COMPANY, USER, { ...base, code: 'K-4', advanceAmount: '2000000' })).rejects.toMatchObject({ response: { code: 'CONTRACT_ADVANCE_TOO_HIGH' } });
  });

  it('prepares a claim with proportional advance recovery and retention', async () => {
    expect(await svc.preview(COMPANY, id, '200000')).toMatchObject({ periodWork: '200000.00', advanceRecovery: '20000.00', retention: '10000.00', vat: '28000.00', netDueNow: '198000.00' });
    const c = await svc.createClaim(COMPANY, USER, id, { claimDate: '2026-03-31', cumulativeWork: '200000' });
    expect(c.claims).toHaveLength(1);
    await expect(svc.createClaim(COMPANY, USER, id, { claimDate: '2026-04-30', cumulativeWork: '300000' })).rejects.toMatchObject({ response: { code: 'CLAIM_ALREADY_OPEN' } });
  });

  it('the preparer cannot approve; another person approves and gets a draft invoice for the period work', async () => {
    const claimId = (await svc.get(COMPANY, id)).claims[0].id;
    await expect(svc.approveClaim(COMPANY, BRANCH, USER, claimId)).rejects.toMatchObject({ response: { code: 'CLAIM_SAME_PERSON' } });
    await expect(svc.approveClaim(COMPANY, null, BOSS, claimId)).rejects.toMatchObject({ response: { code: 'CLAIM_BRANCH_REQUIRED' } });
    const c = await svc.approveClaim(COMPANY, BRANCH, BOSS, claimId);
    expect(c.claims[0]).toMatchObject({ status: 'INVOICED' });
    expect(c.claims[0].salesInvoiceId).toBeTruthy();
    expect(invoiceCalls[0].lines[0]).toMatchObject({ itemId: SERVICE, quantity: '1', unitPrice: '200000.00', });
    expect(c).toMatchObject({ billedWork: '200000.00', advanceRecovered: '20000.00', retentionHeld: '10000.00', remainingWork: '800000.00' });
    await expect(svc.approveClaim(COMPANY, BRANCH, BOSS, claimId)).rejects.toMatchObject({ response: { code: 'CLAIM_NOT_DRAFT' } });
  });

  it('the next claim builds on what was billed, and a cancelled claim leaves no trace in the totals', async () => {
    await expect(svc.createClaim(COMPANY, USER, id, { claimDate: '2026-04-30', cumulativeWork: '200000' })).rejects.toMatchObject({ response: { code: 'CLAIM_NOT_ABOVE_PREVIOUS' } });
    const c = await svc.createClaim(COMPANY, USER, id, { claimDate: '2026-04-30', cumulativeWork: '500000' });
    expect(c.claims[1]).toMatchObject({ periodWork: '300000.00', previousWork: '200000.00', advanceRecovery: '30000.00' });
    const after = await svc.cancelClaim(COMPANY, USER, c.claims[1].id);
    expect(after.claims[1].status).toBe('CANCELLED');
    expect(after.billedWork).toBe('200000.00');
    await expect(svc.cancelClaim(COMPANY, USER, c.claims[0].id)).rejects.toMatchObject({ response: { code: 'CLAIM_NOT_CANCELLABLE' } });
  });

  it('variations change the contract value but never below the work already billed', async () => {
    const c = await svc.addVariation(COMPANY, USER, id, { variationDate: '2026-04-01', amount: '50000', note: 'أعمال إضافية' });
    expect(c.effectiveValue).toBe('1050000.00');
    await expect(svc.addVariation(COMPANY, USER, id, { variationDate: '2026-04-02', amount: '-900000', note: 'حذف أعمال' })).rejects.toMatchObject({ response: { code: 'CONTRACT_VARIATION_BELOW_BILLED' } });
  });

  it('releases retention only up to what is held, then closes', async () => {
    await expect(svc.releaseRetention(COMPANY, USER, id, { releaseDate: '2026-05-01', amount: '10000.01' })).rejects.toMatchObject({ response: { code: 'RETENTION_RELEASE_TOO_HIGH' } });
    const c = await svc.releaseRetention(COMPANY, USER, id, { releaseDate: '2026-05-01', amount: '4000' });
    expect(c.retentionHeld).toBe('6000.00');
    expect((await svc.setStatus(COMPANY, USER, id, 'CLOSED')).status).toBe('CLOSED');
    await expect(svc.createClaim(COMPANY, USER, id, { claimDate: '2026-06-01', cumulativeWork: '600000' })).rejects.toMatchObject({ response: { code: 'CONTRACT_CLOSED' } });
  });
});
