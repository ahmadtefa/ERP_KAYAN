import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AuditService } from '../../common/audit/audit.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { BatchesService } from '../inventory/batches.service';
import { QuotationsService } from './quotations.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersService } from './sales-orders.service';

/// Order and quotation conversion over a real migrated PostgreSQL: a conversion
/// that would invoice more than the branch holds must refuse and leave every
/// table exactly as it was. The mocked sibling (quotations.conversion-atomic)
/// proves the failure path in memory; this proves it against real rows.
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WH = '33333333-3333-4333-8333-333333333333';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const ITEM = 'a0000000-0000-4000-8000-000000000001';
const USER = '44444444-4444-4444-8444-444444444444';
const ORDER = 'b0000000-0000-4000-8000-000000000001';
const OLINE = 'b0000000-0000-4000-8000-000000000002';
const QUOTE = 'e0000000-0000-4000-8000-000000000001';
const QTABLE = 'e0000000-0000-4000-8000-000000000002';
const QLINE = 'e0000000-0000-4000-8000-000000000003';

jest.setTimeout(120_000);
const ready =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

(ready ? describe : describe.skip)('order and quotation conversion above stock (real schema)', () => {
  let prisma: any;
  let orders: SalesOrdersService;
  let quotes: QuotationsService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const count = async (table: string) => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM ${table}`))[0].n);
  const snapshot = async () => ({
    invoices: await count('sales_invoices'),
    invoiceLines: await count('sales_invoice_lines'),
    audit: await count('audit_logs'),
    orderLine: await prisma.$queryRawUnsafe(`SELECT "invoicedQuantity"::text q FROM sales_order_lines WHERE id='${OLINE}'`),
    order: await prisma.$queryRawUnsafe(`SELECT status::text s FROM sales_orders WHERE id='${ORDER}'`),
    quote: await prisma.$queryRawUnsafe(`SELECT status::text s, "convertedInvoiceId" c FROM quotations WHERE id='${QUOTE}'`),
    stock: await prisma.$queryRawUnsafe(`SELECT quantity::text q FROM stock_balances WHERE "itemId"='${ITEM}'`),
  });
  const failure = async (work: Promise<unknown>) => {
    try { await work; return null; } catch (e) { return e as { response?: any; message?: string }; }
  };
  const setQty = async (qty: number) => {
    await run(`UPDATE sales_order_lines SET quantity=${qty}, "lineTotal"=${qty * 10} WHERE id='${OLINE}'`);
    await run(`UPDATE quotation_lines SET quantity=${qty}, "lineTotal"=${qty * 10} WHERE id='${QLINE}'`);
    await run(`UPDATE quotation_tables SET "subTotal"=${qty * 10}, "netTotal"=${qty * 10} WHERE id='${QTABLE}'`);
    await run(`UPDATE quotations SET "subTotal"=${qty * 10}, "totalAmount"=${qty * 10} WHERE id='${QUOTE}'`);
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Co','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','BR','Branch','فرع',now())`);
    await run(`INSERT INTO warehouses(id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${WH}','${COMPANY}','${BRANCH}','W1','Main','رئيسي',true,true,now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","isActive","updatedAt") VALUES ('${CUST}','${COMPANY}','C-1','Buyer','مشتري',true,now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','tester','Tester','مختبر','x',now())`);
    await run(`INSERT INTO items(id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","requiresBatch","useFefo","allowExpiredIssue","salePrice","updatedAt") VALUES ('${ITEM}','${COMPANY}','IT-1','Milk','حليب','piece',true,false,false,false,10,now())`);
    await run(`INSERT INTO stock_balances("companyId","branchId","itemId",quantity,value,"updatedAt") VALUES ('${COMPANY}','${BRANCH}','${ITEM}',40,200,now())`);
    await run(`INSERT INTO warehouse_stock_balances("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt") VALUES ('${COMPANY}','${BRANCH}','${WH}','${ITEM}',40,200,now())`);
    await run(`INSERT INTO sales_orders(id,"companyId","branchId","customerId","orderNumber","orderDate",status,"subTotal","totalAmount","updatedAt") VALUES ('${ORDER}','${COMPANY}','${BRANCH}','${CUST}','SO-1','2026-11-07','APPROVED',410,410,now())`);
    await run(`INSERT INTO sales_order_lines(id,"orderId","lineNumber","itemId",description,quantity,"unitPrice","lineTotal") VALUES ('${OLINE}','${ORDER}',1,'${ITEM}','Milk',41,10,410)`);
    await run(`INSERT INTO quotations(id,"companyId","branchId","quotationNumber","quotationDate","customerId",status,"subTotal","totalAmount","updatedAt") VALUES ('${QUOTE}','${COMPANY}','${BRANCH}','Q-1','2026-11-07','${CUST}','ACCEPTED',410,410,now())`);
    await run(`INSERT INTO quotation_tables(id,"quotationId",title,"sortOrder","subTotal","netTotal") VALUES ('${QTABLE}','${QUOTE}','Goods',1,410,410)`);
    await run(`INSERT INTO quotation_lines(id,"tableId","lineNumber","itemId",description,quantity,"unitPrice","lineTotal") VALUES ('${QLINE}','${QTABLE}',1,'${ITEM}','Milk',41,10,410)`);

    const audit = new AuditService(prisma as never);
    const ledger = new StockLedgerService();
    const batches = new BatchesService(prisma as never, {} as never, {} as never, {} as never, {} as never, audit as never, ledger);
    const posting = new PostingService(new DocumentNumberService(), new FiscalPeriodsService(prisma as never, audit as never), new CostCentersService(prisma as never, audit as never));
    const settings: any = { get: async () => ({ defaultTaxRate: 0, taxRate: '0.0000', maxDiscountPercent: '100.0000', pricesIncludeTax: false }) };
    const invoices = new SalesInvoicesService(
      prisma as never, new DocumentNumberService(), posting, new AccountMapService(), settings,
      new WarehouseService(prisma as never, audit as never), {} as never, audit as never, batches, ledger,
      { assertCanPost: async () => undefined, assertPeriodCanPost: async () => undefined } as never,
    );
    orders = new SalesOrdersService(prisma as never, new DocumentNumberService(), settings, {} as never, invoices, audit as never);
    quotes = new QuotationsService(prisma as never, new DocumentNumberService(), settings, invoices, audit as never);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('order conversion above the branch balance refuses and changes nothing; at the balance it succeeds', async () => {
    const before = await snapshot();
    const err = await failure(orders.convertToInvoice(COMPANY, BRANCH, USER, ORDER, {
      idempotencyKey: 'conv-order-over-0001', lines: [{ orderLineId: OLINE, quantity: '41' }],
    }, true, { mayReadStock: true }));
    expect(err?.response?.code).toBe('SALES_SAVE_STOCK_SHORT');
    expect(await snapshot()).toEqual(before);

    await setQty(40);
    const ok: any = await orders.convertToInvoice(COMPANY, BRANCH, USER, ORDER, {
      idempotencyKey: 'conv-order-fits-00001', lines: [{ orderLineId: OLINE, quantity: '40' }],
    }, true, { mayReadStock: true });
    expect(ok.invoice.id).toBeDefined();
    const after = await snapshot();
    expect(after.invoices).toBe(1);
    expect(after.orderLine[0].q).toBe('40.0000');
    expect(after.order[0].s).toBe('FULFILLED');
  });

  it('quotation conversion above the branch balance refuses and leaves the quotation accepted and unlinked', async () => {
    await run('DELETE FROM sales_invoice_lines');
    await run('DELETE FROM sales_invoices');
    await setQty(41);
    const before = await snapshot();
    const err = await failure(quotes.convert(COMPANY, BRANCH, USER, QUOTE, { invoiceDate: '2026-11-07' }, { mayReadStock: true }));
    expect(err?.response?.code).toBe('SALES_SAVE_STOCK_SHORT');
    const after = await snapshot();
    expect(after.quote[0]).toEqual({ s: 'ACCEPTED', c: null });
    expect(after).toEqual(before);
  });

  it('an unknown warehouse refuses the conversion without a partial effect', async () => {
    await setQty(40);
    const before = await snapshot();
    const err = await failure(quotes.convert(COMPANY, BRANCH, USER, QUOTE, {
      invoiceDate: '2026-11-07', warehouseId: '99999999-9999-4999-8999-999999999999',
    }, { mayReadStock: true }));
    expect(err).not.toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('at the balance the quotation converts once and is linked to its invoice', async () => {
    const res: any = await quotes.convert(COMPANY, BRANCH, USER, QUOTE, { invoiceDate: '2026-11-07' }, { mayReadStock: true });
    expect(res).toBeDefined();
    const after = await snapshot();
    expect(after.quote[0].s).toBe('CONVERTED');
    expect(after.quote[0].c).not.toBeNull();
    expect(after.invoices).toBe(1);
  });
});
