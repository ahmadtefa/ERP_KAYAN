import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PartiesService } from '../parties/parties.service';
import { CustomerCreditService } from './customer-credit.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000002';
const ACC = 'a0000000-0000-4000-8000-000000000001';
const MGR = '33333333-3333-4333-8333-333333333332';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Customer credit limit at posting, against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('customer credit limit at posting (real schema)', () => {
  let prisma: any;
  let credit: CustomerCreditService;
  let audited: any[];
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const invoice = (id: string, no: string, total: number, status: string, type = 'INVOICE', cust = CUST, paid = 0) =>
    run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","totalAmount","paidAmount") VALUES ('${id}','${COMPANY}','${BRANCH}','${no}',current_date,'${cust}',now(),'${status}','${type}',${total},${paid})`);
  const draft = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;
  const post = (id: string) => prisma.$transaction((tx: any) => credit.assertCanPost(tx, COMPANY, id, true));
  const setLimit = (v: number) => run(`UPDATE customers SET "creditLimit"=${v} WHERE id='${CUST}'`);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","creditLimit","updatedAt") VALUES ('${CUST}','${COMPANY}','C1','Cust','عميل',1000,now()),('${OTHER}','${COMPANY}','C2','Other','آخر',0,now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES ('${ACC}','${COMPANY}','1000','Cash','نقدية','ASSET',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId",code,"nameEn","nameAr","accountId","updatedAt") VALUES ('${ACC}','${COMPANY}','CA','Cash','خزنة','${ACC}',now())`);
    audited = [];
    const audit: any = { record: async (i: unknown) => { audited.push(i); } };
    const parties = new PartiesService(prisma as never, audit);
    credit = new CustomerCreditService(prisma as never, parties, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('zero limit means no limit; drafts and other statuses never count', async () => {
    await invoice(draft(1), 'D-1', 999999, 'DRAFT', 'INVOICE', OTHER);
    await post(draft(1));
    await invoice(draft(2), 'D-2', 400, 'DRAFT'); // another draft of CUST: not counted
    await invoice(draft(3), 'D-3', 1000, 'DRAFT');
    await post(draft(3)); // exactly at the limit is allowed
  });

  it('blocks a posting that would pass the limit, counting posted balance, credit notes and unpaid remainder only', async () => {
    await invoice('e0000000-0000-4000-8000-000000000001', 'P-1', 700, 'POSTED', 'INVOICE', CUST, 200); // owes 500
    await invoice('e0000000-0000-4000-8000-000000000002', 'CN-1', 100, 'POSTED', 'CREDIT_NOTE'); // -100
    // balance 400; draft D-3 (1000) would make 1400 > 1000
    await expect(post(draft(3))).rejects.toMatchObject({ response: { code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED', currentBalance: '400.0000', invoiceAmount: '1000.0000', projectedBalance: '1400.0000', creditLimit: '1000.0000' } });
    await invoice(draft(4), 'D-4', 600, 'DRAFT'); // 400 + 600 = 1000, allowed
    await post(draft(4));
    // a paid-up part of the draft itself is not double counted
    await invoice(draft(5), 'D-5', 900, 'DRAFT', 'INVOICE', CUST, 300); // 400 + 600
    await post(draft(5));
  });

  it('an approval is for one invoice and dies when the amount or customer changes', async () => {
    await expect(credit.approve(COMPANY, MGR, draft(3), 'x')).rejects.toThrow(/reason/);
    await expect(credit.approve(COMPANY, MGR, draft(4), 'fine now')).rejects.toThrow(/does not need credit approval/);
    await credit.approve(COMPANY, MGR, draft(3), 'Approved by finance, large order');
    expect(audited.some((a) => a.action === 'CREDIT_LIMIT_OVERRIDE' && a.userId === MGR && a.entityId === draft(3))).toBe(true);
    await post(draft(3));
    await run(`UPDATE sales_invoices SET "totalAmount"=1001 WHERE id='${draft(3)}'`);
    await expect(post(draft(3))).rejects.toMatchObject({ response: { code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED' } });
    await run(`UPDATE sales_invoices SET "totalAmount"=1000 WHERE id='${draft(3)}'`);
    await post(draft(3));
    await run(`UPDATE sales_invoices SET "customerId"='${OTHER}' WHERE id='${draft(3)}'`);
    await post(draft(3)); // other customer has no limit
    await run(`UPDATE sales_invoices SET "customerId"='${CUST}' WHERE id='${draft(3)}'`);
    await run(`UPDATE sales_invoice_credit_approvals SET "customerId"='${OTHER}' WHERE "invoiceId"='${draft(3)}'`);
    await expect(post(draft(3))).rejects.toMatchObject({ response: { code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED' } });
  });

  it('a received payment lowers the balance, and zero afterwards disables the check', async () => {
    await run(`INSERT INTO cash_vouchers(id,"companyId","branchId","voucherNumber","voucherDate",kind,"cashAccountId",amount,"updatedAt",status,"customerId") VALUES ('f0000000-0000-4000-8000-000000000001','${COMPANY}','${BRANCH}','R-1',current_date,'RECEIPT','${ACC}',500,now(),'POSTED','${CUST}')`);
    await invoice(draft(6), 'D-6', 1000, 'DRAFT');
    const parties = new PartiesService(prisma as never, { record: async () => undefined } as never);
    const figs = await parties.balanceFigures(COMPANY, 'customer', CUST);
    expect(figs.netBalance.toFixed(4)).toBe('-100.0000'); // 400 owed less 500 on account
    await post(draft(6)); // -100 + 1000 = 900 <= 1000
    await setLimit(0);
    await post(draft(3));
  });

  it('self-approval is refused; approval does not survive an edit-and-revert or a larger exposure; figures are withheld without scope; branch scope applies', async () => {
    await setLimit(1000);
    const OTHER_BRANCH = '22222222-2222-4222-8222-222222222299';
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${OTHER_BRANCH}','${COMPANY}','B','B','ب',now())`);
    const CREATOR = '33333333-3333-4333-8333-333333333399';
    await run('DELETE FROM cash_vouchers');
    const bal = (await new PartiesService(prisma as never, { record: async () => undefined } as never).balanceFigures(COMPANY, 'customer', CUST)).netBalance;
    const total = 1000 - Number(bal) + 50; // always over the limit
    await invoice(draft(7), 'D-7', total, 'DRAFT');
    await run(`UPDATE sales_invoices SET "createdBy"='${CREATOR}' WHERE id='${draft(7)}'`);
    // without permission to read the card the failure is confidential
    const hidden = await prisma.$transaction((tx: any) => credit.assertCanPost(tx, COMPANY, draft(7), false)).catch((e: any) => e);
    expect(hidden.response).toEqual({ code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED', message: 'This invoice needs credit approval before it can be posted.' });
    const shown = await prisma.$transaction((tx: any) => credit.assertCanPost(tx, COMPANY, draft(7), true)).catch((e: any) => e);
    expect(shown.response.currentBalance).toBeDefined();
    // the creator cannot sign for it; an approver outside the branch scope cannot see it
    await expect(credit.approve(COMPANY, CREATOR, draft(7), 'my own exception')).rejects.toThrow(/cannot approve/);
    await expect(credit.approve(COMPANY, MGR, draft(7), 'second pair of eyes', [OTHER_BRANCH])).rejects.toThrow(/not found/i);
    // the approver needs no posting right: approve() only needs the invoice and a reason
    await credit.approve(COMPANY, MGR, draft(7), 'second pair of eyes', [BRANCH]);
    await post(draft(7));
    // edited and edited back: the row's updatedAt moved, so the approval is gone
    await run(`UPDATE sales_invoices SET "updatedAt"=now() + interval '1 second' WHERE id='${draft(7)}'`);
    await expect(post(draft(7))).rejects.toMatchObject({ response: { code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED' } });
    // re-approve, then the customer's exposure grows: not covered any more
    await credit.approve(COMPANY, MGR, draft(7), 'approved again', null);
    await post(draft(7));
    await invoice('e0000000-0000-4000-8000-000000000009', 'P-9', 25, 'POSTED');
    await expect(post(draft(7))).rejects.toMatchObject({ response: { code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED' } });
    // a smaller exposure stays covered
    await run(`UPDATE sales_invoices SET status='DRAFT', "totalAmount"=1 WHERE id='e0000000-0000-4000-8000-000000000009'`);
    await post(draft(7));
  });

  it('two postings for one customer at the same time: exactly one passes the check', async () => {
    await setLimit(1000);
    await run(`UPDATE sales_invoices SET status='DRAFT' WHERE "customerId"='${CUST}' AND status='POSTED' AND "documentType"='INVOICE'`);
    await run(`UPDATE sales_invoices SET "deletedAt"=now() WHERE "customerId"='${CUST}'`);
    await invoice('e1000000-0000-4000-8000-000000000001', 'Q-1', 700, 'DRAFT');
    await invoice('e1000000-0000-4000-8000-000000000002', 'Q-2', 700, 'DRAFT');
    // same sequence as post(): check, then claim, inside one transaction
    const attempt = (id: string) =>
      prisma.$transaction(async (tx: any) => {
        await credit.assertCanPost(tx, COMPANY, id, true);
        await tx.salesInvoice.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'POSTED' } });
        await new Promise((r) => setTimeout(r, 400));
      }).then(() => 'posted', (e: any) => e.response?.code ?? String(e));
    const results = await Promise.all([attempt('e1000000-0000-4000-8000-000000000001'), attempt('e1000000-0000-4000-8000-000000000002')]);
    expect(results.sort()).toEqual(['CUSTOMER_CREDIT_LIMIT_EXCEEDED', 'posted']);
  });
});
