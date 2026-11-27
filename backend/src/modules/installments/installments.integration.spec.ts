import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { InstallmentsService } from './installments.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '99999999-9999-4999-8999-999999999999';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const INV1 = 'd0000000-0000-4000-8000-000000000031';
const INV2 = 'd0000000-0000-4000-8000-000000000032';
const DRAFT = 'd0000000-0000-4000-8000-000000000033';
const CREDIT = 'd0000000-0000-4000-8000-000000000034';
const MISSING = 'd0000000-0000-4000-8000-0000000000ff';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Customer installment plans against a real migrated PostgreSQL. Dates in the
/// past are always overdue and dates in 2099 are never due, so the checks do
/// not depend on the day the suite runs.
(vmReady ? describe : describe.skip)('customer installments (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let svc: InstallmentsService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const doc = (id: string, no: string, date: string, status: string, type: string, total: number) =>
    run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
         VALUES ('${id}','${COMPANY}','${BRANCH}','${no}','${date}','${CUST}',now(),'${status}','${type}',${total},0,${total},0)`);
  const planRows = async (invoiceId: string) =>
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM installment_plans WHERE "salesInvoiceId" = '${invoiceId}'`) as Promise<{ n: number }[]>;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','in','In','ت','x',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','Customer','عميل',now())`);
    await doc(INV1, 'SI-1', '2026-03-05', 'POSTED', 'INVOICE', 1000);
    await doc(INV2, 'SI-2', '2026-01-10', 'POSTED', 'INVOICE', 600);
    await doc(DRAFT, 'SI-3', '2026-03-21', 'DRAFT', 'INVOICE', 100);
    await doc(CREDIT, 'CN-1', '2026-03-22', 'POSTED', 'CREDIT_NOTE', 100);
    const audit = { record: async () => {}, recordRequired: async () => {} };
    svc = new InstallmentsService(prisma as never, audit as never);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('splits a posted invoice with a down payment, last installment takes the odd piasters, month ends stay in range', async () => {
    const v = await svc.save(COMPANY, USER, INV1, { downPayment: '100', count: 3, intervalMonths: 1, firstDue: '2099-01-31' });
    expect(v.items.map((i) => [i.no, i.dueDate, i.amount, i.isDownPayment])).toEqual([
      [1, '2026-03-05', 100, true],
      [2, '2099-01-31', 300, false],
      [3, '2099-02-28', 300, false],
      [4, '2099-03-31', 300, false],
    ]);
    expect(v.items.reduce((s, i) => s + Math.round(i.amount * 100), 0)).toBe(100_000);
    expect(v).toMatchObject({ total: 1000, paid: 0, count: 3, downPayment: 100, overdueCount: 1, overdueAmount: 100 });
    expect(v.items[0].status).toBe('OVERDUE');
    expect(v.items[0].daysLate).toBeGreaterThan(0);
    expect(v.items[1].status).toBe('UPCOMING');
  });

  it('follows what the customer pays on the invoice, oldest installment first', async () => {
    await run(`UPDATE sales_invoices SET "paidAmount" = 100 WHERE id = '${INV1}'`);
    let v = await svc.forInvoice(COMPANY, INV1);
    expect(v.items[0]).toMatchObject({ status: 'PAID', paid: 100, remaining: 0 });
    expect(v).toMatchObject({ overdueCount: 0, overdueAmount: 0, nextDue: '2099-01-31' });
    await run(`UPDATE sales_invoices SET "paidAmount" = 250 WHERE id = '${INV1}'`);
    v = await svc.forInvoice(COMPANY, INV1);
    expect(v.items[1]).toMatchObject({ status: 'PARTIAL', paid: 150, remaining: 150 });
    await run(`UPDATE sales_invoices SET "paidAmount" = 0 WHERE id = '${INV1}'`);
  });

  it('saving again replaces the plan and leaves exactly one', async () => {
    const v = await svc.save(COMPANY, USER, INV1, { downPayment: '', count: 2, firstDue: '2099-06-15' });
    expect(v.items.map((i) => i.amount)).toEqual([500, 500]);
    expect(v.downPayment).toBe(0);
    expect(v.intervalMonths).toBe(1);
    expect((await planRows(INV1))[0].n).toBe(1);
    const rows = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM installments i JOIN installment_plans p ON p.id = i."planId" WHERE p."salesInvoiceId" = '${INV1}'`)) as { n: number }[];
    expect(rows[0].n).toBe(2);
  });

  it('refuses a draft, a credit note, an unknown invoice and another company\'s invoice', async () => {
    const input = { count: 3, firstDue: '2099-01-31' };
    await expect(svc.save(COMPANY, USER, DRAFT, input)).rejects.toMatchObject({ response: { code: 'INSTALLMENT_INVOICE_NOT_POSTED', field: 'invoiceId' } });
    await expect(svc.save(COMPANY, USER, CREDIT, input)).rejects.toMatchObject({ response: { code: 'INSTALLMENT_INVOICE_NOT_POSTED' } });
    await expect(svc.save(COMPANY, USER, MISSING, input)).rejects.toMatchObject({ response: { code: 'INVOICE_NOT_FOUND' } });
    await expect(svc.save(OTHER_COMPANY, USER, INV1, input)).rejects.toMatchObject({ response: { code: 'INVOICE_NOT_FOUND' } });
    await expect(svc.forInvoice(OTHER_COMPANY, INV1)).rejects.toMatchObject({ response: { code: 'INVOICE_NOT_FOUND' } });
    expect((await planRows(DRAFT))[0].n).toBe(0);
  });

  it('refuses bad plans and keeps the saved one untouched', async () => {
    const before = await svc.forInvoice(COMPANY, INV1);
    await expect(svc.save(COMPANY, USER, INV1, { downPayment: '1000', count: 3, firstDue: '2099-01-31' })).rejects.toMatchObject({ response: { code: 'INSTALLMENT_DOWN_TOO_BIG' } });
    await expect(svc.save(COMPANY, USER, INV1, { count: 3, firstDue: '2026-03-04' })).rejects.toMatchObject({ response: { code: 'INSTALLMENT_FIRST_BEFORE_INVOICE' } });
    await expect(svc.save(COMPANY, USER, INV1, { count: 1, firstDue: '2099-01-31' })).rejects.toMatchObject({ response: { field: 'count' } });
    await expect(svc.save(COMPANY, USER, INV1, { downPayment: '1.234', count: 3, firstDue: '2099-01-31' })).rejects.toMatchObject({ response: { field: 'downPayment' } });
    await expect(svc.save(COMPANY, USER, INV1, { count: 3, firstDue: 'soon' })).rejects.toMatchObject({ response: { field: 'count' } });
    expect(await svc.forInvoice(COMPANY, INV1)).toEqual(before);
  });

  it('lists plans by state and the overdue installments oldest first', async () => {
    await svc.save(COMPANY, USER, INV2, { count: 2, firstDue: '2026-02-10', intervalMonths: 1 });
    const overdue = await svc.overdue(COMPANY);
    expect(overdue.items.map((i) => [i.invoiceNumber, i.no, i.dueDate])).toEqual([
      ['SI-2', 1, '2026-02-10'],
      ['SI-2', 2, '2026-03-10'],
    ]);
    expect(overdue.totals).toEqual({ count: 2, amount: 600 });
    expect((await svc.listPlans(COMPANY, { status: 'overdue' })).items.map((i) => i.invoiceNumber)).toEqual(['SI-2']);
    expect((await svc.listPlans(COMPANY, { status: 'OPEN' })).items).toHaveLength(2);
    await run(`UPDATE sales_invoices SET "paidAmount" = 600 WHERE id = '${INV2}'`);
    expect((await svc.listPlans(COMPANY, { status: 'PAID' })).items.map((i) => i.invoiceNumber)).toEqual(['SI-2']);
    expect((await svc.overdue(COMPANY)).items).toHaveLength(0);
    await expect(svc.listPlans(COMPANY, { status: 'LATE' })).rejects.toMatchObject({ response: { field: 'status' } });
  });

  it('removes a plan once, then says there is none', async () => {
    expect(await svc.remove(COMPANY, USER, INV1)).toEqual({ removed: true });
    await expect(svc.remove(COMPANY, USER, INV1)).rejects.toMatchObject({ response: { code: 'PLAN_NOT_FOUND' } });
    await expect(svc.forInvoice(COMPANY, INV1)).rejects.toMatchObject({ response: { code: 'PLAN_NOT_FOUND' } });
    const left = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM installments i WHERE NOT EXISTS (SELECT 1 FROM installment_plans p WHERE p.id = i."planId")`)) as { n: number }[];
    expect(left[0].n).toBe(0);
  });
});
