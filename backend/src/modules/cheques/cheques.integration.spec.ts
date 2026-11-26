import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { CashVouchersService } from '../cash/cash-vouchers.service';
import { ChequesService } from './cheques.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const AR = 'a0000000-0000-4000-8000-0000000000a1';
const AP = 'a0000000-0000-4000-8000-0000000000a2';
const GL = 'b0000000-0000-4000-8000-a00000000011';
const BANK = 'b0000000-0000-4000-8000-b00000000011';
const BANK_OFF = 'b0000000-0000-4000-8000-b00000000012';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const SUPP = 'e0000000-0000-4000-8000-000000000001';
const INV = 'd0000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Cheques against a real migrated PostgreSQL, with the production cash voucher engine.
(vmReady ? describe : describe.skip)('cheques (real schema)', () => {
  let prisma: any;
  let svc: ChequesService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const query = (sql: string) => prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, any>>>;
  let n = 0;
  const recv = (over: Record<string, unknown> = {}) =>
    svc.create(COMPANY, BRANCH, USER, {
      direction: 'RECEIVED', chequeNumber: `R${++n}`, bankName: 'Bank Misr', customerId: CUST, amount: '600',
      issueDate: '2026-02-01', dueDate: '2026-03-01', cashAccountId: BANK, ...over,
    } as never);
  const issued = (over: Record<string, unknown> = {}) =>
    svc.create(COMPANY, BRANCH, USER, {
      direction: 'ISSUED', chequeNumber: `I${++n}`, bankName: 'CIB', supplierId: SUPP, amount: '100',
      issueDate: '2026-02-01', dueDate: '2026-03-01', cashAccountId: BANK, ...over,
    } as never);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','chq','Chq','ش','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES
      ('${AR}','${COMPANY}','1103','Receivable','عملاء','ASSET',now()),
      ('${AP}','${COMPANY}','2101','Payable','موردون','LIABILITY',now()),
      ('${GL}','${COMPANY}','1011','Bank','بنك','ASSET',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId","updatedAt") VALUES
      ('${BANK}','${COMPANY}','${BRANCH}','BK1','Bank','بنك','BANK','${GL}',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId","isActive","updatedAt") VALUES
      ('${BANK_OFF}','${COMPANY}','${BRANCH}','BK2','Closed','مغلق','BANK','${GL}',false,now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','C','ع',now())`);
    await run(`INSERT INTO suppliers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${SUPP}','${COMPANY}','S','S','م',now())`);
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${INV}','${COMPANY}','${BRANCH}','SI-1','2026-01-15','${CUST}',now(),'POSTED','INVOICE',1000,0,1000,0)`);
    const numbers = new DocumentNumberService();
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const periods = new FiscalPeriodsService(prisma as never, audit);
    const posting = new PostingService(numbers, periods, new CostCentersService(prisma as never, audit));
    const vouchers = new CashVouchersService(prisma as never, numbers, posting, new AccountMapService(), audit);
    svc = new ChequesService(prisma as never, vouchers, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('registers a received cheque as held, with a history line', async () => {
    const c: any = await recv();
    expect(c.status).toBe('HELD');
    expect(c.amount).toBe('600.0000');
    expect(c.events.map((e: any) => e.action)).toEqual(['register']);
  });

  it('refuses bad input with the field named', async () => {
    await expect(recv({ amount: '0' })).rejects.toMatchObject({ response: { field: 'amount' } });
    await expect(recv({ dueDate: '2026-01-01' })).rejects.toMatchObject({ response: { field: 'dueDate' } });
    await expect(recv({ dueDate: '2026-02-30' })).rejects.toMatchObject({ response: { field: 'dueDate' } });
    await expect(recv({ customerId: undefined })).rejects.toMatchObject({ response: { field: 'customerId' } });
    await expect(recv({ supplierId: SUPP })).rejects.toMatchObject({ response: { field: 'supplierId' } });
    await expect(issued({ cashAccountId: undefined })).rejects.toMatchObject({ response: { field: 'cashAccountId' } });
    await expect(recv({ allocations: [{ salesInvoiceId: INV, amount: '700' }] })).rejects.toMatchObject({ response: { field: 'allocations' } });
  });

  it('the same number at the same bank is refused, a cancelled one can be registered again', async () => {
    const a: any = await recv({ chequeNumber: 'DUP1' });
    await expect(recv({ chequeNumber: 'DUP1', bankName: 'bank misr' })).rejects.toMatchObject({ response: { code: 'CHEQUE_DUPLICATE' } });
    await recv({ chequeNumber: 'DUP1', bankName: 'Other bank' });
    await svc.act(COMPANY, USER, BRANCH, a.id, 'cancel', { note: 'wrong cheque' });
    await recv({ chequeNumber: 'DUP1' });
  });

  it('collecting a received cheque posts a receipt that pays the invoice, once', async () => {
    const c: any = await recv({ allocations: [{ salesInvoiceId: INV, amount: '600' }] });
    await expect(svc.act(COMPANY, USER, BRANCH, c.id, 'collect')).rejects.toMatchObject({ response: { code: 'CHEQUE_STATE' } });
    await svc.act(COMPANY, USER, BRANCH, c.id, 'deposit');
    const done: any = await svc.act(COMPANY, USER, BRANCH, c.id, 'collect', { date: '2026-03-02' });
    expect(done.status).toBe('COLLECTED');
    expect(done.voucherId).toBeTruthy();
    const [v] = await query(`SELECT status, kind, amount FROM cash_vouchers WHERE id='${done.voucherId}'`);
    expect(v.status).toBe('POSTED');
    expect(v.kind).toBe('RECEIPT');
    expect(Number(v.amount)).toBe(600);
    const [inv] = await query(`SELECT "paidAmount" FROM sales_invoices WHERE id='${INV}'`);
    expect(Number(inv.paidAmount)).toBe(600);
    // a second press does nothing and books nothing
    await expect(svc.act(COMPANY, USER, BRANCH, c.id, 'collect')).rejects.toMatchObject({ response: { code: 'CHEQUE_STATE' } });
    expect((await query(`SELECT count(*)::int AS n FROM cash_vouchers WHERE reference='CHQ ${done.chequeNumber}'`))[0].n).toBe(1);
  });

  it('a bounced cheque books nothing, needs a reason, and can be presented again', async () => {
    const c: any = await recv();
    await svc.act(COMPANY, USER, BRANCH, c.id, 'deposit');
    await expect(svc.act(COMPANY, USER, BRANCH, c.id, 'bounce')).rejects.toMatchObject({ response: { field: 'note' } });
    const b: any = await svc.act(COMPANY, USER, BRANCH, c.id, 'bounce', { note: 'insufficient funds' });
    expect(b.status).toBe('BOUNCED');
    expect(b.voucherId).toBeNull();
    const again: any = await svc.act(COMPANY, USER, BRANCH, c.id, 'represent');
    expect(again.status).toBe('DEPOSITED');
    expect(again.events.map((e: any) => e.action)).toEqual(['register', 'deposit', 'bounce', 'represent']);
  });

  it('clearing an issued cheque posts a payment; it has no deposit step', async () => {
    // fund the bank first so the payment is covered
    const fund: any = await recv({ amount: '500' });
    await svc.act(COMPANY, USER, BRANCH, fund.id, 'deposit');
    await svc.act(COMPANY, USER, BRANCH, fund.id, 'collect');
    const c: any = await issued();
    await expect(svc.act(COMPANY, USER, BRANCH, c.id, 'deposit')).rejects.toMatchObject({ response: { code: 'CHEQUE_STATE' } });
    const done: any = await svc.act(COMPANY, USER, BRANCH, c.id, 'collect');
    expect(done.status).toBe('COLLECTED');
    const [v] = await query(`SELECT kind, status FROM cash_vouchers WHERE id='${done.voucherId}'`);
    expect(v).toMatchObject({ kind: 'PAYMENT', status: 'POSTED' });
  });

  it('a failed booking leaves the cheque as it was and no stray voucher', async () => {
    const c: any = await recv();
    await svc.act(COMPANY, USER, BRANCH, c.id, 'deposit');
    await expect(svc.act(COMPANY, USER, BRANCH, c.id, 'collect', { cashAccountId: BANK_OFF })).rejects.toBeDefined();
    const after: any = await svc.findOne(COMPANY, c.id);
    expect(after.status).toBe('DEPOSITED');
    expect(after.voucherId).toBeNull();
    expect((await query(`SELECT count(*)::int AS n FROM cash_vouchers WHERE reference='CHQ ${c.chequeNumber}' AND "deletedAt" IS NULL`))[0].n).toBe(0);
    // and it can still be collected properly afterwards
    const ok: any = await svc.act(COMPANY, USER, BRANCH, c.id, 'collect');
    expect(ok.status).toBe('COLLECTED');
  });

  it('two people collecting at once book one receipt', async () => {
    const c: any = await recv();
    await svc.act(COMPANY, USER, BRANCH, c.id, 'deposit');
    const results = await Promise.allSettled([
      svc.act(COMPANY, USER, BRANCH, c.id, 'collect'),
      svc.act(COMPANY, USER, BRANCH, c.id, 'collect'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await query(`SELECT count(*)::int AS n FROM cash_vouchers WHERE reference='CHQ ${c.chequeNumber}'`))[0].n).toBe(1);
  });

  it('the list filters, flags overdue cheques and totals the open ones', async () => {
    const open: any = await svc.list(COMPANY, { status: 'OPEN' });
    expect(open.rows.every((r: any) => r.status === 'HELD' || r.status === 'DEPOSITED')).toBe(true);
    expect(open.rows.every((r: any) => r.overdue === (r.dueDate < new Date().toISOString().slice(0, 10)))).toBe(true);
    const issuedOnly: any = await svc.list(COMPANY, { direction: 'ISSUED' });
    expect(issuedOnly.rows.every((r: any) => r.direction === 'ISSUED')).toBe(true);
    await expect(svc.list(COMPANY, { status: 'nope' })).rejects.toBeDefined();
    await expect(svc.findOne('99999999-9999-4999-8999-999999999999', open.rows[0].id)).rejects.toBeDefined();
  });
});
