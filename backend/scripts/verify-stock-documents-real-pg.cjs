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
    const lines = [{itemId:first.id,quantity:'3',unitName:'carton',unitPrice:'100',discountPercent:'5',taxRate:'14'},
      {itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'}];
    const so = await sales.create(company,branch,user,{customerId:customer.id,orderDate:date,lines});
    const po = await purchases.create(company,branch,user,{supplierId:supplier.id,orderDate:date,lines});
    await sales.approve(company,user,so.id);
    await purchases.approve(company,user,po.id);
    await prisma.itemUnit.update({where:{itemId_unit:{itemId:first.id,unit:'carton'}},data:{factor:'12',isActive:false}});
    await prisma.companySetting.update({where:{companyId:company},data:{pricesIncludeTax:true}});
    const converted = {};
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
      converted[kind] = { invoiceId:saved.id, invoiceLineId:saved.lines[0].id, orderId:order.id, orderLineId:orderLines[0].id };
      assert.equal(saved.lines[0].quantity.toFixed(4),'20.0000');
      assert.equal(saved.lines[0].unitFactor.toFixed(6),'10.000000');
      assert.equal(saved.lines[0].unitQuantity.toFixed(4),'2.0000');
      assert.equal(saved.lines[0].discountPercent.toFixed(4),'5.0000');
      assert.equal(saved.lines[0].lineTotal.toFixed(4),'190.0000');
      assert.equal(saved.lines[0].taxAmount.toFixed(4),'26.6000');
      assert.equal(saved.totalAmount.toFixed(4),'216.6000');
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
    // Configure the synthetic chart, post the purchased stock, sell it, then
    // reverse both. Legacy/missing line links must abort without stock, journal
    // or order mutations; a successful reversal releases the allocation.
    for (const [code, type] of [['1103','ASSET'],['2101','LIABILITY'],['1104','ASSET'],
      ['1105','ASSET'],['2103','LIABILITY'],['4101','REVENUE'],['5101','EXPENSE']]) {
      await prisma.account.upsert({where:{companyId_code:{companyId:company,code}},
        create:{companyId:company,code,nameEn:`Synthetic ${code}`,nameAr:`تجريبي ${code}`,type,isPostable:true},
        update:{isActive:true,isPostable:true,deletedAt:null}});
    }
    await assert.rejects(si.updateDraft(company,branch,user,converted.sales.invoiceId,{}),/allocation reconciliation/);
    await assert.rejects(pi.updateDraft(company,branch,user,converted.purchase.invoiceId,{}),/allocation reconciliation/);
    await pi.post(company,user,converted.purchase.invoiceId);
    await si.post(company,user,converted.sales.invoiceId);
    let orderStockState = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:first.id}}});
    assert.equal(orderStockState.quantity.toFixed(4),'0.0000');
    for (const [kind, svc, orders] of [['sales',si,sales],['purchase',pi,purchases]]) {
      const target = converted[kind];
      const invoiceLines = kind === 'sales' ? prisma.salesInvoiceLine : prisma.purchaseInvoiceLine;
      const invoiceModel = kind === 'sales' ? prisma.salesInvoice : prisma.purchaseInvoice;
      const orderLineModel = kind === 'sales' ? prisma.salesOrderLine : prisma.purchaseOrderLine;
      await invoiceLines.update({where:{id:target.invoiceLineId},data:{orderLineId:null}});
      const movements = await prisma.stockMovement.count({where:{companyId:company}});
      const journals = await prisma.journalEntry.count({where:{companyId:company}});
      await assert.rejects(svc.reverse(company,user,target.invoiceId),/manual review/);
      assert.equal((await invoiceModel.findUniqueOrThrow({where:{id:target.invoiceId}})).status,'POSTED');
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'30.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company}}),movements);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),journals);
      await invoiceLines.update({where:{id:target.invoiceLineId},data:{orderLineId:target.orderLineId}});
      await svc.reverse(company,user,target.invoiceId);
      assert.equal((await invoiceModel.findUniqueOrThrow({where:{id:target.invoiceId}})).status,'REVERSED');
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'10.0000');
      await assert.rejects(svc.reverse(company,user,target.invoiceId),/Only posted/);
      await assert.rejects(orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'same-request-000000001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]}),/no longer active/);
      const reissued = await orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'reconverted-request-0001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]});
      await svc.cancelDraft(company,branch,user,reissued.invoice.id);
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:target.orderLineId}})).invoicedQuantity.toFixed(4),'10.0000');
      assert.ok((await invoiceModel.findUniqueOrThrow({where:{id:reissued.invoice.id}})).deletedAt);
      await assert.rejects(orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'reconverted-request-0001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]}),/no longer active/);
      await orders.convertToInvoice(company,branch,user,target.orderId,
        {idempotencyKey:'after-draft-cancel-00001',invoiceDate:date,lines:[{orderLineId:target.orderLineId,quantity:'20'}]});
    }
    orderStockState = await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:first.id}}});
    assert.equal(orderStockState.quantity.toFixed(4),'0.0000');
    assert.equal(orderStockState.value.toFixed(4),'0.0000');
    for (const [kind, orders, invoices, party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const partyField = kind === 'sales' ? 'customerId' : 'supplierId';
      const full = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,lines:[
        {itemId:first.id,quantity:'3',unitPrice:'7',taxRate:'14'},
        {itemId:second.id,quantity:'5',unitPrice:'2',taxRate:'0'},
      ]});
      await orders.approve(company,user,full.id);
      const rows = kind === 'sales' ? await prisma.salesOrderLine.findMany({where:{orderId:full.id},orderBy:{lineNumber:'asc'}})
        : await prisma.purchaseOrderLine.findMany({where:{orderId:full.id},orderBy:{lineNumber:'asc'}});
      const result = await orders.convertToInvoice(company,branch,user,full.id,{idempotencyKey:'full-order-request-00001',invoiceDate:date,
        lines:rows.map(row => ({orderLineId:row.id,quantity:row.quantity.toFixed(4)}))});
      assert.equal(result.order.status,'FULFILLED');
      assert.equal(result.invoice.lines.length,2);
      await assert.rejects(orders.cancel(company,user,full.id),/active invoices/);
      await invoices.cancelDraft(company,branch,user,result.invoice.id);
      const orderAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_orders` && input.action === 'CANCEL') throw new Error('injected order cancel audit failure');
        return orderAudit(input, tx);
      };
      try { await assert.rejects(orders.cancel(company,user,full.id,'audit failure'),/injected order cancel audit failure/); }
      finally { audit.recordRequired = orderAudit; }
      const afterCancelFailure = kind === 'sales' ? await prisma.salesOrder.findUniqueOrThrow({where:{id:full.id}})
        : await prisma.purchaseOrder.findUniqueOrThrow({where:{id:full.id}});
      assert.equal(afterCancelFailure.status,'APPROVED');
      await orders.cancel(company,user,full.id,'synthetic cancellation');
      const finalOrder = kind === 'sales' ? await prisma.salesOrder.findUniqueOrThrow({where:{id:full.id}})
        : await prisma.purchaseOrder.findUniqueOrThrow({where:{id:full.id}});
      assert.equal(finalOrder.status,'CANCELLED');

      // Cancellation and conversion must serialize on the same parent row.
      const race = await orders.create(company,branch,user,{[partyField]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'2',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,race.id);
      const raceLine = kind === 'sales' ? await prisma.salesOrderLine.findFirstOrThrow({where:{orderId:race.id}})
        : await prisma.purchaseOrderLine.findFirstOrThrow({where:{orderId:race.id}});
      const outcomes = await Promise.allSettled([
        orders.cancel(company,user,race.id,'synthetic concurrent cancellation'),
        orders.convertToInvoice(company,branch,user,race.id,{idempotencyKey:'concurrent-cancel-000001',invoiceDate:date,
          lines:[{orderLineId:raceLine.id,quantity:'2'}]}),
      ]);
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length,1);
      assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length,1);
    }
    async function waitForBarrier(reached, pending) {
      let timer;
      try {
        await Promise.race([
          reached,
          pending.then(() => { throw new Error('Operation finished before the test barrier'); }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for race barrier')),15000); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    // Seed enough stock for the synthetic sales posting races below.
    const raceStock = await service.create(company,branch,user,{kind:'ADJUSTMENT',documentDate:date,
      toWarehouseId:warehouse,reason:'Synthetic race stock',lines:[{itemId:second.id,quantity:'20',unitCost:'2'}]});
    await service.post(company,user,raceStock.id);
    for (const [kind, orders, invoices, party] of [['sales',sales,si,customer.id],['purchase',purchases,pi,supplier.id]]) {
      const field = kind === 'sales' ? 'customerId' : 'supplierId';
      const model = kind === 'sales' ? 'salesInvoice' : 'purchaseInvoice';
      const orderLineModel = kind === 'sales' ? prisma.salesOrderLine : prisma.purchaseOrderLine;
      const order = await orders.create(company,branch,user,{[field]:party,orderDate:date,
        lines:[{itemId:second.id,quantity:'2',unitPrice:'2',taxRate:'0'}]});
      await orders.approve(company,user,order.id);
      const orderLine = await orderLineModel.findFirstOrThrow({where:{orderId:order.id}});
      const convertedRace = await orders.convertToInvoice(company,branch,user,order.id,
        {idempotencyKey:'post-cancel-race-000001',invoiceDate:date,lines:[{orderLineId:orderLine.id,quantity:'2'}]});
      const invoiceId = convertedRace.invoice.id;
      const originalAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_invoices` && input.action === 'CANCEL_DRAFT') throw new Error('injected cancel audit failure');
        return originalAudit(input, tx);
      };
      try { await assert.rejects(invoices.cancelDraft(company,branch,user,invoiceId),/injected cancel audit failure/); }
      finally { audit.recordRequired = originalAudit; }
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),'2.0000');
      assert.equal((await prisma[model].findUniqueOrThrow({where:{id:invoiceId}})).deletedAt,null);
      const raced = await Promise.allSettled([invoices.post(company,user,invoiceId),invoices.cancelDraft(company,branch,user,invoiceId)]);
      assert.equal(raced.filter(x => x.status === 'fulfilled').length,1,`${kind}: post/cancel must have one winner`);
      assert.equal(raced.filter(x => x.status === 'rejected').length,1);
      const savedRace = await prisma[model].findUniqueOrThrow({where:{id:invoiceId}});
      const posted = savedRace.status === 'POSTED';
      assert.equal(Boolean(savedRace.deletedAt),!posted);
      assert.equal((await orderLineModel.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),posted?'2.0000':'0.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:invoiceId}}),posted?1:0);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceId:invoiceId}}),posted?1:0);

      // A failure in the required POST audit must also roll back stock,
      // the journal, and the invoice's status transition.
      const postingFailureDto = {[field]:party,invoiceDate:date,
        lines:[{itemId:second.id,quantity:'1',unitPrice:'2',taxRate:'0'}]};
      const postingFailure = await invoices.create(company,branch,user,postingFailureDto);
      const postingAudit = audit.recordRequired.bind(audit);
      audit.recordRequired = async (input, tx) => {
        if (input.entity === `${kind}_invoices` && input.action === 'POST') throw new Error('injected post audit failure');
        return postingAudit(input, tx);
      };
      try { await assert.rejects(invoices.post(company,user,postingFailure.id),/injected post audit failure/); }
      finally { audit.recordRequired = postingAudit; }
      assert.equal((await prisma[model].findUniqueOrThrow({where:{id:postingFailure.id}})).status,'DRAFT');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:postingFailure.id}}),0);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company,sourceId:postingFailure.id}}),0);
      await invoices.cancelDraft(company,branch,user,postingFailure.id);

      // Pause a real post just after its first header read, edit the unrelated
      // draft with the production service, then resume. Post must claim first
      // and use the newly committed lines for stock and accounting.
      const dto = {[field]:party,invoiceDate:date,lines:[{itemId:second.id,quantity:'1',unitPrice:'2',taxRate:'0'}]};
      const draft = await invoices.create(company,branch,user,dto);
      let readReached, resumePost;
      const readBarrier = new Promise(resolve => { readReached = resolve; });
      const resumeBarrier = new Promise(resolve => { resumePost = resolve; });
      let intercepted = false;
      const invoiceModel = prisma[model];
      const wrappedModel = new Proxy(invoiceModel,{get(target, key) {
        const original = target[key];
        if (key === 'findFirst') return async (...args) => {
          const result = await original.apply(target,args);
          if (!intercepted && args[0]?.where?.id === draft.id && args[0]?.select?.status) {
            intercepted = true; readReached(); await resumeBarrier;
          }
          return result;
        };
        return typeof original === 'function' ? original.bind(target) : original;
      }});
      const wrappedPrisma = new Proxy(prisma,{get(target,key) {
        if (key === model) return wrappedModel;
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const PostingClass = kind === 'sales' ? SalesInvoicesService : PurchaseInvoicesService;
      const instrumented = new PostingClass(wrappedPrisma,numbers,posting,map,settings,warehouses,prices,audit);
      const pendingPost = instrumented.post(company,user,draft.id);
      try {
        await waitForBarrier(readBarrier,pendingPost);
        await invoices.updateDraft(company,branch,user,draft.id,{...dto,
          lines:[{itemId:second.id,quantity:'3',unitPrice:'2',taxRate:'0'}]});
      } finally { resumePost(); }
      await pendingPost;
      const movements = await prisma.stockMovement.findMany({where:{companyId:company,referenceId:draft.id}});
      assert.equal(movements.length,1);
      assert.equal(movements[0].quantity.toFixed(4),'3.0000');
      const postedInvoice = await prisma[model].findUniqueOrThrow({where:{id:draft.id}});
      assert.equal(postedInvoice.totalAmount.toFixed(4),'6.0000');
      const postedJournal = await prisma.journalEntry.findUniqueOrThrow({where:{id:postedInvoice.journalEntryId}});
      assert.equal(postedJournal.totalDebit.toFixed(4),postedJournal.totalCredit.toFixed(4));

      // A draft edit prepared before cancellation must re-check deletedAt
      // while acquiring its row lock, not rewrite a cancelled document.
      const cancelTarget = await invoices.create(company,branch,user,dto);
      let editReached, resumeEdit;
      const editBarrier = new Promise(resolve => { editReached = resolve; });
      const resumeEditBarrier = new Promise(resolve => { resumeEdit = resolve; });
      const editPrisma = new Proxy(prisma,{get(target,key) {
        if (key === '$transaction') return async (...args) => {
          editReached(); await resumeEditBarrier;
          return target.$transaction(...args);
        };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const delayedEditor = new PostingClass(editPrisma,numbers,posting,map,settings,warehouses,prices,audit);
      const pendingEdit = delayedEditor.updateDraft(company,branch,user,cancelTarget.id,{...dto,
        lines:[{itemId:second.id,quantity:'3',unitPrice:'2',taxRate:'0'}]});
      try {
        await waitForBarrier(editBarrier,pendingEdit);
        await invoices.cancelDraft(company,branch,user,cancelTarget.id);
      } finally { resumeEdit(); }
      await assert.rejects(pendingEdit,/posted or changed/);
      const cancelled = await prisma[model].findUniqueOrThrow({where:{id:cancelTarget.id},include:{lines:true}});
      assert.ok(cancelled.deletedAt);
      assert.equal(cancelled.lines[0].quantity.toFixed(4),'1.0000');
      assert.equal(await prisma.stockMovement.count({where:{companyId:company,referenceId:cancelTarget.id}}),0);
    }
    console.log('PASS: real Prisma/PostgreSQL post/edit stale-read, edit/cancel, post/cancel, cancel audit rollback and stock/journal invariants for sales and purchases.');
    console.log('PASS: PostgreSQL + Prisma order conversion full/partial, historical values, audit rollback, retry/competition, post/reverse, draft cancel and order-cancel race. No HTTP, Flutter or installed Windows test.');
  } finally {
    await prisma.$disconnect();
    await sql.end();
  }
})().catch(error => {
  // Don't print database URLs or generated fixture data in CI logs.
  console.error(String(error.stack || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]'));
  process.exitCode = 1;
});
