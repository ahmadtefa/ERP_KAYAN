import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { BatchesService } from '../inventory/batches.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { AuditService } from '../../common/audit/audit.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { PartiesService } from '../parties/parties.service';
import { Prisma } from '@prisma/client';

import { CustomerCreditService } from './customer-credit.service';
import { SalesInvoicesService } from './sales-invoices.service';

/// The production SalesInvoicesService.post() with the real credit service,
/// real posting/ledger/audit collaborators, on a real migrated PostgreSQL over
/// separate connections (so row locks really contend). Needs DATABASE_URL and
/// must run alone against that database (`jest -i`): it truncates companies.
/// The only stand-in is the company tax policy (zero rate), as in the sibling
/// posting suite.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CREATOR = '33333333-3333-4333-8333-333333333333';
const APPROVER = '33333333-3333-4333-8333-333333333334';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const ACCOUNTS: Array<[string, string, string]> = [
  ['1103', 'Accounts receivable', 'ASSET'], ['4101', 'Sales revenue', 'REVENUE'], ['2103', 'VAT payable', 'LIABILITY'],
  ['1104', 'Inventory', 'ASSET'], ['5101', 'Cost of goods sold', 'EXPENSE'],
];
const inv = (n: number) => `77777777-7777-4777-8777-00000000000${n}`;

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

(vmReady ? describe : describe.skip)('post() with the credit limit, real PostgreSQL, real collaborators', () => {
  let prisma: any;
  let service: SalesInvoicesService;
  let credit: CustomerCreditService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const count = async (sql: string) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
  const status = async (id: string) => (await prisma.$queryRawUnsafe(`SELECT status::text AS s FROM sales_invoices WHERE id='${id}'`))[0].s;
  const journals = (id: string) => count(`SELECT count(*)::int AS n FROM journal_entries WHERE "sourceId"='${id}'`);

  async function draftInvoice(n: number, total: number) {
    await run(`INSERT INTO sales_invoices (id,"companyId","branchId","warehouseId","invoiceNumber","invoiceDate","customerId",status,currency,"subTotal","taxAmount","totalAmount","paidAmount","costOfGoods","documentType","createdBy","updatedAt")
      VALUES ('${inv(n)}','${COMPANY}','${BRANCH}','${WAREHOUSE}','SI-000${n}','2026-11-07','${CUSTOMER}','DRAFT','EGP',${total},0,${total},0,0,'INVOICE','${CREATOR}',now())`);
    await run(`INSERT INTO sales_invoice_lines (id,"invoiceId","lineNumber","itemId",description,quantity,"unitPrice","taxRate","taxAmount","lineTotal","unitCost","costTotal")
      VALUES (gen_random_uuid(),'${inv(n)}',1,'${ITEM}','Milk',${total / 10},10,0,0,${total},0,0)`);
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 8 }) });
    await run('TRUNCATE companies CASCADE');
    const acc = ACCOUNTS.map(([code, name, type]) => `INSERT INTO accounts (id,"companyId",code,"nameEn","nameAr",type,"isPostable","isActive","updatedAt") VALUES ('99999999-9999-4999-8999-${code.padStart(12, '0')}','${COMPANY}','${code}','${name}','${name}','${type}',true,true,now());`).join('');
    for (const sql of [
      `INSERT INTO companies (id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Co','شركة',now())`,
      `INSERT INTO branches (id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','BR','Branch','فرع',now())`,
      `INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${WAREHOUSE}','${COMPANY}','${BRANCH}','W1','Main','رئيسي',true,true,now())`,
      `INSERT INTO customers (id,"companyId",code,"nameEn","nameAr","isActive","creditLimit","updatedAt") VALUES ('${CUSTOMER}','${COMPANY}','C-1','Buyer','مشتري',true,1000,now())`,
      `INSERT INTO users (id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${CREATOR}','${COMPANY}','creator','Creator','منشئ','x',now()),('${APPROVER}','${COMPANY}','approver','Approver','معتمد','x',now())`,
      `INSERT INTO items (id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","requiresBatch","useFefo","allowExpiredIssue","salePrice","updatedAt") VALUES ('${ITEM}','${COMPANY}','IT-1','Milk','حليب','piece',true,false,false,false,10,now())`,
      acc,
      `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt") VALUES ('${COMPANY}','${BRANCH}','${ITEM}',1000,5000,now())`,
      `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt") VALUES ('${COMPANY}','${BRANCH}','${WAREHOUSE}','${ITEM}',1000,5000,now())`,
    ]) await run(sql);
    const ledger = new StockLedgerService();
    const audit = new AuditService(prisma as never);
    const parties = new PartiesService(prisma as never, audit as never);
    credit = new CustomerCreditService(prisma as never, parties, audit as never);
    const batches = new BatchesService(prisma as never, {} as never, {} as never, {} as never, {} as never, audit as never, ledger);
    const posting = new PostingService(new DocumentNumberService(), new FiscalPeriodsService(prisma as never, audit as never), new CostCentersService(prisma as never, audit as never));
    service = new SalesInvoicesService(
      prisma as never, new DocumentNumberService(), posting, new AccountMapService(),
      { get: async () => ({ defaultTaxRate: new Prisma.Decimal(0), pricesIncludeTax: false }) } as never,
      new WarehouseService(prisma as never, audit as never), {} as never, audit as never, batches, ledger, credit,
    );
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('an over-limit post is refused whole: 409, invoice still DRAFT, no journal, no stock movement; no figures without the right', async () => {
    await draftInvoice(1, 1200);
    const hidden = await service.post(COMPANY, CREATOR, inv(1), true, undefined, { mayDiscloseBalance: false }).catch((e: any) => e);
    expect(hidden.getStatus?.()).toBe(409);
    expect(hidden.response).toEqual({ code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED', message: 'This invoice needs credit approval before it can be posted.' });
    const shown = await service.post(COMPANY, CREATOR, inv(1), true, undefined, { mayDiscloseBalance: true }).catch((e: any) => e);
    expect(shown.response.projectedBalance).toBe('1200.0000');
    expect(await status(inv(1))).toBe('DRAFT');
    expect(await journals(inv(1))).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM stock_movements WHERE "referenceId"='${inv(1)}'`)).toBe(0);
  });

  it('the creator cannot approve it; another holder can without any posting right; then the real post succeeds, once', async () => {
    await expect(credit.approve(COMPANY, CREATOR, inv(1), 'my own exception')).rejects.toThrow(/cannot approve/);
    await credit.approve(COMPANY, APPROVER, inv(1), 'Big order, finance agreed');
    expect(await status(inv(1))).toBe('DRAFT'); // approving does not post
    const posted = await service.post(COMPANY, CREATOR, inv(1));
    expect(posted.status).toBe('posted');
    expect(await journals(inv(1))).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action='CREDIT_LIMIT_OVERRIDE'`)).toBe(1);
  });

  it('an approval does not survive an edit: amount changed and changed back still needs a new approval', async () => {
    await run(`UPDATE customers SET "creditLimit"=100000 WHERE id='${CUSTOMER}'`);
    await draftInvoice(2, 500);
    await run(`UPDATE customers SET "creditLimit"=1300 WHERE id='${CUSTOMER}'`); // posted 1200 + 500 > 1300
    await credit.approve(COMPANY, APPROVER, inv(2), 'ok for now');
    await run(`UPDATE sales_invoices SET "totalAmount"=600,"updatedAt"=now() WHERE id='${inv(2)}'`);
    await run(`UPDATE sales_invoices SET "totalAmount"=500,"updatedAt"=now() WHERE id='${inv(2)}'`);
    const refused = await service.post(COMPANY, CREATOR, inv(2)).catch((e: any) => e);
    expect(refused.getStatus?.()).toBe(409);
    expect(await status(inv(2))).toBe('DRAFT');
  });

  it('two real posts racing for one customer: exactly one invoice is posted, one journal, the other 409', async () => {
    await run(`UPDATE sales_invoices SET "deletedAt"=now() WHERE id='${inv(2)}'`);
    await run(`UPDATE customers SET "creditLimit"=2000 WHERE id='${CUSTOMER}'`); // posted 1200 owed
    await draftInvoice(3, 500);
    await draftInvoice(4, 500);
    const results = await Promise.all([3, 4].map((n) => service.post(COMPANY, CREATOR, inv(n)).then(() => 'posted', (e: any) => e.response?.code ?? String(e))));
    expect(results.sort()).toEqual(['CUSTOMER_CREDIT_LIMIT_EXCEEDED', 'posted']);
    expect(await journals(inv(3)) + (await journals(inv(4)))).toBe(1);
    expect([await status(inv(3)), await status(inv(4))].sort()).toEqual(['DRAFT', 'POSTED']);
  });
});
