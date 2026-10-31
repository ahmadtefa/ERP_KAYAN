#!/usr/bin/env node
/**
 * The cable-and-carton multi-unit scenario, driven through the real API
 * against a disposable PostgreSQL database.
 *
 * It is the worked example from the requirement, run for real rather than
 * reasoned about:
 *
 *   metre (base) · reel = 500 m
 *   piece (base) · carton = 24 pieces, whole cartons only
 *
 *   buy   10 reels            -> 5,000 m
 *   sell     100 m            -> 4,900 m     (shown as 9 reels + 400 m)
 *   sell   1 reel             -> 4,400 m
 *   buy    2 reels            -> 5,400 m
 *   return   100 m            -> 5,500 m
 *   return 1 reel             -> 6,000 m
 *   transfer 1 reel to store 2-> 5,500 m here, 500 m there
 *   factor 500 -> 400 (history untouched)
 *   sell   1 reel             -> 5,100 m     (400 m now, not 500)
 *   buy      500 m directly   -> 5,600 m
 *
 *   buy   10 cartons          ->   240 pieces
 *   sell      18 pieces       ->   222 pieces
 *   sell   0.5 carton         -> refused, nothing moved
 *
 * Every number is read back from the database as well as from the API, so a
 * display that flatters the arithmetic cannot pass. Prices are checked in both
 * directions: 5,000 a reel is 10 a metre, a carton of 24 at a 5-a-piece item
 * price is 120, and a price that contradicts the item is refused unless it is
 * stated as deliberate.
 *
 * Usage (never against a customer database):
 *
 *   DATABASE_URL=postgresql://... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node scripts/scenario-multiunit-cable-carton.mjs http://127.0.0.1:3000/api/v1
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  throw new Error(
    'DATABASE_URL is required: this scenario must run on disposable PostgreSQL, never a customer database.',
  );
}

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const D = (value) => new Prisma.Decimal(String(value));

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
}

/// NestJS' validation filter reports the sentence under `detail`; older
/// controllers under `message`. Read both rather than blame the endpoint.
function messageOf(data) {
  return String(data?.detail ?? data?.message ?? '');
}

function money(value) {
  return Number(new Prisma.Decimal(String(value ?? 0)).toFixed(4));
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token && !options.noAuth) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.json === undefined ? options.body : JSON.stringify(options.json),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();
  return { status: response.status, data, headers: response.headers };
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });

/// The per-warehouse card, computed from the ledger alone: the definition the
/// stock screen uses, without asking the API for its opinion.
async function warehouseCard(companyId, warehouseId, itemId) {
  const rows = await prisma.$queryRaw`
    select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as q
      from stock_movements
     where "companyId" = ${companyId}::uuid
       and "warehouseId" = ${warehouseId}::uuid
       and "itemId" = ${itemId}::uuid`;
  return money(rows[0].q);
}

async function branchBalance(companyId, branchId, itemId) {
  const rows = await prisma.$queryRaw`
    select "quantity"::text as q from stock_balances
     where "companyId" = ${companyId}::uuid
       and "branchId" = ${branchId}::uuid
       and "itemId" = ${itemId}::uuid
     limit 1`;
  return money(rows[0]?.q ?? 0);
}

async function movementsOf(companyId, itemId) {
  return prisma.$queryRaw`
    select id::text as id, "referenceType", direction, quantity::text as quantity,
           "enteredUnit", "enteredQuantity"::text as entered, "unitFactor"::text as factor
      from stock_movements
     where "companyId" = ${companyId}::uuid and "itemId" = ${itemId}::uuid
     order by "createdAt" asc`;
}

async function main() {
  const signedIn = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  if (signedIn.status !== 201) {
    throw new Error(`sign in failed: ${signedIn.status} ${JSON.stringify(signedIn.data)}`);
  }
  token = signedIn.data.accessToken;
  const me = await api('/auth/me');
  const session = me.data?.user ?? me.data ?? {};
  const companyId = session.companyId;
  let branchId = session.branchId ?? null;
  if (companyId && !branchId) {
    const [firstBranch] = await prisma.$queryRaw`
      select id::text as id from branches
       where "companyId" = ${companyId}::uuid and "deletedAt" is null
       order by code limit 1`;
    branchId = firstBranch?.id ?? null;
  }
  check(
    'signed in with a company and a branch',
    Boolean(companyId && branchId),
    `company ${String(companyId).slice(0, 8)}, branch ${String(branchId).slice(0, 8)}`,
  );
  if (!companyId || !branchId) {
    throw new Error('the session names no company or branch to run the scenario in');
  }

  // ── fixtures ────────────────────────────────────────────────────────────
  const warehouses = await api('/inventory/warehouses');
  const warehouseRows = Array.isArray(warehouses.data)
    ? warehouses.data
    : warehouses.data?.items ?? [];
  let mainWarehouse =
    warehouseRows.find((row) => row.branchId === branchId && row.isDefault) ??
    warehouseRows.find((row) => row.branchId === branchId);
  if (!mainWarehouse) {
    const first = await api('/inventory/warehouses', {
      method: 'POST',
      json: {
        branchId,
        code: `MAIN-${stamp}`,
        nameEn: `Main store ${stamp}`,
        nameAr: `المخزن الرئيسي ${stamp}`,
      },
    });
    if (first.status >= 300) {
      throw new Error(`no warehouse and one could not be made: ${first.status}`);
    }
    mainWarehouse = first.data;
  }

  const secondWarehouseResponse = await api('/inventory/warehouses', {
    method: 'POST',
    json: {
      branchId,
      code: `SEC-${stamp}`,
      nameEn: `Second store ${stamp}`,
      nameAr: `مخزن ثانٍ ${stamp}`,
    },
  });
  check(
    'a second warehouse exists for the transfer',
    secondWarehouseResponse.status === 201,
    `status ${secondWarehouseResponse.status}`,
  );
  const secondWarehouse = secondWarehouseResponse.data;

  const supplier = await api('/parties/suppliers', {
    method: 'POST',
    json: { code: `SUP-${stamp}`, nameEn: `Cable supplier ${stamp}`, nameAr: `مورد ${stamp}` },
  });
  const customer = await api('/parties/customers', {
    method: 'POST',
    json: { code: `CUS-${stamp}`, nameEn: `Cable customer ${stamp}`, nameAr: `عميل ${stamp}` },
  });
  if (supplier.status !== 201 || customer.status !== 201) {
    throw new Error(`party fixtures failed: ${supplier.status}/${customer.status}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // ── the cable: metre (base), reel = 500 ─────────────────────────────────
  const cableItem = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: `CBL-${stamp}`,
      nameEn: `Cable ${stamp}`,
      nameAr: `كابل ${stamp}`,
      unit: 'متر',
      salePrice: '10',
      purchasePrice: '8',
    },
  });
  check('the cable item is created in metres at 10 a metre', cableItem.status === 201, `status ${cableItem.status}`);
  const cableId = cableItem.data.id;

  const reel = await api(`/inventory/items/${cableId}/units`, {
    method: 'POST',
    json: {
      unit: 'لفة',
      abbreviation: 'لف',
      factor: '500',
      allowFraction: true,
      usedInSales: true,
      usedInPurchases: true,
      salePrice: '5000',
      purchasePrice: '4000',
      sortOrder: 1,
    },
  });
  check('a reel of 500 metres is saved on the item', reel.status === 201, `status ${reel.status}`);
  const reelRow = (reel.data?.items ?? []).find((row) => row.unit === 'لفة') ?? {};
  eq('the saved factor is 500', Number(reelRow.factor), 500);
  eq('the reel carries its short label', reelRow.abbreviation, 'لف');
  eq('5,000 a reel reads as 10 a metre', money(reelRow.perBaseSalePrice), 10);
  eq('4,000 a reel reads as 8 a metre', money(reelRow.perBasePurchasePrice), 8);
  check('the price agrees with the item price', reelRow.salePriceAgrees === true, String(reelRow.salePriceAgrees));

  // ── 1. buy ten reels ────────────────────────────────────────────────────
  const purchaseTen = await api('/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        {
          itemId: cableId,
          description: 'استلام 10 لفات',
          quantity: '10',
          unitName: 'لفة',
          unitPrice: '4000',
          taxRate: '0',
        },
      ],
    },
  });
  check('a purchase of 10 reels is created', purchaseTen.status === 201, `status ${purchaseTen.status}`);
  await api(`/purchases/invoices/${purchaseTen.data.id}/post`, { method: 'POST' });

  const purchaseLine = await prisma.$queryRaw`
    select "unitName", "unitFactor"::text as f, "unitQuantity"::text as uq, "quantity"::text as q,
           "unitPrice"::text as p
      from purchase_invoice_lines where "invoiceId" = ${purchaseTen.data.id}::uuid limit 1`;
  eq('the purchase line remembers the reel', purchaseLine[0]?.unitName, 'لفة');
  eq('the purchase line froze factor 500', money(purchaseLine[0]?.f), 500);
  eq('the purchase line kept the entered 10', money(purchaseLine[0]?.uq), 10);
  eq('TEST 1: ten reels put 5,000 metres in stock', money(purchaseLine[0]?.q), 5000);
  eq('the store holds 5,000 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 5000);

  const receivedMovement = (await movementsOf(companyId, cableId)).find(
    (row) => row.referenceType === 'PURCHASE_INVOICE',
  );
  eq('the movement records the unit that was typed', receivedMovement?.enteredUnit, 'لفة');
  eq('the movement records the entered quantity', money(receivedMovement?.entered), 10);
  eq('the movement records the factor at that moment', money(receivedMovement?.factor), 500);
  eq('the movement records the converted base quantity', money(receivedMovement?.quantity), 5000);

  // ── 2. sell 100 metres ──────────────────────────────────────────────────
  const saleMetres = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        { itemId: cableId, description: 'بيع 100 متر', quantity: '100', unitName: 'متر', unitPrice: '10', taxRate: '0' },
      ],
    },
  });
  check('a sale of 100 metres is created', saleMetres.status === 201, `status ${saleMetres.status}`);
  const saleMetresPosted = await api(`/sales/invoices/${saleMetres.data.id}/post`, { method: 'POST' });
  check('the sale posts', saleMetresPosted.status === 200 || saleMetresPosted.status === 201, `status ${saleMetresPosted.status}`);
  eq('TEST 2: 5,000 − 100 = 4,900 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 4900);

  const balanceAfterMetres = await api(`/inventory/stock?itemId=${cableId}&branchId=${branchId}`);
  const cableBalance = (balanceAfterMetres.data ?? []).find((row) => row.itemId === cableId) ?? {};
  eq('the stock screen reports 4,900.0000 base metres', money(cableBalance.quantity), 4900);
  eq('and says 9 reels + 400 metres', cableBalance.displayQuantity, '9 لفة + 400 متر');

  // ── 3. sell one reel, with no price typed ───────────────────────────────
  const saleReel = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [{ itemId: cableId, description: 'بيع لفة', quantity: '1', unitName: 'لفة', taxRate: '0' }],
    },
  });
  check('a sale of one reel is created without a typed price', saleReel.status === 201, `status ${saleReel.status}`);
  const saleReelLine = saleReel.data?.lines?.[0] ?? {};
  eq('TEST 9: the reel defaults to its own price of 5,000', money(saleReelLine.unitPrice), 5000);
  eq('the line total is 5,000', money(saleReelLine.lineTotal), 5000);
  await api(`/sales/invoices/${saleReel.data.id}/post`, { method: 'POST' });
  eq('TEST 3: 4,900 − 500 = 4,400 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 4400);

  // ── 4. buy two more reels ───────────────────────────────────────────────
  const purchaseTwo = await api('/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        { itemId: cableId, description: 'استلام لفتين', quantity: '2', unitName: 'لفة', unitPrice: '4000', taxRate: '0' },
      ],
    },
  });
  check('a purchase of two reels is created', purchaseTwo.status === 201, `status ${purchaseTwo.status}`);
  await api(`/purchases/invoices/${purchaseTwo.data.id}/post`, { method: 'POST' });
  eq('TEST 4: 4,400 + 1,000 = 5,400 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 5400);

  // ── 5. return 100 metres ────────────────────────────────────────────────
  const saleMetresLineId = saleMetres.data?.lines?.[0]?.id;
  const returnMetres = await api('/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: saleMetres.data.id,
      returnDate: today,
      reason: 'مرتجع 100 متر',
      lines: [{ originalLineId: saleMetresLineId, quantity: '100', unitName: 'متر' }],
    },
  });
  check('a return of 100 metres is created', returnMetres.status === 201, `status ${returnMetres.status}`);
  await api(`/returns/sales/${returnMetres.data.id}/post`, { method: 'POST' });
  eq('TEST 5: 5,400 + 100 = 5,500 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 5500);

  // ── 9. return in the unit the sale was written in ───────────────────────
  const saleReelLineId = saleReel.data?.lines?.[0]?.id;
  const returnReel = await api('/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: saleReel.data.id,
      returnDate: today,
      reason: 'مرتجع لفة كاملة',
      lines: [{ originalLineId: saleReelLineId, quantity: '1', unitName: 'لفة' }],
    },
  });
  check('a return of one reel is created', returnReel.status === 201, `status ${returnReel.status}`);
  await api(`/returns/sales/${returnReel.data.id}/post`, { method: 'POST' });
  eq('returning a reel puts back 500 metres, not 1', await warehouseCard(companyId, mainWarehouse.id, cableId), 6000);

  const returnMovement = (await movementsOf(companyId, cableId)).filter(
    (row) => row.referenceType === 'SALES_RETURN',
  );
  const reelReturn = returnMovement.find((row) => row.enteredUnit === 'لفة');
  eq('the return movement says reel', reelReturn?.enteredUnit, 'لفة');
  eq('the return movement says one of them', money(reelReturn?.entered), 1);
  eq('the return movement moved 500 base metres', money(reelReturn?.quantity), 500);

  // ── 10. transfer a reel to the second store ─────────────────────────────
  const transfer = await api('/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'TRANSFER',
      branchId,
      fromWarehouseId: mainWarehouse.id,
      toWarehouseId: secondWarehouse.id,
      documentDate: today,
      lines: [{ itemId: cableId, quantity: '1', unitName: 'لفة', unitCost: '8' }],
    },
  });
  check('a transfer of one reel is created', transfer.status === 201, `status ${transfer.status}`);
  await api(`/inventory/stock-documents/${transfer.data.id}/post`, { method: 'POST' });
  eq('TEST 10: the sending store keeps 5,500 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 5500);
  eq('the receiving store holds 500 metres', await warehouseCard(companyId, secondWarehouse.id, cableId), 500);
  eq('nothing was created or lost', await branchBalance(companyId, branchId, cableId), 6000);

  // ── 7. price coherence ──────────────────────────────────────────────────
  const priceItem = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: `PRC-${stamp}`,
      nameEn: `Price item ${stamp}`,
      nameAr: `صنف الأسعار ${stamp}`,
      unit: 'متر',
      salePrice: '10',
      purchasePrice: '8',
    },
  });
  check('a second item exists for the price checks', priceItem.status === 201, `status ${priceItem.status}`);
  const priceItemId = priceItem.data.id;

  const contradictory = await api(`/inventory/items/${priceItemId}/units`, {
    method: 'POST',
    json: { unit: 'لفة', factor: '500', salePrice: '500' },
  });
  check(
    'a reel of 500 priced at 500 is refused as a misplaced digit',
    contradictory.status === 400,
    `status ${contradictory.status} ${messageOf(contradictory.data).slice(0, 200)}`,
  );
  check(
    'the refusal names the price that would have agreed',
    messageOf(contradictory.data).includes('5000'),
    messageOf(contradictory.data).slice(0, 200),
  );

  const discounted = await api(`/inventory/items/${priceItemId}/units`, {
    method: 'POST',
    json: { unit: 'لفة', factor: '500', salePrice: '4800' },
  });
  check('a 4% pack discount is allowed', discounted.status === 201, `status ${discounted.status}`);
  const discountWarning = (discounted.data?.priceWarnings ?? []).find((row) => row.kind === 'sale');
  eq('the discount is reported per base unit', money(discountWarning?.perBaseUnit), 9.6);
  eq('and compared with the item price', money(discountWarning?.itemPerBaseUnit), 10);

  const deliberate = await api(`/inventory/items/${priceItemId}/units`, {
    method: 'POST',
    json: { unit: 'صندوق', factor: '500', salePrice: '500', allowPriceOverride: true },
  });
  check(
    'a contradictory price is accepted when it is stated as intended',
    deliberate.status === 201,
    `status ${deliberate.status}`,
  );

  // ── 8. the factor changes; history does not ─────────────────────────────
  const cableUnitRow = await prisma.itemUnit.findFirst({
    where: { itemId: cableId, unit: 'لفة' },
    select: { id: true },
  });
  const factorChange = await api(`/inventory/items/${cableId}/units/${cableUnitRow.id}`, {
    method: 'PATCH',
    json: { factor: '400' },
  });
  check('the reel factor is changed from 500 to 400', factorChange.status === 200, `status ${factorChange.status}`);
  eq(
    'the change is reported as a price contradiction, not silently applied',
    (factorChange.data?.priceWarnings ?? []).length > 0 ? 'warned' : 'silent',
    'warned',
  );

  eq('the balance did not move when the factor changed', await branchBalance(companyId, branchId, cableId), 6000);
  const oldPurchase = await api(`/purchases/invoices/${purchaseTen.data.id}`);
  const oldPurchaseLine = oldPurchase.data?.lines?.[0] ?? {};
  eq('TEST 8: the old purchase still says reel', oldPurchaseLine.unitName, 'لفة');
  eq('the old purchase still holds factor 500', money(oldPurchaseLine.unitFactor), 500);
  eq('the old purchase still holds 5,000 base metres', money(oldPurchaseLine.quantity), 5000);
  const oldMovement = (await movementsOf(companyId, cableId)).find(
    (row) => row.referenceType === 'PURCHASE_INVOICE',
  );
  eq('the old movement still holds factor 500', money(oldMovement?.factor), 500);
  eq('the old movement still moved 5,000 metres', money(oldMovement?.quantity), 5000);

  const saleNewFactor = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        { itemId: cableId, description: 'بيع لفة بعد تغيير المعامل', quantity: '1', unitName: 'لفة', unitPrice: '4000', taxRate: '0' },
      ],
    },
  });
  check('a sale after the change is created', saleNewFactor.status === 201, `status ${saleNewFactor.status}`);
  await api(`/sales/invoices/${saleNewFactor.data.id}/post`, { method: 'POST' });
  eq('one reel now takes 400 metres: 5,500 − 400', await warehouseCard(companyId, mainWarehouse.id, cableId), 5100);
  const newLine = await prisma.$queryRaw`
    select "unitFactor"::text as f, "quantity"::text as q
      from sales_invoice_lines where "invoiceId" = ${saleNewFactor.data.id}::uuid limit 1`;
  eq('the new line uses factor 400', money(newLine[0]?.f), 400);
  eq('the new line moves 400 base metres', money(newLine[0]?.q), 400);

  // ── 6. metres bought directly, exactly as asked ─────────────────────────
  const purchaseMetres = await api('/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        { itemId: cableId, description: 'شراء 500 متر مباشرة', quantity: '500', unitName: 'متر', unitPrice: '8', taxRate: '0' },
      ],
    },
  });
  check('500 metres can be bought directly, in metres', purchaseMetres.status === 201, `status ${purchaseMetres.status}`);
  await api(`/purchases/invoices/${purchaseMetres.data.id}/post`, { method: 'POST' });
  eq('5,100 + 500 = 5,600 metres', await warehouseCard(companyId, mainWarehouse.id, cableId), 5600);

  // ── 12. the reports read the same ledger ────────────────────────────────
  const ledger = await api(`/inventory/stock/${cableId}/ledger`);
  check('the stock card is served', ledger.status === 200, `status ${ledger.status}`);
  const ledgerRows = ledger.data?.movements ?? [];
  const reelRows = ledgerRows.filter((row) => row.enteredUnit === 'لفة');
  check('the stock card shows movements in reels', reelRows.length >= 3, `${reelRows.length} reel rows`);
  const metreRows = ledgerRows.filter((row) => row.enteredUnit === 'متر');
  check('and movements in metres', metreRows.length >= 2, `${metreRows.length} metre rows`);
  const firstReelRow = reelRows[0] ?? {};
  eq('a reel row shows "10 لفة" rather than 5,000 in the unit column', firstReelRow.displayQuantity, '10 لفة');
  eq('a reel row still carries the base quantity', money(firstReelRow.quantity), 5000);
  // The branch keeps 5,600 m and the second store 500 m, so the card's last
  // running total is 6,100 m - fifteen reels of 400 plus a hundred metres.
  const lastRow = ledgerRows[ledgerRows.length - 1] ?? {};
  eq(
    'the running total is said in reels and metres',
    lastRow.runningDisplay,
    '15 لفة + 100 متر',
  );
  eq('the branch balance is 6,100 metres across both stores', await branchBalance(companyId, branchId, cableId), 6100);

  const warehouseSplit = await api(`/inventory/stock/by-warehouse?branchId=${branchId}&itemIds=${cableId}`);
  const splitRow = (warehouseSplit.data ?? []).find((row) => row.itemId === cableId) ?? {};
  eq('the warehouse report adds up to the branch balance', money(splitRow.total), 6100);

  // ── 6. the carton: 24 pieces, whole cartons only ────────────────────────
  const cartonItem = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: `CTN-${stamp}`,
      nameEn: `Carton item ${stamp}`,
      nameAr: `صنف الكراتين ${stamp}`,
      unit: 'قطعة',
      salePrice: '5',
      purchasePrice: '4',
    },
  });
  check('the carton item is created in pieces at 5 a piece', cartonItem.status === 201, `status ${cartonItem.status}`);
  const cartonId = cartonItem.data.id;

  const cartonUnit = await api(`/inventory/items/${cartonId}/units`, {
    method: 'POST',
    json: { unit: 'كرتونة', factor: '24', allowFraction: false, usedInSales: true, usedInPurchases: true },
  });
  check('a carton of 24 is saved with whole units only', cartonUnit.status === 201, `status ${cartonUnit.status}`);
  const cartonRow = (cartonUnit.data?.items ?? []).find((row) => row.unit === 'كرتونة') ?? {};
  eq('the carton refuses fractions', cartonRow.allowFraction, false);
  check('the carton has no price of its own', cartonRow.salePrice === null, String(cartonRow.salePrice));

  const purchaseCartons = await api('/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: mainWarehouse.id,
      lines: [{ itemId: cartonId, description: 'استلام 10 كراتين', quantity: '10', unitName: 'كرتونة', taxRate: '0' }],
    },
  });
  check('a purchase of 10 cartons is created without a typed price', purchaseCartons.status === 201, `status ${purchaseCartons.status}`);
  eq(
    'TEST 9: a carton of 24 defaults to 4 x 24 = 96',
    money(purchaseCartons.data?.lines?.[0]?.unitPrice),
    96,
  );
  await api(`/purchases/invoices/${purchaseCartons.data.id}/post`, { method: 'POST' });
  eq('TEST 6: ten cartons put 240 pieces in stock', await warehouseCard(companyId, mainWarehouse.id, cartonId), 240);

  const salePieces = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [{ itemId: cartonId, description: 'بيع 18 قطعة', quantity: '18', unitPrice: '5', taxRate: '0' }],
    },
  });
  check('a sale of 18 pieces is created', salePieces.status === 201, `status ${salePieces.status}`);
  await api(`/sales/invoices/${salePieces.data.id}/post`, { method: 'POST' });
  eq('TEST 6: 240 − 18 = 222 pieces', await warehouseCard(companyId, mainWarehouse.id, cartonId), 222);

  const halfCarton = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [{ itemId: cartonId, description: 'نصف كرتونة', quantity: '0.5', unitName: 'كرتونة', unitPrice: '120', taxRate: '0' }],
    },
  });
  check('TEST 7: half a carton is refused', halfCarton.status === 400, `status ${halfCarton.status}`);
  check(
    'the refusal explains that the unit takes whole numbers',
    /fractional|whole/i.test(messageOf(halfCarton.data)),
    messageOf(halfCarton.data).slice(0, 200),
  );
  eq('the refused sale moved no stock at all', await warehouseCard(companyId, mainWarehouse.id, cartonId), 222);

  const cartonBalance = await api(`/inventory/stock?itemId=${cartonId}&branchId=${branchId}`);
  const cartonBalanceRow = (cartonBalance.data ?? []).find((row) => row.itemId === cartonId) ?? {};
  eq('the carton item reports 222 pieces', money(cartonBalanceRow.quantity), 222);
  eq('and says 9 cartons + 6 pieces', cartonBalanceRow.displayQuantity, '9 كرتونة + 6 قطعة');

  // ── the ledger and the balance agree, to the last piece ─────────────────
  const netCable = (await movementsOf(companyId, cableId)).reduce(
    (sum, row) => sum.plus(row.direction === 'IN' ? row.quantity : D(row.quantity).negated()),
    D(0),
  );
  eq('every cable movement adds up to the branch balance', money(netCable), await branchBalance(companyId, branchId, cableId));
  const netCarton = (await movementsOf(companyId, cartonId)).reduce(
    (sum, row) => sum.plus(row.direction === 'IN' ? row.quantity : D(row.quantity).negated()),
    D(0),
  );
  eq('every carton movement adds up to the branch balance', money(netCarton), await branchBalance(companyId, branchId, cartonId));

  const unlabelled = await prisma.$queryRaw`
    select count(*)::int as n from stock_movements
     where "companyId" = ${companyId}::uuid
       and "itemId" in (${cableId}::uuid, ${cartonId}::uuid)
       and ("enteredUnit" is null or "unitFactor" is null or "unitFactor" <= 0)`;
  eq('no movement of these items is missing its unit snapshot', unlabelled[0].n, 0);

  const residue = await prisma.$queryRaw`
    select count(*)::int as n from stock_movements
     where "companyId" = ${companyId}::uuid
       and "itemId" in (${cableId}::uuid, ${cartonId}::uuid)
       and quantity <> round(quantity)`;
  eq('no movement carries a floating-point residue', residue[0].n, 0);

  const failures = results.filter((row) => !row.ok);
  console.log(
    `\n${results.length - failures.length}/${results.length} checks passed` +
      (failures.length ? ` — failures:\n  ${failures.map((row) => row.name).join('\n  ')}` : ''),
  );
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
