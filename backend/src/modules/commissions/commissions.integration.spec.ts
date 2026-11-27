import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { CommissionsService } from './commissions.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const INV1 = 'd0000000-0000-4000-8000-000000000021';
const INV2 = 'd0000000-0000-4000-8000-000000000022';
const CN1 = 'd0000000-0000-4000-8000-000000000023';
const DRAFT = 'd0000000-0000-4000-8000-000000000024';
const DEBIT = 'd0000000-0000-4000-8000-000000000025';
const CN_ORPHAN = 'd0000000-0000-4000-8000-000000000026';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Sales-rep commissions against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('sales commissions (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let svc: CommissionsService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const doc = (id: string, no: string, date: string, status: string, type: string, total: number, tax: number, orig: string | null = null) =>
    run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","originalInvoiceId","subTotal","taxAmount","totalAmount","paidAmount")
         VALUES ('${id}','${COMPANY}','${BRANCH}','${no}','${date}','${CUST}',now(),'${status}','${type}',${orig ? `'${orig}'` : 'NULL'},${total - tax},${tax},${total},0)`);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','cm','Cm','ش','x',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','Customer','عميل',now())`);
    await doc(INV1, 'SI-1', '2026-03-05', 'POSTED', 'INVOICE', 1140, 140);
    await doc(INV2, 'SI-2', '2026-03-20', 'POSTED', 'INVOICE', 500, 0);
    await doc(CN1, 'CN-1', '2026-03-25', 'POSTED', 'CREDIT_NOTE', 114, 14, INV1);
    await doc(DRAFT, 'SI-3', '2026-03-21', 'DRAFT', 'INVOICE', 100, 0);
    await doc(DEBIT, 'DN-1', '2026-03-22', 'POSTED', 'DEBIT_NOTE', 100, 0, INV1);
    await doc(CN_ORPHAN, 'CN-2', '2026-03-26', 'POSTED', 'CREDIT_NOTE', 50, 0, INV2);
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    svc = new CommissionsService(prisma as never, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  let rep = '';
  it('creates a rep, refuses a repeated name and a bad rate', async () => {
    rep = (await svc.createRep(COMPANY, USER, { nameEn: 'Sami', nameAr: 'سامي', ratePercent: '2.5' })).id;
    await expect(svc.createRep(COMPANY, USER, { nameEn: 'sami', nameAr: 'سامي ٢', ratePercent: '1' })).rejects.toMatchObject({ response: { code: 'REP_DUPLICATE' } });
    await expect(svc.createRep(COMPANY, USER, { nameEn: 'Bad', nameAr: 'س', ratePercent: '101' })).rejects.toMatchObject({ response: { field: 'ratePercent' } });
  });

  it('commissions an invoice on its total without VAT, once', async () => {
    const r = await svc.assign(COMPANY, USER, { salesInvoiceId: INV1, repId: rep });
    expect(r).toMatchObject({ kind: 'SALE', basis: '1000.00', amount: '25.00', ratePercent: 2.5 });
    await expect(svc.assign(COMPANY, USER, { salesInvoiceId: INV1, repId: rep })).rejects.toMatchObject({ response: { code: 'COMMISSION_EXISTS' } });
  });

  it('refuses drafts, debit notes and an unknown or inactive rep', async () => {
    await expect(svc.assign(COMPANY, USER, { salesInvoiceId: DRAFT, repId: rep })).rejects.toMatchObject({ response: { field: 'salesInvoiceId' } });
    await expect(svc.assign(COMPANY, USER, { salesInvoiceId: DEBIT, repId: rep })).rejects.toMatchObject({ response: { field: 'salesInvoiceId' } });
    await expect(svc.assign(COMPANY, USER, { salesInvoiceId: INV2, repId: 'a0000000-0000-4000-8000-0000000000ff' })).rejects.toMatchObject({ response: { field: 'repId' } });
    const off = (await svc.createRep(COMPANY, USER, { nameEn: 'Off', nameAr: 'متوقف', ratePercent: '1' })).id;
    await svc.updateRep(COMPANY, USER, off, { active: false });
    await expect(svc.assign(COMPANY, USER, { salesInvoiceId: INV2, repId: off })).rejects.toMatchObject({ response: { field: 'repId' } });
  });

  it('a credit note takes back at the original rep and rate, even after the rate changes', async () => {
    await svc.updateRep(COMPANY, USER, rep, { ratePercent: '10' });
    const r = await svc.assign(COMPANY, USER, { salesInvoiceId: CN1 });
    expect(r).toMatchObject({ kind: 'RETURN', basis: '-100.00', amount: '-2.50', ratePercent: 2.5 });
    await expect(svc.assign(COMPANY, USER, { salesInvoiceId: CN_ORPHAN })).rejects.toMatchObject({ response: { field: 'salesInvoiceId' } });
  });

  it('a new rate applies to later documents only', async () => {
    const r = await svc.assign(COMPANY, USER, { salesInvoiceId: INV2, repId: rep });
    expect(r).toMatchObject({ amount: '50.00', ratePercent: 10 });
  });

  it('lists entries and what is still unassigned', async () => {
    const e = await svc.listEntries(COMPANY, { repId: rep });
    expect(e.items).toHaveLength(3);
    expect(e.totals).toEqual({ accrued: 72.5, paid: 0 });
    const u = await svc.unassigned(COMPANY, {});
    expect(u.items.map((i) => i.invoiceNumber)).toEqual(['CN-2']);
  });

  it('refuses removing a sale while its return carries commission', async () => {
    const e = await svc.listEntries(COMPANY, { repId: rep });
    const sale = e.items.find((i) => i.invoiceNumber === 'SI-1')!;
    await expect(svc.removeEntry(COMPANY, USER, sale.id)).rejects.toMatchObject({ response: { code: 'COMMISSION_HAS_RETURN' } });
  });

  it('pays a period net of returns, only once, and locks the paid entries', async () => {
    await expect(svc.payout(COMPANY, USER, { repId: rep, from: '2026-04-01', to: '2026-04-30' })).rejects.toMatchObject({ response: { field: 'from' } });
    await expect(svc.payout(COMPANY, USER, { repId: rep, from: '2026-03-31', to: '2026-03-01' })).rejects.toMatchObject({ response: { field: 'from' } });
    const p = await svc.payout(COMPANY, USER, { repId: rep, from: '2026-03-01', to: '2026-03-31', note: 'March' });
    expect(p).toMatchObject({ amount: '72.50', entries: 3 });
    await expect(svc.payout(COMPANY, USER, { repId: rep, from: '2026-03-01', to: '2026-03-31' })).rejects.toMatchObject({ response: { field: 'from' } });
    const e = await svc.listEntries(COMPANY, { repId: rep, status: 'PAID' });
    expect(e.items).toHaveLength(3);
    await expect(svc.removeEntry(COMPANY, USER, e.items[0].id)).rejects.toMatchObject({ response: { code: 'COMMISSION_PAID' } });
    expect((await svc.listPayouts(COMPANY)).items).toHaveLength(1);
  });

  it('two payouts at the same moment pay each entry once', async () => {
    await doc('d0000000-0000-4000-8000-000000000031', 'SI-9', '2026-05-02', 'POSTED', 'INVOICE', 1000, 0);
    await svc.assign(COMPANY, USER, { salesInvoiceId: 'd0000000-0000-4000-8000-000000000031', repId: rep });
    const results = await Promise.allSettled([
      svc.payout(COMPANY, USER, { repId: rep, from: '2026-05-01', to: '2026-05-31' }),
      svc.payout(COMPANY, USER, { repId: rep, from: '2026-05-01', to: '2026-05-31' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM commission_payouts WHERE "fromDate" = '2026-05-01'`);
    expect(n).toBe(1);
  });
});
