/**
 * Real-PostgreSQL unit roundtrip. This creates data and must only be run on a
 * disposable isolated test cluster, never on a user installation. Before
 * running, apply the project's migrations and seed the disposable database
 * with company KAYAN, branch MAIN and user isolated_test_operator. The fiscal
 * period for October 2026 must be open. No HTTP/auth or licence is tested.
 *
 * Guarded by a dedicated opt-in, loopback port and database-name prefix. The
 * script does not create or delete databases or alter any existing records.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { InventoryReportsService } from '../src/modules/inventory/inventory-reports.service';
import { ItemsService } from '../src/modules/inventory/items.service';
import { PurchaseInvoicesService } from '../src/modules/purchases/purchase-invoices.service';
import { SalesInvoicesService } from '../src/modules/sales/sales-invoices.service';
import { ReturnsService } from '../src/modules/returns/returns.service';

async function main() {
  assert.equal(process.env.KAYAN_DISPOSABLE_UNIT_TEST, 'yes');
  const dbUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(dbUrl.hostname, '127.0.0.1');
  assert.equal(dbUrl.port, '55437');
  assert.match(dbUrl.pathname, /^\/kayan_units_test_[a-z0-9_]+$/);
  assert.ok(process.env.LICENSE_STATE_DIR?.startsWith('/home/user/demo-work/'),
    'Use a separate disposable licence state directory');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const db = app.get(PrismaService), purchases = app.get(PurchaseInvoicesService), sales = app.get(SalesInvoicesService), returns = app.get(ReturnsService);
    const units = app.get(InventoryReportsService), itemService = app.get(ItemsService);
    const company = await db.company.findUniqueOrThrow({where: {code: 'KAYAN'}});
    const branch = await db.branch.findFirstOrThrow({where: {companyId: company.id, code: 'MAIN'}});
    const user = await db.user.findUniqueOrThrow({where: {username: 'isolated_test_operator'}});
    const C=company.id, B=branch.id, U=user.id;
    const supplier = await db.supplier.create({data:{companyId:C,code:'SYN-SUP',nameEn:'Synthetic supplier',nameAr:'مورد افتراضي'}});
    const customer = await db.customer.create({data:{companyId:C,code:'SYN-CUS',nameEn:'Synthetic customer',nameAr:'عميل افتراضي'}});
    const item = await db.item.create({data:{companyId:C,code:'SYN-ITEM',nameEn:'Synthetic item',nameAr:'صنف افتراضي',unit:'عبوة',salePrice:'10',purchasePrice:'7',taxRate:'14',units:{create:[{unit:'عبوة',factor:'1',barcode:'2000000000103'},{unit:'كرتونة',factor:'12',barcode:'2000000000202'}]}},include:{units:true}});
    const carton = item.units.find(x=>x.unit==='كرتونة')!;
    const barcode = await itemService.findByBarcode(C,'2000000000202');
    assert.equal(barcode.quantityPerScan,'12.0000'); assert.equal(barcode.salePrice,'120.0000'); assert.equal(barcode.purchasePrice,'84.0000');
    const balance = async ()=>(await db.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:C,branchId:B,itemId:item.id}}}));
    const purchase = await purchases.create(C,B,U,{invoiceDate:'2026-10-01',supplierId:supplier.id,lines:[{itemId:item.id,quantity:'10',unitName:'كرتونة',taxRate:'14'}]} as never);
    await purchases.post(C,U,purchase.id);
    const pi=await db.purchaseInvoice.findUniqueOrThrow({where:{id:purchase.id},include:{lines:true}});
    assert.equal(pi.lines[0].quantity.toFixed(4),'120.0000'); assert.equal(pi.lines[0].unitPrice.toFixed(4),'84.0000'); assert.equal(pi.subTotal.toFixed(4),'840.0000'); assert.equal(pi.taxAmount.toFixed(4),'117.6000');
    assert.equal((await balance()).quantity.toFixed(4),'120.0000');
    const saleCarton=await sales.create(C,B,U,{invoiceDate:'2026-10-02',customerId:customer.id,lines:[{itemId:item.id,quantity:'3',unitName:'كرتونة',taxRate:'14'}]} as never);
    await sales.post(C,U,saleCarton.id);
    const si=await db.salesInvoice.findUniqueOrThrow({where:{id:saleCarton.id},include:{lines:true}});
    assert.equal(si.lines[0].quantity.toFixed(4),'36.0000');assert.equal(si.lines[0].unitPrice.toFixed(4),'120.0000');assert.equal(si.subTotal.toFixed(4),'360.0000');assert.equal(si.taxAmount.toFixed(4),'50.4000');
    assert.equal((await balance()).quantity.toFixed(4),'84.0000');
    const salePiece=await sales.create(C,B,U,{invoiceDate:'2026-10-03',customerId:customer.id,lines:[{itemId:item.id,quantity:'5',unitName:'عبوة',taxRate:'14'}]} as never);
    await sales.post(C,U,salePiece.id);assert.equal((await balance()).quantity.toFixed(4),'79.0000');
    await units.updateUnit(C,U,item.id,carton.id,{factor:'10'});
    const still=await db.salesInvoiceLine.findUniqueOrThrow({where:{id:si.lines[0].id}});
    assert.equal(still.unitFactor!.toFixed(6),'12.000000'); assert.equal(still.quantity.toFixed(4),'36.0000');
    const ret=await returns.createSalesReturn(C,B,U,{originalInvoiceId:saleCarton.id,returnDate:'2026-10-04',lines:[{originalLineId:si.lines[0].id,quantity:'1',unitName:'كرتونة'}]});
    await returns.postSalesReturn(C,U,ret.id);
    const returned=await db.salesInvoice.findUniqueOrThrow({where:{id:ret.id},include:{lines:true}});
    assert.equal(returned.lines[0].unitFactor!.toFixed(6),'12.000000');assert.equal(returned.lines[0].quantity.toFixed(4),'12.0000');
    const final=await balance(); assert.equal(final.quantity.toFixed(4),'91.0000'); assert.equal(final.value.toFixed(4),'637.0000');
    for(const entry of await db.journalEntry.findMany({where:{companyId:C},include:{lines:true}})) {
      const debit=entry.lines.reduce((sum,l)=>sum.plus(l.debit),new (require('@prisma/client').Prisma.Decimal)(0));
      const credit=entry.lines.reduce((sum,l)=>sum.plus(l.credit),new (require('@prisma/client').Prisma.Decimal)(0));
      assert(debit.equals(credit),`unbalanced journal ${entry.entryNumber}`);
    }
    console.log(JSON.stringify({result:'PASS',purchase:'120',afterThreeCartons:'84',afterFivePieces:'79',afterOneCartonReturn:'91',stockValue:final.value.toFixed(4),historicFactor:'12',newUnitFactor:'10',taxPurchase:pi.taxAmount.toFixed(4),taxSales:si.taxAmount.toFixed(4),note:'direct Nest services and synthetic PostgreSQL; no HTTP, authorization or UI'}));
  } finally { await app.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1});
