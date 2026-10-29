/**
 * TEMPORARY real-Postgres integration scenario (deleted before the task ends).
 * Drives the actual Nest services against a real PostgreSQL database — no mocks.
 */
import { BadRequestException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { UnprocessableEntityException } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { BarcodeLabelsService } from '../modules/inventory/barcode-labels.service';
import { InventoryReportsService } from '../modules/inventory/inventory-reports.service';
import { PurchaseInvoicesService } from '../modules/purchases/purchase-invoices.service';
import { ReturnsService } from '../modules/returns/returns.service';
import { SalesInvoicesService } from '../modules/sales/sales-invoices.service';

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = String(actual);
  const e = String(expected);
  if (a === e) {
    pass++;
    console.log(`  ✓ ${label} = ${a}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}: got ${a}, expected ${e}`);
  }
}
async function expectBadRequest(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail++;
    console.log(`  ✗ ${label}: expected BadRequest but none thrown`);
  } catch (e) {
    if (e instanceof BadRequestException) {
      pass++;
      console.log(`  ✓ ${label} rejected (${e.getResponse()})`);
    } else {
      fail++;
      console.log(`  ✗ ${label}: wrong error ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
}

async function expectDbConstraint(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail++;
    console.log(`  ✗ ${label}: expected a database constraint error but none thrown`);
  } catch (e) {
    const msg = String((e as { message?: string }).message ?? e);
    const code = (e as { code?: string }).code;
    if (code === 'P2002' || msg.includes('23505') || msg.includes('already assigned')) {
      pass++;
      console.log(`  ✓ ${label} (DB ${code ?? '23505'}: ${msg.split('\n').find((l) => l.includes('23505') || l.includes('already assigned'))?.trim() ?? 'constraint'})`);
    } else {
      fail++;
      console.log(`  ✗ ${label}: wrong error ${(e as Error).name}: ${msg.slice(0, 120)}`);
    }
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const purchases = app.get(PurchaseInvoicesService);
  const sales = app.get(SalesInvoicesService);
  const returns = app.get(ReturnsService);
  const inventory = app.get(InventoryReportsService);

  const company = await prisma.company.findFirstOrThrow({ where: { code: 'KAYAN' } });
  const branch = await prisma.branch.findFirstOrThrow({ where: { companyId: company.id, code: 'MAIN' } });
  const user = await prisma.user.findFirstOrThrow({ where: { companyId: company.id } });
  const C = company.id;
  const B = branch.id;
  const U = user.id;

  // ---- master data -------------------------------------------------------
  const supplier = await prisma.supplier.create({ data: { companyId: C, code: 'SUP-1', nameEn: 'Supplier', nameAr: 'مورد' } });
  const customer = await prisma.customer.create({ data: { companyId: C, code: 'CUS-1', nameEn: 'Customer', nameAr: 'عميل' } });

  const milk = await prisma.item.create({
    data: {
      companyId: C, code: 'MILK', nameEn: 'Milk', nameAr: 'لبن', unit: 'علبة',
      salePrice: '10', purchasePrice: '7', taxRate: '0',
      units: { create: [
        { unit: 'علبة', factor: '1', barcode: '62210001', salePrice: '10', purchasePrice: '7' },
        { unit: 'كرتونة', factor: '10', barcode: '62210010', salePrice: '97', purchasePrice: '75' },
      ] },
    },
    include: { units: true },
  });
  const cable = await prisma.item.create({
    data: {
      companyId: C, code: 'CABLE', nameEn: 'Cable', nameAr: 'كابل', unit: 'متر',
      salePrice: '20', purchasePrice: '12', taxRate: '0',
      units: { create: [
        { unit: 'متر', factor: '1', barcode: '62220001', salePrice: '20', purchasePrice: '12' },
        { unit: 'بكرة', factor: '100', barcode: '62220100', salePrice: '1500', purchasePrice: '5000' },
      ] },
    },
    include: { units: true },
  });
  const milkPiece = milk.units.find((x) => x.unit === 'علبة')!;
  const milkCarton = milk.units.find((x) => x.unit === 'كرتونة')!;
  const cableMetre = cable.units.find((x) => x.unit === 'متر')!;
  const cableReel = cable.units.find((x) => x.unit === 'بكرة')!;

  const balance = async (itemId: string) => {
    const row = await prisma.stockBalance.findUnique({ where: { companyId_branchId_itemId: { companyId: C, branchId: B, itemId } } });
    return row ?? null;
  };
  const movements = async (referenceId: string) =>
    prisma.stockMovement.findMany({ where: { referenceId }, orderBy: { createdAt: 'asc' } });

  // ===== MILK: buy 5 cartons x10 = 50 pieces ==============================
  console.log('\n[1] Milk purchase: 5 cartons (factor 10) @ 75');
  const piMilk = await purchases.create(C, B, U, {
    invoiceDate: '2026-10-01', supplierId: supplier.id,
    lines: [{ itemId: milk.id, quantity: '5', unitName: 'كرتونة', unitPrice: '75', taxRate: '0' }],
  } as never);
  let draftMov = await movements(piMilk.id);
  check('draft creates no stock movement', draftMov.length, 0);
  await purchases.post(C, U, piMilk.id);
  const piMilkPosted = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: piMilk.id }, include: { lines: true } });
  const pl = piMilkPosted.lines[0];
  check('purchase line base quantity', pl.quantity.toFixed(4), '50.0000');
  check('purchase snapshot unitName', pl.unitName, 'كرتونة');
  check('purchase snapshot factor', pl.unitFactor!.toFixed(6), '10.000000');
  check('purchase snapshot unitQuantity', pl.unitQuantity!.toFixed(4), '5.0000');
  let bal = await balance(milk.id);
  check('milk balance qty after purchase', bal!.quantity.toFixed(4), '50.0000');
  check('milk balance value', bal!.value.toFixed(4), '375.0000');
  let mov = await movements(piMilk.id);
  check('one IN movement after post', mov.length, 1);
  check('IN direction', mov[0].direction, 'IN');
  check('IN unit cost (375/50)', mov[0].unitCost.toFixed(4), '7.5000');

  // independent pricing: unit prices must not have been rewritten by the document
  const cartonAfter = await prisma.itemUnit.findUniqueOrThrow({ where: { id: milkCarton.id } });
  check('carton purchase price untouched', cartonAfter.purchasePrice!.toFixed(2), '75.00');
  const pieceAfter = await prisma.itemUnit.findUniqueOrThrow({ where: { id: milkPiece.id } });
  check('piece purchase price untouched', pieceAfter.purchasePrice!.toFixed(2), '7.00');

  // ===== MILK: sell 3 pieces, then 1 carton ===============================
  console.log('\n[2] Milk sales: 3 pieces @10 then 1 carton @97');
  const si3 = await sales.create(C, B, U, {
    invoiceDate: '2026-10-02', customerId: customer.id,
    lines: [{ itemId: milk.id, quantity: '3', unitName: 'علبة', unitPrice: '10', taxRate: '0' }],
  } as never);
  await sales.post(C, U, si3.id);
  bal = await balance(milk.id);
  check('milk balance after 3 pieces sold', bal!.quantity.toFixed(4), '47.0000');
  const si3Line = (await prisma.salesInvoice.findUniqueOrThrow({ where: { id: si3.id }, include: { lines: true } })).lines[0];
  check('piece sale line total uses piece price', si3Line.lineTotal.toFixed(2), '30.00');

  const si1c = await sales.create(C, B, U, {
    invoiceDate: '2026-10-03', customerId: customer.id,
    lines: [{ itemId: milk.id, quantity: '1', unitName: 'كرتونة', unitPrice: '97', taxRate: '0' }],
  } as never);
  await sales.post(C, U, si1c.id);
  bal = await balance(milk.id);
  check('milk balance after 1 carton sold', bal!.quantity.toFixed(4), '37.0000');
  const si1cDoc = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: si1c.id }, include: { lines: true } });
  check('carton sale base quantity', si1cDoc.lines[0].quantity.toFixed(4), '10.0000');
  check('carton sale snapshot factor', si1cDoc.lines[0].unitFactor!.toFixed(6), '10.000000');
  check('carton sale total = independent carton price (97, not 10x10)', si1cDoc.lines[0].lineTotal.toFixed(2), '97.00');
  check('carton sale exactly one OUT movement', (await movements(si1c.id)).length, 1);

  // ===== CABLE: 2 reels x100m, sell 15m then 50m ==========================
  console.log('\n[3] Cable purchase: 2 reels (factor 100) @ 5000');
  const piCable = await purchases.create(C, B, U, {
    invoiceDate: '2026-10-04', supplierId: supplier.id,
    lines: [{ itemId: cable.id, quantity: '2', unitName: 'بكرة', unitPrice: '5000', taxRate: '0' }],
  } as never);
  await purchases.post(C, U, piCable.id);
  bal = await balance(cable.id);
  check('cable balance qty (2x100m)', bal!.quantity.toFixed(4), '200.0000');
  check('cable balance value', bal!.value.toFixed(4), '10000.0000');
  mov = await movements(piCable.id);
  check('cble IN unit cost per metre', mov[0].unitCost.toFixed(4), '50.0000');

  console.log('\n[4] Cable sales: 15m then 50m');
  const si15 = await sales.create(C, B, U, {
    invoiceDate: '2026-10-05', customerId: customer.id,
    lines: [{ itemId: cable.id, quantity: '15', unitName: 'متر', unitPrice: '20', taxRate: '0' }],
  } as never);
  await sales.post(C, U, si15.id);
  bal = await balance(cable.id);
  check('cable balance after 15m', bal!.quantity.toFixed(4), '185.0000');

  const si50 = await sales.create(C, B, U, {
    invoiceDate: '2026-10-06', customerId: customer.id,
    lines: [{ itemId: cable.id, quantity: '50', unitName: 'متر', unitPrice: '20', taxRate: '0' }],
  } as never);
  await sales.post(C, U, si50.id);
  bal = await balance(cable.id);
  check('cable balance after further 50m', bal!.quantity.toFixed(4), '135.0000');

  // ===== decimal precision: 0.125 reel = 12.5m ============================
  console.log('\n[5] Decimal precision: 0.125 reel = 12.5 metres');
  const siFrac = await sales.create(C, B, U, {
    invoiceDate: '2026-10-07', customerId: customer.id,
    lines: [{ itemId: cable.id, quantity: '0.125', unitName: 'بكرة', unitPrice: '1500', taxRate: '0' }],
  } as never);
  await sales.post(C, U, siFrac.id);
  bal = await balance(cable.id);
  check('cable balance after 0.125 reel', bal!.quantity.toFixed(4), '122.5000');
  const fracLine = (await prisma.salesInvoice.findUniqueOrThrow({ where: { id: siFrac.id }, include: { lines: true } })).lines[0];
  check('fractional line base quantity 12.5000', fracLine.quantity.toFixed(4), '12.5000');
  check('fractional money (0.125 x 1500)', fracLine.lineTotal.toFixed(2), '187.50');

  // ===== RETURNS: partial then full =======================================
  console.log('\n[6] Sales returns: partial (1 of 3 pieces) then full (15m)');
  const si3Lines = (await prisma.salesInvoice.findUniqueOrThrow({ where: { id: si3.id }, include: { lines: true } })).lines;
  const rPart = await returns.createSalesReturn(C, B, U, {
    originalInvoiceId: si3.id, returnDate: '2026-10-08',
    lines: [{ originalLineId: si3Lines[0].id, quantity: '1', unitName: 'علبة' }],
  });
  check('partial return carries original unit snapshot', rPart.lines[0].unitName, 'علبة');
  await returns.postSalesReturn(C, U, rPart.id);
  bal = await balance(milk.id);
  check('milk balance after partial return (+1)', bal!.quantity.toFixed(4), '38.0000');
  check('partial return one IN movement', (await movements(rPart.id)).length, 1);

  const si15Lines = (await prisma.salesInvoice.findUniqueOrThrow({ where: { id: si15.id }, include: { lines: true } })).lines;
  const rFull = await returns.createSalesReturn(C, B, U, {
    originalInvoiceId: si15.id, returnDate: '2026-10-09',
    lines: [{ originalLineId: si15Lines[0].id, quantity: '15', unitName: 'متر' }],
  });
  await returns.postSalesReturn(C, U, rFull.id);
  bal = await balance(cable.id);
  check('cable balance after full return (+15)', bal!.quantity.toFixed(4), '137.5000');
  // return must not exceed the original line
  await expectBadRequest('returning more than the original quantity', () =>
    returns.createSalesReturn(C, B, U, {
      originalInvoiceId: si15.id, returnDate: '2026-10-10',
      lines: [{ originalLineId: si15Lines[0].id, quantity: '999' }],
    }));

  // ===== INACTIVE UNIT =====================================================
  console.log('\n[7] Inactive unit is refused on new documents, reactivation restores it');
  await inventory.deactivateUnit(C, U, milk.id, milkCarton.id);
  const deactivated = await prisma.itemUnit.findUniqueOrThrow({ where: { id: milkCarton.id } });
  check('carton flagged isActive=false', deactivated.isActive, false);
  await expectBadRequest('new invoice with deactivated carton', () =>
    sales.create(C, B, U, {
      invoiceDate: '2026-10-11', customerId: customer.id,
      lines: [{ itemId: milk.id, quantity: '1', unitName: 'كرتونة', unitPrice: '97', taxRate: '0' }],
    } as never));
  // base unit must stay protected
  await expectBadRequest('deactivating the base unit', () =>
    inventory.deactivateUnit(C, U, milk.id, milkPiece.id));
  await inventory.reactivateUnit(C, U, milk.id, milkCarton.id);
  const siRe = await sales.create(C, B, U, {
    invoiceDate: '2026-10-12', customerId: customer.id,
    lines: [{ itemId: milk.id, quantity: '1', unitName: 'كرتونة', unitPrice: '97', taxRate: '0' }],
  } as never);
  await sales.post(C, U, siRe.id);
  bal = await balance(milk.id);
  check('milk balance after reactivated-unit sale', bal!.quantity.toFixed(4), '28.0000');

  // ===== LEGACY line (no unit) ============================================
  console.log('\n[8] Legacy line without unit behaves as base-unit quantity');
  const siLegacy = await sales.create(C, B, U, {
    invoiceDate: '2026-10-13', customerId: customer.id,
    lines: [{ itemId: milk.id, quantity: '2', unitPrice: '10', taxRate: '0' }],
  } as never);
  const legacyLine = (await prisma.salesInvoice.findUniqueOrThrow({ where: { id: siLegacy.id }, include: { lines: true } })).lines[0];
  check('legacy line unitName null', legacyLine.unitName, null);
  check('legacy line unitFactor null', legacyLine.unitFactor, null);
  check('legacy line unitQuantity null', legacyLine.unitQuantity, null);
  check('legacy line quantity kept as entered', legacyLine.quantity.toFixed(4), '2.0000');
  await sales.post(C, U, siLegacy.id);
  bal = await balance(milk.id);
  check('milk balance after legacy sale', bal!.quantity.toFixed(4), '26.0000');

  // ===== NO DUPLICATE MOVEMENTS / double-post guard =======================
  console.log('\n[9] Idempotency: edits create no movements; double post is refused');
  const siEdit = await sales.create(C, B, U, {
    invoiceDate: '2026-10-14', customerId: customer.id,
    lines: [{ itemId: cable.id, quantity: '5', unitName: 'متر', unitPrice: '20', taxRate: '0' }],
  } as never);
  await sales.updateDraft(C, B, U, siEdit.id, {
    invoiceDate: '2026-10-14', customerId: customer.id,
    lines: [{ itemId: cable.id, quantity: '7', unitName: 'متر', unitPrice: '20', taxRate: '0' }],
  } as never);
  check('still no movement after draft edit', (await movements(siEdit.id)).length, 0);
  await sales.post(C, U, siEdit.id);
  check('exactly one movement after post', (await movements(siEdit.id)).length, 1);
  await expectBadRequest('posting the same invoice twice', () => sales.post(C, U, siEdit.id));
  check('still exactly one movement after refused double-post', (await movements(siEdit.id)).length, 1);
  // ===== PURCHASE RETURN: partial then full ===============================
  console.log('\n[10] Purchase returns: partial (1 reel of 2) then full of remaining');
  const piCableDoc = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: piCable.id }, include: { lines: true } });
  const cableBeforeReturn = (await balance(cable.id))!.quantity;
  const prPart = await returns.createPurchaseReturn(C, B, U, {
    originalInvoiceId: piCable.id, returnDate: '2026-10-15',
    lines: [{ originalLineId: piCableDoc.lines[0].id, quantity: '1', unitName: 'بكرة' }],
  } as never);
  await returns.postPurchaseReturn(C, U, prPart.id);
  bal = await balance(cable.id);
  check('cable balance after partial purchase return (-100m)', bal!.quantity.toFixed(4), cableBeforeReturn.minus(100).toFixed(4));
  check('purchase return one OUT movement', (await movements(prPart.id)).length, 1);
  // a return whose unit does not match the original document unit is refused
  await expectBadRequest('return with a unit different from the original document', () =>
    returns.createPurchaseReturn(C, B, U, {
      originalInvoiceId: piCable.id, returnDate: '2026-10-16',
      lines: [{ originalLineId: piCableDoc.lines[0].id, quantity: '1', unitName: 'متر' }],
    } as never));
  // Stock-aware guard: a second full reel cannot go back — most of it was sold.
  const prOverStock = await returns.createPurchaseReturn(C, B, U, {
    originalInvoiceId: piCable.id, returnDate: '2026-10-17',
    lines: [{ originalLineId: piCableDoc.lines[0].id, quantity: '1', unitName: 'بكرة' }],
  } as never);
  const balanceBeforeBlocked = (await balance(cable.id))!.quantity;
  await expectBadRequest('purchase return beyond available stock is blocked at post', () =>
    returns.postPurchaseReturn(C, U, prOverStock.id));
  check('blocked return changed no balance', (await balance(cable.id))!.quantity.toFixed(4), balanceBeforeBlocked.toFixed(4));
  check('blocked return created no movement', (await movements(prOverStock.id)).length, 0);
  // Cumulative control bites at post time: another full reel cannot be posted.
  const prCumulative = await returns.createPurchaseReturn(C, B, U, {
    originalInvoiceId: piCable.id, returnDate: '2026-10-18',
    lines: [{ originalLineId: piCableDoc.lines[0].id, quantity: '1', unitName: 'بكرة' }],
  } as never);
  await expectBadRequest('cumulative purchase return beyond stock is refused at post', () =>
    returns.postPurchaseReturn(C, U, prCumulative.id));
  check('refused cumulative return left no movement', (await movements(prCumulative.id)).length, 0);
  // A feasible partial return inside the remaining stock (0.25 reel = 25m).
  const prFeasible = await returns.createPurchaseReturn(C, B, U, {
    originalInvoiceId: piCable.id, returnDate: '2026-10-19',
    lines: [{ originalLineId: piCableDoc.lines[0].id, quantity: '0.25', unitName: 'بكرة' }],
  } as never);
  await returns.postPurchaseReturn(C, U, prFeasible.id);
  check('feasible purchase return moves exactly 25m out', (await movements(prFeasible.id))[0].quantity.toFixed(4), '25.0000');
  check('cable balance after feasible return (-25m)', (await balance(cable.id))!.quantity.toFixed(4), balanceBeforeBlocked.minus(25).toFixed(4));

  // ===== LOCKED DOCUMENTS ==================================================
  console.log('\n[11] Posted documents are immutable');
  await expectBadRequest('editing a posted sales invoice', () =>
    sales.updateDraft(C, B, U, si50.id, {
      invoiceDate: '2026-10-06', customerId: customer.id,
      lines: [{ itemId: cable.id, quantity: '1', unitName: 'متر', unitPrice: '20', taxRate: '0' }],
    } as never));
  await expectBadRequest('editing a posted purchase invoice', () =>
    purchases.updateDraft(C, B, U, piMilk.id, {
      invoiceDate: '2026-10-01', supplierId: supplier.id,
      lines: [{ itemId: milk.id, quantity: '1', unitName: 'كرتونة', unitPrice: '75', taxRate: '0' }],
    } as never));

  // ===== DATABASE-LEVEL BARCODE & UNICITY GUARANTEES ======================
  console.log('\n[12] Database constraints: barcode trigger and unit unicity');
  await expectDbConstraint('duplicate barcode across item units is rejected by trigger', async () => {
    await prisma.$executeRaw`INSERT INTO item_units (id, "itemId", unit, factor, barcode)
      VALUES (gen_random_uuid(), ${milk.id}, 'صندوق', 20, '62220100')`;
  });
  await expectDbConstraint('duplicate (item, unit) pair rejected by unique constraint', async () => {
    await prisma.itemUnit.create({ data: { itemId: milk.id, unit: 'كرتونة', factor: '10' } });
  });
  // the rejected inserts left no garbage
  const milkUnits = await prisma.itemUnit.count({ where: { itemId: milk.id } });
  check('no orphan unit rows after rejected inserts', milkUnits, 2);

  // ===== BARCODE LABELS through the real service and real item rows =======
  console.log('\n[13] Barcode labels: per-unit barcodes, copies, prices, PDF fallback');
  const labels = app.get(BarcodeLabelsService);
  const labelHtml = await labels.buildHtml(C, milk.id, [
    { unitId: milkPiece.id, copies: 2 },
    { unitId: milkCarton.id, copies: 1 },
  ], { paper: 'A4', showPrice: true, lang: 'ar', autoPrint: false });
  const labelCards = labelHtml.split('<div class="card">').slice(1);
  check('three label cards rendered', labelCards.length, 3);
  check('piece cards carry the piece barcode', labelCards.filter((c) => c.includes('62210001')).length, 2);
  check('carton card carries the carton barcode', labelCards.filter((c) => c.includes('62210010')).length, 1);
  check('labels contain vector barcode bars', labelHtml.includes('<rect'), true);
  check('Arabic item name on labels', labelHtml.includes('لبن'), true);
  check('sale price offered on label', labelHtml.includes('97.00'), true);
  check('purchase cost never reaches a label', labelHtml.includes('75.00'), false);
  const noPrice = await labels.buildHtml(C, milk.id, [{ unitId: milkCarton.id, copies: 1 }], {
    paper: 'THERMAL_80', showPrice: false, lang: 'ar', autoPrint: false,
  });
  check('thermal 80mm CSS present', noPrice.includes('80mm'), true);
  check('price hidden when requested', noPrice.includes('class="price"'), false);
  let pdfFailedAsExpected = false;
  try {
    await labels.renderPdf(C, milk.id, [{ unitId: milkCarton.id, copies: 1 }], {
      paper: 'A4', showPrice: true, lang: 'ar', autoPrint: false,
    });
  } catch (e) {
    pdfFailedAsExpected = e instanceof UnprocessableEntityException;
    console.log('  ✓ PDF without browser reports the print fallback:', (e as UnprocessableEntityException).message.slice(0, 70) + '…');
  }
  check('PDF route degrades gracefully when no browser exists', pdfFailedAsExpected, true);

  const totalMovements = await prisma.stockMovement.count({ where: { companyId: C } });
  console.log(`\nTOTAL stock movements for company: ${totalMovements}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SCENARIO CRASH:', e);
  process.exit(1);
});
