// Independent synthetic test: real PR #70 Nest services with local unit changes + isolated PostgreSQL.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const r = createRequire(path.join(process.cwd(), 'package.json'));
r('reflect-metadata');
const { NestFactory } = r('@nestjs/core');
const { AppModule } = r('./src/app.module.ts');
const { PrismaService } = r('./src/common/prisma/prisma.service.ts');
const { PurchaseInvoicesService } = r('./src/modules/purchases/purchase-invoices.service.ts');
const { SalesInvoicesService } = r('./src/modules/sales/sales-invoices.service.ts');
const { ItemsService } = r('./src/modules/inventory/items.service.ts');
const { ReturnsService } = r('./src/modules/returns/returns.service.ts');
const { InventoryReportsService } = r('./src/modules/inventory/inventory-reports.service.ts');

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55437');
  assert.match(url.pathname, /^\/kayan_units_test_[a-z0-9_]+$/);
  assert.equal(url.pathname.slice(1), process.env.KAYAN_SYNTHETIC_DB);
  assert.ok(process.env.KAYAN_SYNTHETIC_PG_SYSTEM_ID, 'Explicit disposable cluster ID is required');
  assert.equal(process.env.KAYAN_SYNTHETIC_BASE_CHECK, 'yes');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const db = app.get(PrismaService), purchases = app.get(PurchaseInvoicesService), sales = app.get(SalesInvoicesService), items = app.get(ItemsService), returns = app.get(ReturnsService);
    const cluster = await db.$queryRaw`SELECT (pg_control_system()).system_identifier::text AS id`;
    assert.equal(cluster[0].id, process.env.KAYAN_SYNTHETIC_PG_SYSTEM_ID);
    const company = await db.company.findUniqueOrThrow({ where: { code: 'KAYAN' } });
    const branch = await db.branch.findFirstOrThrow({ where: { companyId: company.id, code: 'MAIN' } });
    const user = await db.user.findUniqueOrThrow({ where: { username: 'isolated_test_operator' } });
    const C = company.id, B = branch.id, U = user.id;
    const supplier = await db.supplier.create({data:{companyId:C,code:'SYN-SUP',nameEn:'Synthetic supplier',nameAr:'مورد افتراضي'}});
    const customer = await db.customer.create({data:{companyId:C,code:'SYN-CUS',nameEn:'Synthetic customer',nameAr:'عميل افتراضي'}});
    const item = await db.item.create({data:{companyId:C,code:'SYN-KG',nameEn:'Synthetic kilogram item',nameAr:'صنف افتراضي',unit:'كيلو',salePrice:'10',purchasePrice:'7',taxRate:'0',units:{create:[{unit:'كيلو',factor:'1',barcode:'2000000000103'},{unit:'كرتونة',factor:'5',barcode:'2000000000202'}]}},include:{units:true}});
    const barcode = await items.findByBarcode(C, '2000000000202');
    assert.equal(barcode.quantityPerScan, '5.0000');
    const balance = async () => (await db.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:C,branchId:B,itemId:item.id}}})).quantity.toFixed(4);
    const purchase = await purchases.create(C,B,U,{invoiceDate:'2026-10-01',supplierId:supplier.id,lines:[{itemId:item.id,quantity:'10',unitName:'كرتونة',taxRate:'0'}]});
    await purchases.post(C,U,purchase.id);
    assert.equal(await balance(),'50.0000');
    const pi = await db.purchaseInvoice.findUniqueOrThrow({where:{id:purchase.id},include:{lines:true}});
    assert.equal(pi.lines[0].unitFactor.toFixed(6),'5.000000');
    assert.equal(pi.lines[0].unitQuantity.toFixed(4),'10.0000');
    const snapshots = [];
    let firstSaleId, firstSaleLine;
    for (const [quantity, unitName, expected] of [['1','كرتونة','45.0000'],['0.5','كرتونة','42.5000'],['2.5','كيلو','40.0000']]) {
      const sale = await sales.create(C,B,U,{invoiceDate:'2026-10-02',customerId:customer.id,lines:[{itemId:item.id,quantity,unitName,taxRate:'0'}]});
      await sales.post(C,U,sale.id);
      assert.equal(await balance(),expected);
      const invoice = await db.salesInvoice.findUniqueOrThrow({where:{id:sale.id},include:{lines:true}});
      if (!firstSaleId) { firstSaleId = sale.id; firstSaleLine = invoice.lines[0]; }
      snapshots.push({unit:invoice.lines[0].unitName,factor:invoice.lines[0].unitFactor.toFixed(6),entered:invoice.lines[0].unitQuantity.toFixed(4),base:invoice.lines[0].quantity.toFixed(4)});
    }
    // Partial and remaining full sales return, using the original snapshot.
    for (const [quantity, expected] of [['0.4', '42.0000'], ['0.6', '45.0000']]) {
      const ret = await returns.createSalesReturn(C,B,U,{originalInvoiceId:firstSaleId,returnDate:'2026-10-03',lines:[{originalLineId:firstSaleLine.id,quantity,unitName:'كرتونة'}]});
      await returns.postSalesReturn(C,U,ret.id);
      assert.equal(await balance(), expected);
    }
    const pReturn = await returns.createPurchaseReturn(C,B,U,{originalInvoiceId:purchase.id,returnDate:'2026-10-04',lines:[{originalLineId:pi.lines[0].id,quantity:'1',unitName:'كرتونة'}]});
    await returns.postPurchaseReturn(C,U,pReturn.id);
    assert.equal(await balance(),'40.0000');
    const attempts = await Promise.all(['30','30'].map(quantity => sales.create(C,B,U,{invoiceDate:'2026-10-05',customerId:customer.id,lines:[{itemId:item.id,quantity,unitName:'كيلو',taxRate:'0'}]})));
    const postings = await Promise.allSettled(attempts.map(invoice => sales.post(C,U,invoice.id)));
    assert.equal(postings.filter(x => x.status === 'fulfilled').length, 1, 'exactly one concurrent sale should succeed');
    assert.equal(await balance(), '10.0000');
    const successfulSale = attempts[postings.findIndex(x => x.status === 'fulfilled')];
    const sold = await db.salesInvoice.findUniqueOrThrow({ where:{id:successfulSale.id}, include:{lines:true} });
    const twoReturns = await Promise.all(['20','20'].map(quantity => returns.createSalesReturn(C,B,U,{originalInvoiceId:successfulSale.id,returnDate:'2026-10-06',lines:[{originalLineId:sold.lines[0].id,quantity,unitName:'كيلو'}]})));
    const returnResults = await Promise.allSettled(twoReturns.map(ret => returns.postSalesReturn(C,U,ret.id)));
    assert.equal(returnResults.filter(x => x.status === 'fulfilled').length, 1, 'exactly one concurrent return should succeed');
    assert.equal(await balance(),'30.0000');
    const units = app.get(InventoryReportsService);
    const carton = item.units.find(u => u.unit === 'كرتونة');
    await assert.rejects(() => units.updateUnit(C,U,item.id,carton.id,{factor:'1.2345678'}), /at most 6/);
    assert.equal((await db.itemUnit.findUniqueOrThrow({where:{id:carton.id}})).factor.toFixed(6),'5.000000');
    await units.updateUnit(C,U,item.id,carton.id,{factor:'1.234567'});
    await assert.rejects(() => sales.create(C,B,U,{invoiceDate:'2026-10-07',customerId:customer.id,lines:[{itemId:item.id,quantity:'0.0001',unitName:'كرتونة',taxRate:'0'}]}), /cannot be represented/);
    await assert.rejects(() => sales.create(C,B,U,{invoiceDate:'2026-10-07',customerId:customer.id,lines:[{itemId:item.id,quantity:'0.00001',unitName:'كيلو',taxRate:'0'}]}), /at most 4/);
    // A line without a snapshot represents its base quantity. An unrelated
    // alternative unit must never be silently interpreted as factor 1.
    const oldStyle = await sales.create(C,B,U,{invoiceDate:'2026-10-07',customerId:customer.id,lines:[{itemId:item.id,quantity:'2',taxRate:'0'}]});
    await sales.post(C,U,oldStyle.id);
    const oldLine = (await db.salesInvoice.findUniqueOrThrow({where:{id:oldStyle.id},include:{lines:true}})).lines[0];
    assert.equal(oldLine.unitFactor, null);
    await assert.rejects(() => returns.createSalesReturn(C,B,U,{originalInvoiceId:oldStyle.id,returnDate:'2026-10-08',lines:[{originalLineId:oldLine.id,quantity:'1',unitName:'كرتونة'}]}), /no trusted conversion/);
    const baseReturn = await returns.createSalesReturn(C,B,U,{originalInvoiceId:oldStyle.id,returnDate:'2026-10-08',lines:[{originalLineId:oldLine.id,quantity:'1',unitName:'كيلو'}]});
    await returns.postSalesReturn(C,U,baseReturn.id);
    assert.equal(await balance(),'29.0000');
    // The purchase invoice keeps the original factor 5 even after the unit
    // definition changed to 1.234567.
    const historicalReturn = await returns.createPurchaseReturn(C,B,U,{originalInvoiceId:purchase.id,returnDate:'2026-10-08',lines:[{originalLineId:pi.lines[0].id,quantity:'1',unitName:'كرتونة'}]});
    await returns.postPurchaseReturn(C,U,historicalReturn.id);
    assert.equal(await balance(),'24.0000');
    const hist = await db.purchaseInvoice.findUniqueOrThrow({where:{id:historicalReturn.id},include:{lines:true}});
    assert.equal(hist.lines[0].unitFactor.toFixed(6),'5.000000');
    assert.equal(hist.lines[0].quantity.toFixed(4),'5.0000');
    const movements = await db.stockMovement.findMany({where:{companyId:C,branchId:B,itemId:item.id}});
    const { Prisma } = r('@prisma/client');
    const ledger = movements.reduce((sum,m) => m.direction === 'IN' ? sum.plus(m.quantity) : sum.minus(m.quantity), new Prisma.Decimal(0));
    assert.equal(ledger.toFixed(4), await balance(), 'stock balance must match ledger movements');
    console.log(JSON.stringify({returns:['42.0000','45.0000','40.0000'],concurrentSales:postings.map(x=>x.status),concurrentReturns:returnResults.map(x=>x.status),ledger:ledger.toFixed(4)}));
    console.log(JSON.stringify({result:'PASS',db:'synthetic isolated PostgreSQL 16.15',quantityBase:'كيلو',cartonFactor:'5',balances:['50.0000','45.0000','42.5000','40.0000'],barcodeFactor:barcode.quantityPerScan,snapshots,scope:'locally modified Nest services + database, not HTTP, UI, or Windows'}));
  } finally { await app.close(); }
}
main().catch(e => {console.error(e);process.exitCode=1});
