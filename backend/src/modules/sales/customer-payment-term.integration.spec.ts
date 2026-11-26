import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PartiesService } from '../parties/parties.service';
import { CustomerCreditService } from './customer-credit.service';
import { SalesInvoicesService } from './sales-invoices.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const PLAIN = 'c0000000-0000-4000-8000-000000000001'; // 0 days, default method: no terms
const TERMS = 'c0000000-0000-4000-8000-000000000002'; // 30 days from invoice date
const INST = 'c0000000-0000-4000-8000-000000000003'; // installments 30/70
const MGR = '33333333-3333-4333-8333-333333333332';
const CREATOR = '33333333-3333-4333-8333-333333333399';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Customer payment terms against a real migrated PostgreSQL: saving the 12
/// methods, the remembered default, due dates on invoices, and the block on
/// posting for a customer who is past the agreed period.
(vmReady ? describe : describe.skip)('customer payment terms (real schema)', () => {
  let prisma: any;
  let credit: CustomerCreditService;
  let parties: PartiesService;
  let audited: any[];
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const inv = (id: string, no: string, total: number, status: string, cust: string, opts: { paid?: number; due?: string | null; schedule?: object | null; date?: string } = {}) =>
    run(
      `INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","dueDate","dueSchedule","customerId","updatedAt",status,"documentType","totalAmount","paidAmount","createdBy")
       VALUES ('${id}','${COMPANY}','${BRANCH}','${no}',${opts.date ? `'${opts.date}'` : 'current_date'},${opts.due === undefined || opts.due === null ? 'NULL' : `'${opts.due}'`},${opts.schedule ? `'${JSON.stringify(opts.schedule)}'::jsonb` : 'NULL'},'${cust}',now(),'${status}','INVOICE',${total},${opts.paid ?? 0},'${CREATOR}')`,
    );
  const id = (n: number) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const post = (invoiceId: string, disclose = true) => prisma.$transaction((tx: any) => credit.assertPeriodCanPost(tx, COMPANY, invoiceId, disclose));
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","paymentTermDays","paymentTermMethod","updatedAt") VALUES
      ('${PLAIN}','${COMPANY}','C0','Plain','عادي',0,'FROM_INVOICE_DATE',now()),
      ('${TERMS}','${COMPANY}','C1','Terms','بمدة',30,'FROM_INVOICE_DATE',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","paymentTermDays","paymentTermMethod","paymentTermConfig","updatedAt") VALUES
      ('${INST}','${COMPANY}','C2','Inst','أقساط',0,'INSTALLMENTS','{"installments":[{"percent":30,"afterDays":0},{"percent":70,"afterDays":45}]}'::jsonb,now())`);
    audited = [];
    const audit: any = { record: async (i: unknown) => { audited.push(i); } };
    parties = new PartiesService(prisma as never, audit);
    credit = new CustomerCreditService(prisma as never, parties, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  describe('saving the terms on the customer card', () => {
    it('a new customer starts with the default method and keeps the days', async () => {
      const c: any = await parties.create(COMPANY, MGR, 'customer', { code: 'N1', nameEn: 'New one', paymentTermDays: 20 });
      expect(c.paymentTermMethod).toBe('FROM_INVOICE_DATE');
      expect(c.paymentTermDays).toBe(20);
    });

    it('each of the 12 methods saves and reads back', async () => {
      const cases: Array<[string, number, object | undefined]> = [
        ['FROM_INVOICE_DATE', 30, undefined],
        ['FROM_MONTH_END', 30, undefined],
        ['FROM_NEXT_MONTH_START', 10, undefined],
        ['FROM_DELIVERY_DATE', 14, undefined],
        ['FIXED_DAY_NEXT_MONTH', 0, { dayOfMonth: 10 }],
        ['EARLY_DISCOUNT', 30, { discountPercent: 2, discountDays: 10 }],
        ['COD_ADVANCE', 0, undefined],
        ['INSTALLMENTS', 0, { installments: [{ percent: 50, afterDays: 0 }, { percent: 50, afterDays: 30 }] }],
        ['DAY_WINDOWS', 0, { windows: [{ fromDay: 1, toDay: 31, payDay: 5, monthOffset: 1 }] }],
        ['MILESTONES', 0, { installments: [{ percent: 50, afterDays: 0, label: 'Order' }, { percent: 50, afterDays: 60, label: 'Acceptance' }] }],
        ['LATE_PENALTY', 30, { penalty: { percent: 1, period: 'MONTH', graceDays: 3 } }],
        ['WEEKLY_CUTOFF', 7, { weekday: 4 }],
      ];
      let n = 0;
      for (const [method, days, config] of cases) {
        n += 1;
        const c: any = await parties.create(COMPANY, MGR, 'customer', {
          code: `M${n}`, nameEn: `M ${n}`, paymentTermMethod: method, paymentTermDays: days, ...(config ? { paymentTermConfig: config } : {}),
        });
        expect(c.paymentTermMethod).toBe(method);
        expect(c.paymentTermDays).toBe(days);
        if (config) expect(c.paymentTermConfig).toMatchObject(config);
      }
      expect(n).toBe(12);
    });

    it('refuses a method with missing or inconsistent settings, naming the field', async () => {
      await expect(parties.create(COMPANY, MGR, 'customer', { code: 'X1', nameEn: 'x', paymentTermMethod: 'FIXED_DAY_NEXT_MONTH' })).rejects.toBeDefined();
      await expect(
        parties.create(COMPANY, MGR, 'customer', { code: 'X2', nameEn: 'x', paymentTermMethod: 'INSTALLMENTS', paymentTermConfig: { installments: [{ percent: 40, afterDays: 0 }, { percent: 40, afterDays: 9 }] } }),
      ).rejects.toBeDefined();
      expect(await prisma.customer.count({ where: { code: { in: ['X1', 'X2'] } } })).toBe(0);
    });

    it('the last chosen method is the default for the next new customer of the same company', async () => {
      await parties.create(COMPANY, MGR, 'customer', {
        code: 'L1', nameEn: 'L1', paymentTermMethod: 'FROM_MONTH_END', paymentTermDays: 15,
      });
      expect((await parties.termDefaults(COMPANY)).paymentTermMethod).toBe('FROM_MONTH_END');
      const next: any = await parties.create(COMPANY, MGR, 'customer', { code: 'L2', nameEn: 'L2', paymentTermDays: 15 });
      expect(next.paymentTermMethod).toBe('FROM_MONTH_END');
      // the user can change it: choosing another method becomes the new default
      const changed: any = await parties.create(COMPANY, MGR, 'customer', { code: 'L3', nameEn: 'L3', paymentTermMethod: 'COD_ADVANCE' });
      expect(changed.paymentTermMethod).toBe('COD_ADVANCE');
      expect((await parties.termDefaults(COMPANY)).paymentTermMethod).toBe('COD_ADVANCE');
    });

    it('the default is kept per company', async () => {
      const OTHER_CO = '99999999-9999-4999-8999-999999999999';
      await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt","deletedAt") VALUES ('${OTHER_CO}','CO2','Other','أخرى',now(),now())`);
      expect((await parties.termDefaults(OTHER_CO)).paymentTermMethod).toBe('FROM_INVOICE_DATE');
      const c: any = await parties.create(OTHER_CO, MGR, 'customer', { code: 'O1', nameEn: 'O1' });
      expect(c.paymentTermMethod).toBe('FROM_INVOICE_DATE');
      expect((await parties.termDefaults(COMPANY)).paymentTermMethod).toBe('COD_ADVANCE');
    });

    it('editing days alone keeps the method and its settings; editing the method validates the new settings', async () => {
      const c: any = await parties.create(COMPANY, MGR, 'customer', {
        code: 'E1', nameEn: 'E1', paymentTermMethod: 'FIXED_DAY_NEXT_MONTH', paymentTermConfig: { dayOfMonth: 10 },
      });
      const u: any = await parties.update(COMPANY, MGR, 'customer', c.id, { paymentTermDays: 5 });
      expect(u.paymentTermMethod).toBe('FIXED_DAY_NEXT_MONTH');
      expect(u.paymentTermConfig).toEqual({ dayOfMonth: 10 });
      expect(u.paymentTermDays).toBe(5);
      await expect(parties.update(COMPANY, MGR, 'customer', c.id, { paymentTermMethod: 'WEEKLY_CUTOFF' })).rejects.toBeDefined();
      const w: any = await parties.update(COMPANY, MGR, 'customer', c.id, { paymentTermMethod: 'WEEKLY_CUTOFF', paymentTermConfig: { weekday: 0 } });
      expect(w.paymentTermMethod).toBe('WEEKLY_CUTOFF');
      expect(w.paymentTermConfig).toEqual({ weekday: 0 });
    });
  });

  describe('the due date an invoice receives', () => {
    const due = (customerId: string, invoiceDate: string, delivery: string | null = null) =>
      (SalesInvoicesService.prototype as any).dueFromTerms.call({ prisma }, COMPANY, customerId, invoiceDate, delivery);

    it('no terms: no due date (as before)', async () => {
      expect(await due(PLAIN, '2026-03-01')).toEqual({ dueDate: null, dueSchedule: null });
    });
    it('30 days from the invoice date', async () => {
      const r = await due(TERMS, '2026-01-31');
      expect(r.dueDate.toISOString().slice(0, 10)).toBe('2026-03-02');
      expect(r.dueSchedule).toBeNull();
    });
    it('installments store every share; the due date is the first', async () => {
      const r = await due(INST, '2026-01-20');
      expect(r.dueDate.toISOString().slice(0, 10)).toBe('2026-01-20');
      expect(r.dueSchedule).toEqual([{ dueDate: '2026-01-20', percent: 30 }, { dueDate: '2026-03-06', percent: 70 }]);
    });
    it('delivery date method uses the delivery date, and the invoice date without one', async () => {
      const c: any = await parties.create(COMPANY, MGR, 'customer', { code: 'DD', nameEn: 'DD', paymentTermMethod: 'FROM_DELIVERY_DATE', paymentTermDays: 14 });
      expect((await due(c.id, '2026-03-01', '2026-03-10')).dueDate.toISOString().slice(0, 10)).toBe('2026-03-24');
      expect((await due(c.id, '2026-03-01')).dueDate.toISOString().slice(0, 10)).toBe('2026-03-15');
    });
    it('a customer whose stored terms cannot apply gets a clear refusal, not a wrong date', async () => {
      await expect(due(TERMS, '2026-02-30')).rejects.toBeDefined();
    });
  });

  describe('posting for a customer past the agreed payment period', () => {
    it('a customer with no terms is never blocked, whatever they owe', async () => {
      await inv(id(1), 'OLD-1', 500, 'POSTED', PLAIN, { due: day(-90) });
      await inv(id(2), 'NEW-1', 100, 'DRAFT', PLAIN);
      await post(id(2));
    });

    it('overdue means before the invoice date: due today is still on time', async () => {
      await inv(id(3), 'T-1', 500, 'POSTED', TERMS, { due: day(0) });
      await inv(id(4), 'T-N1', 100, 'DRAFT', TERMS);
      await post(id(4));
    });

    it('blocks when an earlier invoice is past its due date, and says how much', async () => {
      await inv(id(5), 'T-2', 800, 'POSTED', TERMS, { due: day(-10), paid: 300 });
      const e: any = await post(id(4)).catch((x: any) => x);
      expect(e.response.code).toBe('CUSTOMER_PAYMENT_TERM_EXCEEDED');
      expect(e.response.message).toContain('1 overdue');
      expect(e.response.message).toContain('500.0000');
      expect(e.response.message).toContain(day(-10));
    });

    it('without permission to read the card the figures are withheld', async () => {
      const e: any = await post(id(4), false).catch((x: any) => x);
      expect(e.response).toEqual({
        code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED',
        message: 'This customer is past the agreed payment period. The invoice needs approval before it can be posted.',
      });
    });

    it('another customer’s overdue invoices do not block this customer', async () => {
      await inv(id(6), 'P-N', 100, 'DRAFT', PLAIN);
      await post(id(6));
    });

    it('a fully paid, drafted or deleted invoice is not overdue', async () => {
      await run(`UPDATE sales_invoices SET "paidAmount"=800 WHERE id='${id(5)}'`);
      await post(id(4));
      await run(`UPDATE sales_invoices SET "paidAmount"=300 WHERE id='${id(5)}'`);
      await expect(post(id(4))).rejects.toMatchObject({ response: { code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED' } });
      await run(`UPDATE sales_invoices SET status='DRAFT' WHERE id='${id(5)}'`);
      await post(id(4));
      await run(`UPDATE sales_invoices SET status='POSTED', "deletedAt"=now() WHERE id='${id(5)}'`);
      await post(id(4));
      await run(`UPDATE sales_invoices SET "deletedAt"=NULL WHERE id='${id(5)}'`);
      await expect(post(id(4))).rejects.toMatchObject({ response: { code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED' } });
    });

    it('approval: a written reason, someone other than the creator, one invoice', async () => {
      await run(`UPDATE sales_invoices SET "createdBy"='${CREATOR}' WHERE id='${id(4)}'`);
      await expect(credit.approvePeriod(COMPANY, MGR, id(4), 'x')).rejects.toThrow(/reason/);
      await expect(credit.approvePeriod(COMPANY, CREATOR, id(4), 'my own exception')).rejects.toThrow(/cannot approve/);
      await inv(id(11), 'P-N2', 100, 'DRAFT', PLAIN);
      await expect(credit.approvePeriod(COMPANY, MGR, id(11), 'not needed')).rejects.toThrow(/does not need/);
      await credit.approvePeriod(COMPANY, MGR, id(4), 'Customer promised to pay on Sunday');
      expect(audited.some((a) => a.action === 'PAYMENT_TERM_OVERRIDE' && a.userId === MGR && a.entityId === id(4))).toBe(true);
      await post(id(4));
    });

    it('the approval does not cover another invoice, a larger overdue amount or an edited invoice', async () => {
      await inv(id(7), 'T-N2', 50, 'DRAFT', TERMS);
      await expect(post(id(7))).rejects.toMatchObject({ response: { code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED' } });
      await inv(id(8), 'T-3', 100, 'POSTED', TERMS, { due: day(-1) });
      await expect(post(id(4))).rejects.toMatchObject({ response: { code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED' } });
      await credit.approvePeriod(COMPANY, MGR, id(4), 'Approved again for the larger amount');
      await post(id(4));
      await run(`UPDATE sales_invoices SET "updatedAt"=now() + interval '1 second' WHERE id='${id(4)}'`);
      await expect(post(id(4))).rejects.toMatchObject({ response: { code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED' } });
    });

    it('once the customer pays, no approval is needed any more', async () => {
      await run(`UPDATE sales_invoices SET "paidAmount"="totalAmount" WHERE "customerId"='${TERMS}' AND status='POSTED'`);
      await post(id(4));
      await post(id(7));
    });
  });

  describe('installments: only the shares already due count', () => {
    const schedule = [{ dueDate: day(-5), percent: 30 }, { dueDate: day(40), percent: 70 }];
    it('the first share is overdue, the second is not yet', async () => {
      await inv(id(20), 'I-1', 1000, 'POSTED', INST, { due: day(-5), schedule });
      await inv(id(21), 'I-N', 100, 'DRAFT', INST);
      const e: any = await post(id(21)).catch((x: any) => x);
      expect(e.response.code).toBe('CUSTOMER_PAYMENT_TERM_EXCEEDED');
      expect(e.response.message).toContain('300.0000');
    });
    it('paying the first share clears it', async () => {
      await run(`UPDATE sales_invoices SET "paidAmount"=300 WHERE id='${id(20)}'`);
      await post(id(21));
    });
    it('a part payment of the first share leaves the rest overdue', async () => {
      await run(`UPDATE sales_invoices SET "paidAmount"=100 WHERE id='${id(20)}'`);
      const e: any = await post(id(21)).catch((x: any) => x);
      expect(e.response.message).toContain('200.0000');
    });
    it('both shares past due: the whole unpaid amount', async () => {
      await run(`UPDATE sales_invoices SET "dueSchedule"='${JSON.stringify([{ dueDate: day(-50), percent: 30 }, { dueDate: day(-5), percent: 70 }])}'::jsonb, "dueDate"='${day(-50)}', "paidAmount"=100 WHERE id='${id(20)}'`);
      const e: any = await post(id(21)).catch((x: any) => x);
      expect(e.response.message).toContain('900.0000');
      expect(e.response.message).toContain(day(-50));
    });
  });

  describe('late-payment penalty is reported with the overdue figures', () => {
    it('a customer with a penalty setting sees the accrued penalty', async () => {
      const PEN = 'c0000000-0000-4000-8000-000000000009';
      await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","paymentTermDays","paymentTermMethod","paymentTermConfig","updatedAt")
        VALUES ('${PEN}','${COMPANY}','CP','Pen','غرامة',30,'LATE_PENALTY','{"penalty":{"percent":1,"period":"DAY","graceDays":0}}'::jsonb,now())`);
      await inv(id(30), 'PEN-1', 1000, 'POSTED', PEN, { due: day(-10) });
      await inv(id(31), 'PEN-N', 10, 'DRAFT', PEN);
      const e: any = await post(id(31)).catch((x: any) => x);
      expect(e.response.message).toContain('late penalty so far 100.0000');
    });
  });
});
