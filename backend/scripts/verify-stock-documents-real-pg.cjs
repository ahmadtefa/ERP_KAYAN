'use strict';
// Run only inside verify-prisma-native-upgrade's disposable GitHub-hosted DB.
// Production StockDocumentsService, Prisma adapter, posting, warehouse,
// accounts and cost-center services all execute against real PostgreSQL.
// This is not an HTTP, Flutter, installed-product or licensing test.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || '');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    url.hostname !== '127.0.0.1' || url.port !== '5432' ||
    !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
    process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1)) {
  throw new Error('Stock fixture requires the explicitly named disposable GitHub PostgreSQL database');
}
if (process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  throw new Error('Prisma engine overrides are forbidden');
}
require('reflect-metadata');
require('ts-node/register/transpile-only');
const { Client } = require('pg');
const { PrismaService } = require('../src/common/prisma/prisma.service');
const { AuditService } = require('../src/common/audit/audit.service');
const { CompanySettingsService } = require('../src/common/settings/company-settings.module');
const { WarehouseService } = require('../src/common/warehouse/warehouse.service');
const { CostCentersService } = require('../src/modules/accounting/cost-centers.service');
const { FiscalPeriodsService } = require('../src/modules/accounting/fiscal-periods.service');
const { DocumentNumberService } = require('../src/modules/accounting/document-number.service');
const { AccountMapService } = require('../src/modules/accounting/account-map.service');
const { PostingService } = require('../src/modules/accounting/posting.service');
const { StockDocumentsService } = require('../src/modules/inventory/stock-documents.service');
const { ChartOfAccountsService } = require('../src/modules/accounting/chart-of-accounts.service');
const { StockService } = require('../src/modules/inventory/stock.service');
const { FinancialStatementsService } = require('../src/modules/reports/financial-statements.service');
const { PriceListsService } = require('../src/modules/sales/price-lists.service');
const { SalesOrdersService } = require('../src/modules/sales/sales-orders.service');
const { PurchaseOrdersService } = require('../src/modules/purchases/purchase-orders.service');
const { SalesInvoicesService } = require('../src/modules/sales/sales-invoices.service');
const { PurchaseInvoicesService } = require('../src/modules/purchases/purchase-invoices.service');

const company = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const item = '30000000-0000-4000-8000-000000000001';
const branch = '70000000-0000-4000-8000-000000000001';
const warehouse = '70000000-0000-4000-8000-000000000002';
const centre = '70000000-0000-4000-8000-000000000003';
let inventory = '70000000-0000-4000-8000-000000000004';
let difference = '70000000-0000-4000-8000-000000000005';

(async () => {
  const sql = new Client({ connectionString: url.toString() });
  const prisma = new PrismaService();
  try {
    await sql.connect();
    // The company, user and item were populated by the native upgrade fixture.
    await sql.query('INSERT INTO branches (id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [branch,company,'B','Synthetic branch','فرع تجريبي']);
    await sql.query('INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,true,now())', [warehouse,company,branch,'W','Synthetic warehouse','مخزن تجريبي']);
    await sql.query('INSERT INTO cost_centers (id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [centre,company,'CC','Synthetic center','مركز تجريبي']);
    // Upgrade migrations may already seed either conventional account. Reuse
    // its actual id rather than inserting a duplicate company/code pair.
    const accounts = await sql.query('INSERT INTO accounts (id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now()),($7,$2,$8,$9,$10,$11,now()) ON CONFLICT ("companyId",code) DO UPDATE SET "isActive"=true,"isPostable"=true,"deletedAt"=NULL,"updatedAt"=now() RETURNING id,code', [inventory,company,'1104','Inventory','مخزون','ASSET',difference,'5107','Inventory difference','فرق مخزون','EXPENSE']);
    inventory = accounts.rows.find(row => row.code === '1104').id;
    difference = accounts.rows.find(row => row.code === '5107').id;
    await prisma.$connect();
    const audit = new AuditService(prisma);
    const costCenters = new CostCentersService(prisma, audit);
    const numbers = new DocumentNumberService();
    const periods = new FiscalPeriodsService(prisma, audit);
    const service = new StockDocumentsService(prisma, numbers,
      new PostingService(numbers, periods, costCenters), new AccountMapService(), audit,
      new CompanySettingsService(prisma, audit), new WarehouseService(prisma, audit), costCenters);
    const date = '2026-10-28';
    // Real chart operations, not an HTTP or Flutter test. The fixture uses
    // unique synthetic codes and keeps historical journal rows untouched.
    const chart = new ChartOfAccountsService(prisma, audit);
    const stockReports = new StockService(prisma);
    const statements = new FinancialStatementsService(prisma);
    const root = await chart.create(company, user, { code:'SYN-ROOT', nameEn:'Synthetic root',
      nameAr:'حساب رئيسي تجريبي', type:'ASSET', isPostable:false });
    const child = await chart.create(company, user, { code:'SYN-CHILD', nameEn:'Synthetic child',
      nameAr:'حساب فرعي تجريبي', type:'ASSET', parentId:root.id, isPostable:true });
    assert.equal(child.parentId,root.id);
    await assert.rejects(chart.create(company,user,{code:'SYN-CHILD',nameEn:'Duplicate',nameAr:'مكرر',type:'ASSET'}), /already used/i);
    await assert.rejects(chart.update(company,user,root.id,{isActive:false}), /subaccounts/i);
    assert.equal((await chart.update(company,user,child.id,{isActive:false})).isActive,false);
    assert.equal((await chart.update(company,user,child.id,{isActive:true})).isActive,true);
    const hierarchy = await sql.query('SELECT "parentId", "isActive" FROM accounts WHERE id=$1', [child.id]);
    assert.equal(hierarchy.rows[0].parentId, root.id);
    assert.equal(hierarchy.rows[0].isActive, true);
    console.log('PASS: real PostgreSQL + Prisma chart create, child relationship, duplicate and activation rules.');

    const receipt = await service.create(company, branch, user, { kind:'ADJUSTMENT', documentDate:date,
      toWarehouseId:warehouse, reason:'Synthetic receipt', lines:[{itemId:item, quantity:'10', unitCost:'7.5'}] });
    await service.post(company, user, receipt.id);
    const issue = await service.create(company, branch, user, { kind:'ADJUSTMENT', documentDate:date,
      toWarehouseId:warehouse, costCenterId:centre, reason:'Synthetic issue',
      lines:[{itemId:item, quantity:'-4', unitCost:'1'}] });
    await service.post(company, user, issue.id);
    await assert.rejects(service.post(company, user, issue.id), /draft/i);
    const balance = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(balance.rows[0].quantity),6);
    assert.equal(Number(balance.rows[0].value),45);
    const movements = await sql.query('SELECT direction, quantity::text, "unitCost"::text, "totalCost"::text FROM stock_movements WHERE "referenceId"=$1 ORDER BY "createdAt"', [issue.id]);
    assert.equal(movements.rowCount,1);
    assert.equal(movements.rows[0].direction,'OUT');
    assert.equal(Number(movements.rows[0].quantity),4);
    assert.equal(Number(movements.rows[0].unitCost),7.5);
    assert.equal(Number(movements.rows[0].totalCost),30);
    const journal = await sql.query('SELECT l."accountId", l."costCenterId", l.debit::text, l.credit::text FROM journal_lines l JOIN journal_entries j ON j.id=l."journalEntryId" WHERE j."sourceId"=$1 ORDER BY l."lineNumber"', [issue.id]);
    assert.equal(journal.rowCount,2);
    assert(journal.rows.some(r => r.accountId === difference && r.costCenterId === centre && Number(r.debit) === 30));
    assert(journal.rows.some(r => r.accountId === inventory && Number(r.credit) === 30));
    const stockCard = await stockReports.itemLedger(company, item);
    assert.equal(stockCard.movements.length, 2);
    assert.equal(stockCard.movements.at(-1).runningQuantity, '6.0000');
    assert.equal(stockCard.movements.at(-1).runningValue, '45.0000');
    const warehouseReport = await stockReports.byWarehouse(company, {branchId: branch, itemIds: [item]});
    assert.equal(warehouseReport.find(row => row.itemId === item).total, '6.0000');
    const report = await statements.costCenterReport(company, {from: '2026-01-01', to: '2100-12-31', costCenterId: centre});
    assert.equal(report.items.find(row => row.costCenterId === centre).ownExpenses, '30.0000');
    assert.equal(report.reconciliation.balanced, true);
    const historyBefore = await sql.query('SELECT id, debit::text, credit::text FROM journal_lines WHERE "accountId"=$1 ORDER BY id', [inventory]);
    assert.equal((await chart.update(company,user,inventory,{isActive:false})).isActive,false);
    assert.equal((await chart.update(company,user,inventory,{isActive:true})).isActive,true);
    const historyAfter = await sql.query('SELECT id, debit::text, credit::text FROM journal_lines WHERE "accountId"=$1 ORDER BY id', [inventory]);
    assert.deepEqual(historyAfter.rows,historyBefore.rows);
    const excessive = await service.create(company, branch, user, { kind:'ADJUSTMENT', documentDate:date,
      toWarehouseId:warehouse, costCenterId:centre, lines:[{itemId:item, quantity:'-9'}] });
    await assert.rejects(service.post(company, user, excessive.id), /stock|warehouse/i);
    const status = await sql.query('SELECT status FROM stock_documents WHERE id=$1', [excessive.id]);
    assert.equal(status.rows[0].status, 'DRAFT');
    const after = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(after.rows[0].quantity),6);
    assert.equal(Number(after.rows[0].value),45);
    // A mismatched historic line cannot be assigned to a posted movement.
    // Reject the reversal and roll back its status and all balance writes.
    await sql.query('UPDATE stock_document_lines SET quantity=-5 WHERE "documentId"=$1', [issue.id]);
    await assert.rejects(service.reverse(company, user, issue.id), /missing or ambiguous/i);
    const stillPosted = await sql.query('SELECT status FROM stock_documents WHERE id=$1', [issue.id]);
    assert.equal(stillPosted.rows[0].status, 'POSTED');
    const unchanged = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(unchanged.rows[0].quantity),6);
    assert.equal(Number(unchanged.rows[0].value),45);
    // Emulate a legacy draft-line cost that disagrees with the immutable
    // posted movement. Reversal must use the movement's historical valuation.
    await sql.query('UPDATE stock_document_lines SET quantity=-4, "unitCost"=1 WHERE "documentId"=$1', [issue.id]);
    await service.reverse(company, user, issue.id);
    const restored = await sql.query('SELECT quantity::text, value::text FROM stock_balances WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3', [company,branch,item]);
    assert.equal(Number(restored.rows[0].quantity),10);
    assert.equal(Number(restored.rows[0].value),75);
    const reversedCard = await stockReports.itemLedger(company, item);
    assert.equal(reversedCard.movements.at(-1).runningQuantity, '10.0000');
    assert.equal(reversedCard.movements.at(-1).runningValue, '75.0000');
    const reversedReport = await statements.costCenterReport(company, {from: '2026-01-01', to: '2100-12-31', costCenterId: centre});
    assert.equal(reversedReport.items.find(row => row.costCenterId === centre).ownExpenses, '0.0000');
    assert.equal(reversedReport.reconciliation.balanced, true);
    console.log('PASS: real PostgreSQL + Prisma stock receipt, issue, cost-centre journal, overdraw and duplicate-post rejection, and reversal.');

    // Real services and Prisma on the guarded disposable database. This is
    // not an HTTP, Flutter, installed-Windows or licensed-product test.
    const customer = await prisma.customer.create({data:{companyId:company, code:'SYN-C', nameEn:'Synthetic customer', nameAr:'عميل تجريبي'}});
    const supplier = await prisma.supplier.create({data:{companyId:company, code:'SYN-S', nameEn:'Synthetic supplier', nameAr:'مورد تجريبي'}});
    const first = await prisma.item.create({data:{companyId:company, code:'SYN-ORDER-1', nameEn:'Synthetic order item', nameAr:'صنف طلب', unit:'piece', salePrice:'8', purchasePrice:'8', taxRate:'0', units:{create:[{unit:'carton',factor:'10'}]}}});
    const second = await prisma.item.create({data:{companyId:company, code:'SYN-ORDER-2', nameEn:'Synthetic second item', nameAr:'صنف ثان', unit:'piece', salePrice:'2', purchasePrice:'2', taxRate:'0'}});
    const settings = new CompanySettingsService(prisma,audit);
    const warehouses = new WarehouseService(prisma,audit);
    const prices = new PriceListsService(prisma,audit);
    const posting = new PostingService(numbers,periods,costCenters);
    const map = new AccountMapService();
    const si = new SalesInvoicesService(prisma,numbers,posting,map,settings,warehouses,prices,audit);
    const pi = new PurchaseInvoicesService(prisma,numbers,posting,map,settings,warehouses,prices,audit);
    const sales = new SalesOrdersService(prisma,numbers,settings,prices,si,audit);
    const purchases = new PurchaseOrdersService(prisma,numbers,settings,prices,pi,audit);
    const lines = [{itemId:first.id,quantity:'3',unitName:'carton',unitPrice:'100',discountPercent:'5',taxRate:'0'},
      {itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'}];
    const so = await sales.create(company,branch,user,{customerId:customer.id,orderDate:date,lines});
    const po = await purchases.create(company,branch,user,{supplierId:supplier.id,orderDate:date,lines});
    await sales.approve(company,user,so.id);
    await purchases.approve(company,user,po.id);
    await prisma.itemUnit.update({where:{itemId_unit:{itemId:first.id,unit:'carton'}},data:{factor:'12',isActive:false}});
    for (const [kind, orders, order] of [['sales',sales,so],['purchase',purchases,po]]) {
      const orderLines = kind === 'sales'
        ? await prisma.salesOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}})
        : await prisma.purchaseOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}});
      await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,{}),/Select the order lines/);
      const selected = [{orderLineId:orderLines[0].id,quantity:'20'}];
      await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,{invoiceDate:date,lines:selected}),/idempotencyKey/);
      const countInvoices = () => kind === 'sales'
        ? prisma.salesInvoice.count({where:{companyId:company}}) : prisma.purchaseInvoice.count({where:{companyId:company}});
      const beforeInvoices = await countInvoices();
      const beforeMoves = await prisma.stockMovement.count({where:{companyId:company}});
      const beforeJournals = await prisma.journalEntry.count({where:{companyId:company}});
      // Fail after both the invoice and allocations were written, while the
      // transaction is still open: none of them or either audit may survive.
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'INVOICE') throw new Error('injected audit failure');
        return originalAudit(input, tx);
      };
      try {
        await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,
          {idempotencyKey:'failure-request-00000001',invoiceDate:date,lines:selected}),/injected audit failure/);
      } finally { audit.recordRequired = originalAudit; }
      assert.equal(await countInvoices(),beforeInvoices);
      assert.equal(await prisma.stockMovement.count({where:{companyId:company}}),beforeMoves);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),beforeJournals);
      const afterFailure = kind === 'sales'
        ? await prisma.salesOrderLine.findUniqueOrThrow({where:{id:orderLines[0].id}})
        : await prisma.purchaseOrderLine.findUniqueOrThrow({where:{id:orderLines[0].id}});
      assert.equal(afterFailure.invoicedQuantity.toFixed(4),'0.0000');
      const request = () => orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'same-request-000000001',invoiceDate:date,lines:selected});
      const [conversion, retry] = await Promise.all([request(),request()]);
      assert.equal(conversion.invoice.id,retry.invoice.id,`${kind}: retry created another invoice`);
      assert.equal(await countInvoices(),beforeInvoices+1);
      await assert.rejects(orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'same-request-000000001',invoiceDate:date,lines:[{orderLineId:orderLines[0].id,quantity:'10'}]}),/different request/);
      const saved = kind === 'sales'
        ? await prisma.salesInvoice.findUniqueOrThrow({where:{id:conversion.invoice.id},include:{lines:true}})
        : await prisma.purchaseInvoice.findUniqueOrThrow({where:{id:conversion.invoice.id},include:{lines:true}});
      assert.equal(saved.lines.length,1,`${kind}: an unselected line was invoiced`);
      assert.equal(saved.lines[0].itemId,first.id);
      assert.equal(saved.lines[0].orderLineId,orderLines[0].id);
      assert.equal(saved.lines[0].quantity.toFixed(4),'20.0000');
      assert.equal(saved.lines[0].unitFactor.toFixed(6),'10.000000');
      assert.equal(saved.lines[0].unitQuantity.toFixed(4),'2.0000');
      assert.equal(saved.lines[0].discountPercent.toFixed(4),'5.0000');
      assert.equal(saved.lines[0].lineTotal.toFixed(4),'190.0000');
      const refreshed = kind === 'sales'
        ? await prisma.salesOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}})
        : await prisma.purchaseOrderLine.findMany({where:{orderId:order.id},orderBy:{lineNumber:'asc'}});
      assert.equal(refreshed[0].invoicedQuantity.toFixed(4),'20.0000');
      assert.equal(refreshed[1].invoicedQuantity.toFixed(4),'0.0000');
      // Two different keys compete for the same remaining ten base units.
      const compete = key => orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:key,invoiceDate:date,lines:[{orderLineId:orderLines[0].id,quantity:'10'}]});
      const attempts = await Promise.allSettled([compete('competing-request-000001'),compete('competing-request-000002')]);
      assert.equal(attempts.filter(x => x.status === 'fulfilled').length,1);
      assert.equal(attempts.filter(x => x.status === 'rejected').length,1);
      await orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'final-line-request-00001',invoiceDate:date,lines:[{orderLineId:orderLines[1].id,quantity:'5'}]});
      const completed = kind === 'sales' ? await prisma.salesOrder.findUniqueOrThrow({where:{id:order.id}})
        : await prisma.purchaseOrder.findUniqueOrThrow({where:{id:order.id}});
      assert.equal(completed.status,'FULFILLED');
    }
    console.log('PASS: real PostgreSQL + Prisma order conversion: selected/historical units, audit rollback, simultaneous retry and competing allocations. No HTTP, UI or reversal test.');
  } finally {
    await prisma.$disconnect();
    await sql.end();
  }
})().catch(error => {
  // Don't print database URLs or generated fixture data in CI logs.
  console.error(String(error.stack || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]'));
  process.exitCode = 1;
});
