import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { CashVouchersService } from './cash-vouchers.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const GL_EGP = 'b0000000-0000-4000-8000-a00000000011';
const GL_USD = 'b0000000-0000-4000-8000-a00000000012';
const AR = 'a0000000-0000-4000-8000-0000000000a1';
const OTHER_INCOME = 'a0000000-0000-4000-8000-0000000000a3';
const BANK_EGP = 'b0000000-0000-4000-8000-b00000000011';
const BANK_USD = 'b0000000-0000-4000-8000-b00000000012';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const OTHER_CUST = 'c0000000-0000-4000-8000-000000000002';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Receipts that settle a foreign-currency sales invoice: the receivable leaves at the invoice's
/// own rate, the cash arrives at the receipt's rate, and the difference is a realised exchange
/// gain or loss. Real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('settling a foreign-currency sales invoice (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let vouchers: CashVouchersService;
  let seq = 0;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (sql: string) => prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, any>>>;

  /** A posted invoice of 34.20 USD booked at 50, so 1,710.00 in company currency. */
  const invoice = async (customer = CUST) => {
    seq += 1;
    const id = `d0000000-0000-4000-8000-0000000000${String(seq).padStart(2, '0')}`;
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${id}','${COMPANY}','${BRANCH}','SI-${seq}','2026-03-01','${customer}',now(),'POSTED','INVOICE',1500,210,1710,0)`);
    await run(`INSERT INTO sales_invoice_fx("invoiceId","companyId",currency,rate,"rateSource","foreignSubTotal","foreignTaxAmount","foreignTotal")
               VALUES ('${id}','${COMPANY}','USD',50,'TYPED',30,4.2,34.2)`);
    return id;
  };
  const receipt = (cash: string, amount: string, allocations: Array<{ salesInvoiceId: string; amount: string }>, extra: Record<string, unknown> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vouchers.create(COMPANY, BRANCH, USER, { kind: 'RECEIPT', cashAccountId: cash, voucherDate: '2026-03-10', amount, customerId: CUST, allocations, ...extra } as never) as Promise<any>;
  const lines = (voucherId: string) =>
    query(`SELECT l."accountId", l.debit::text AS debit, l.credit::text AS credit
             FROM journal_lines l JOIN journal_entries e ON e.id = l."journalEntryId"
            WHERE e."sourceId" = '${voucherId}' AND e."sourceType" = 'CASH_VOUCHER' ORDER BY e."createdAt", l."lineNumber"`);
  const state = async (id: string) => (await query(`SELECT i."paidAmount"::text AS paid, f."foreignPaid"::text AS fpaid FROM sales_invoices i JOIN sales_invoice_fx f ON f."invoiceId" = i.id WHERE i.id = '${id}'`))[0];

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','fx','Fx','ش','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES
      ('${AR}','${COMPANY}','1103','Receivable','عملاء','ASSET',now()),
      ('a0000000-0000-4000-8000-0000000000a2','${COMPANY}','2101','Payable','موردون','LIABILITY',now()),
      ('${OTHER_INCOME}','${COMPANY}','4103','Other income','إيرادات أخرى','REVENUE',now()),
      ('${GL_EGP}','${COMPANY}','1011','Bank','بنك','ASSET',now()),
      ('${GL_USD}','${COMPANY}','1012','Dollar bank','بنك دولار','ASSET',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId",currency,"updatedAt") VALUES
      ('${BANK_EGP}','${COMPANY}','${BRANCH}','BKE','Bank','بنك','BANK','${GL_EGP}','EGP',now()),
      ('${BANK_USD}','${COMPANY}','${BRANCH}','BKU','Dollar bank','بنك دولار','BANK','${GL_USD}','USD',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES
      ('${CUST}','${COMPANY}','C','C','ع',now()), ('${OTHER_CUST}','${COMPANY}','D','D','د',now())`);
    await run(`INSERT INTO currencies(id,"companyId",code,"nameAr","nameEn") VALUES (gen_random_uuid(),'${COMPANY}','USD','دولار','Dollar')`);
    const numbers = new DocumentNumberService();
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const posting = new PostingService(numbers, new FiscalPeriodsService(prisma as never, audit), new CostCentersService(prisma as never, audit));
    vouchers = new CashVouchersService(prisma as never, numbers, posting, new AccountMapService(), audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('a full payment at a higher rate books the receivable at the invoice rate and the rest as a realised gain', async () => {
    const inv = await invoice();
    const v = await receipt(BANK_USD, '34.20', [{ salesInvoiceId: inv, amount: '34.20' }], { exchangeRate: '52' });
    await vouchers.post(COMPANY, USER, v.id);
    const rows = await lines(v.id);
    expect(rows.find((r) => r.accountId === GL_USD)?.debit).toBe('1778.4000');
    expect(rows.find((r) => r.accountId === AR)?.credit).toBe('1710.0000');
    expect(rows.find((r) => r.accountId === OTHER_INCOME)?.credit).toBe('68.4000');
    expect(await state(inv)).toEqual({ paid: '1710.0000', fpaid: '34.2000' });
    const [entry] = await query(`SELECT "totalDebit"::text AS d, "totalCredit"::text AS c FROM journal_entries WHERE "sourceId" = '${v.id}'`);
    expect(entry.d).toBe(entry.c);
  });

  it('a part payment at a lower rate is a loss, and the last payment clears the invoice exactly', async () => {
    const inv = await invoice();
    const part = await receipt(BANK_USD, '10', [{ salesInvoiceId: inv, amount: '10' }], { exchangeRate: '48' });
    await vouchers.post(COMPANY, USER, part.id);
    const partRows = await lines(part.id);
    expect(partRows.find((r) => r.accountId === AR)?.credit).toBe('500.0000');
    expect(partRows.find((r) => r.accountId === GL_USD)?.debit).toBe('480.0000');
    expect(partRows.find((r) => r.accountId === OTHER_INCOME)?.debit).toBe('20.0000');
    expect(await state(inv)).toEqual({ paid: '500.0000', fpaid: '10.0000' });
    const rest = await receipt(BANK_USD, '24.20', [{ salesInvoiceId: inv, amount: '24.20' }], { exchangeRate: '50' });
    await vouchers.post(COMPANY, USER, rest.id);
    const restRows = await lines(rest.id);
    expect(restRows.find((r) => r.accountId === AR)?.credit).toBe('1210.0000');
    expect(restRows.find((r) => r.accountId === OTHER_INCOME)).toBeUndefined();
    expect(await state(inv)).toEqual({ paid: '1710.0000', fpaid: '34.2000' });
  });

  it('reversing the receipt gives back exactly what it took', async () => {
    const inv = await invoice();
    const v = await receipt(BANK_USD, '34.20', [{ salesInvoiceId: inv, amount: '34.20' }], { exchangeRate: '49' });
    await vouchers.post(COMPANY, USER, v.id);
    expect(await state(inv)).toEqual({ paid: '1710.0000', fpaid: '34.2000' });
    await vouchers.reverse(COMPANY, USER, v.id, 'wrong rate');
    expect(await state(inv)).toEqual({ paid: '0.0000', fpaid: '0.0000' });
  });

  it('a company-currency receipt keeps the foreign balance in step, and clearing the invoice clears it', async () => {
    const inv = await invoice();
    const half = await receipt(BANK_EGP, '855', [{ salesInvoiceId: inv, amount: '855' }]);
    await vouchers.post(COMPANY, USER, half.id);
    expect(await state(inv)).toEqual({ paid: '855.0000', fpaid: '17.1000' });
    const rest = await receipt(BANK_EGP, '855', [{ salesInvoiceId: inv, amount: '855' }]);
    await vouchers.post(COMPANY, USER, rest.id);
    expect(await state(inv)).toEqual({ paid: '1710.0000', fpaid: '34.2000' });
    await vouchers.reverse(COMPANY, USER, rest.id);
    expect(await state(inv)).toEqual({ paid: '855.0000', fpaid: '17.1000' });
  });

  it('refuses a partly allocated foreign receipt, an over-payment, an ordinary invoice and another customer\'s invoice', async () => {
    const inv = await invoice();
    await expect(receipt(BANK_USD, '20', [{ salesInvoiceId: inv, amount: '10' }], { exchangeRate: '50' })).rejects.toMatchObject({ response: { code: 'VOUCHER_FX_ALLOC_EXACT' } });
    await expect(receipt(BANK_USD, '40', [{ salesInvoiceId: inv, amount: '40' }], { exchangeRate: '50' })).rejects.toMatchObject({ response: { code: 'VOUCHER_INVOICE_OVERPAID' } });
    const ordinary = 'd0000000-0000-4000-8000-0000000000ff';
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${ordinary}','${COMPANY}','${BRANCH}','SI-EGP','2026-03-01','${CUST}',now(),'POSTED','INVOICE',100,0,100,0)`);
    await expect(receipt(BANK_USD, '2', [{ salesInvoiceId: ordinary, amount: '2' }], { exchangeRate: '50' })).rejects.toMatchObject({ response: { code: 'VOUCHER_INVOICE_CURRENCY' } });
    const theirs = await invoice(OTHER_CUST);
    await expect(receipt(BANK_USD, '5', [{ salesInvoiceId: theirs, amount: '5' }], { exchangeRate: '50' })).rejects.toMatchObject({ response: { code: 'VOUCHER_INVOICE_OTHER_PARTY' } });
    await expect(receipt(BANK_USD, '5', [{ salesInvoiceId: inv, amount: '5' }])).rejects.toMatchObject({ response: { code: 'FX_RATE_MISSING' } });
  });
});
