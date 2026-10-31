#!/usr/bin/env node
/**
 * The mandatory multi-unit cycle, driven through the real API against a
 * disposable PostgreSQL database.
 *
 * The unit feature is spread over items, invoices, stock documents and the
 * ledger. A unit test can prove one conversion; only a whole cycle proves that
 * the numbers a warehouse counts and the numbers the ledger keeps are the same
 * numbers. So this scenario runs the exact case that was asked for:
 *
 *   piece (base) · carton = 12 · roll = 5
 *
 *   receive      10 cartons        -> 120 pieces
 *   issue         2 cartons        ->  24 pieces
 *   issue         3 pieces         ->   3 pieces
 *   transfer      2 cartons A -> B ->  24 pieces
 *   count         warehouse A      -> the counted figure is committed
 *   adjustment    -1 carton + 2 pieces (a shortage and a surplus)
 *
 * and then checks, by reading the database directly rather than trusting the
 * API's own answer:
 *
 *   * every warehouse's derived card equals the sum of its own movements;
 *   * the branch balance equals the sum of both warehouses;
 *   * the arithmetic of the units is exact (no drift, no rounding residue);
 *   * changing the carton factor from 12 to 15 afterwards leaves the old
 *     documents exactly as they were, and new documents use 15.
 *
 * Usage (never against a customer database):
 *
 *   DATABASE_URL=postgresql://... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node scripts/scenario-units-cycle.mjs http://127.0.0.1:3000/api/v1
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

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
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

/// The derived per-warehouse card, computed independently of the API: the very
/// definition the stock screen uses, but read straight from the ledger.
async function warehouseCard(companyId, warehouseId, itemId) {
  const rows = await prisma.$queryRaw`
    select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as q
      from stock_movements
     where "companyId" = ${companyId}::uuid
       and "warehouseId" = ${warehouseId}::uuid
       and "itemId" = ${itemId}::uuid`;
  return rows[0].q;
}

async function branchBalance(companyId, branchId, itemId) {
  const rows = await prisma.$queryRaw`
    select "quantity"::text as q from stock_balances
     where "companyId" = ${companyId}::uuid
       and "branchId" = ${branchId}::uuid
       and "itemId" = ${itemId}::uuid
     limit 1`;
  return rows[0]?.q ?? '0';
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
  // The session answers under "user"; reading the top level silently produced
  // two undefined ids and a scenario that blamed the warehouse endpoint.
  const session = me.data?.user ?? me.data ?? {};
  const companyId = session.companyId;
  let branchId = session.branchId ?? null;
  if (companyId && !branchId) {
    // An administrator who works across every branch has none of their own.
    // The cycle needs one real place to receive goods at, so it uses the
    // company's first branch rather than inventing an id.
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
    throw new Error('the session names no company or branch to run the cycle in');
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
    // A branch that has never held stock has no warehouse yet, and a scenario
    // that only runs on somebody else's data proves nothing about a fresh
    // installation. Naming the first one makes it the branch default.
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
      throw new Error(
        `the branch has no warehouse and one could not be made: ${first.status} ${JSON.stringify(first.data)}`,
      );
    }
    mainWarehouse = first.data;
    check('a branch with no warehouse gets its first one, and it is the default', Boolean(mainWarehouse?.id));
  }

  // A second warehouse: the transfer must move goods between two real places.
  const createdWarehouse = await api('/inventory/warehouses', {
    method: 'POST',
    json: {
      branchId,
      code: `SEC-${stamp}`,
      nameEn: `Second store ${stamp}`,
      nameAr: `مخزن ثانٍ ${stamp}`,
    },
  });
  check(
    'a second warehouse exists to receive the transfer',
    createdWarehouse.status === 201,
    `status ${createdWarehouse.status}`,
  );
  const secondWarehouse = createdWarehouse.data;

  const item = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: `UNIT-${stamp}`,
      nameEn: `Unit cycle item ${stamp}`,
      nameAr: `صنف دورة الوحدات ${stamp}`,
      unit: 'قطعة',
      salePrice: '20',
      purchasePrice: '10',
    },
  });
  check('the test item is created in pieces', item.status === 201, `status ${item.status}`);
  const itemId = item.data.id;

  const carton = await api(`/inventory/items/${itemId}/units`, {
    method: 'POST',
    json: { unit: 'كرتونة', factor: '12', salePrice: '230', purchasePrice: '115' },
  });
  const roll = await api(`/inventory/items/${itemId}/units`, {
    method: 'POST',
    json: { unit: 'لفة', factor: '5' },
  });
  check(
    'a carton of 12 pieces and a roll of 5 are saved on the item',
    carton.status === 201 && roll.status === 201,
    `carton ${carton.status}, roll ${roll.status}`,
  );

  const supplier = await api('/parties/suppliers', {
    method: 'POST',
    json: { code: `SUP-${stamp}`, nameEn: `Unit supplier ${stamp}`, nameAr: `مورد ${stamp}` },
  });
  const customer = await api('/parties/customers', {
    method: 'POST',
    json: { code: `CUS-${stamp}`, nameEn: `Unit customer ${stamp}`, nameAr: `عميل ${stamp}` },
  });
  if (supplier.status !== 201 || customer.status !== 201) {
    throw new Error(`party fixtures failed: ${supplier.status}/${customer.status}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  const purchase = await api('/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        {
          itemId,
          description: 'استلام 10 كراتين',
          quantity: '10',
          unitName: 'كرتونة',
          unitPrice: '115',
          taxRate: '0',
        },
      ],
    },
  });
  check('a purchase invoice is created in cartons', purchase.status === 201, `status ${purchase.status}`);
  const purchasePosted = await api(`/purchases/invoices/${purchase.data.id}/post`, { method: 'POST' });
  check('the purchase posts', purchasePosted.status === 201 || purchasePosted.status === 200, `status ${purchasePosted.status}`);

  const storedPurchaseLine = await prisma.$queryRaw`
    select "unitName", "unitFactor"::text as f, "unitQuantity"::text as uq, "quantity"::text as q
      from purchase_invoice_lines where "invoiceId" = ${purchase.data.id}::uuid limit 1`;
  eq('the purchase line remembers the carton', storedPurchaseLine[0]?.unitName, 'كرتونة');
  eq('the purchase line froze the factor 12', Number(storedPurchaseLine[0]?.f), 12);
  eq('the purchase line kept the entered 10 cartons', Number(storedPurchaseLine[0]?.uq), 10);
  eq('the purchase line moved 120 base pieces', Number(storedPurchaseLine[0]?.q), 120);

  const saleCartons = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        { itemId, description: 'صرف 2 كرتونة', quantity: '2', unitName: 'كرتونة', unitPrice: '230', taxRate: '0' },
      ],
    },
  });
  check('a sales invoice is created in cartons', saleCartons.status === 201, `status ${saleCartons.status}`);
  await api(`/sales/invoices/${saleCartons.data.id}/post`, { method: 'POST' });

  const salePieces = await api('/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.data.id,
      warehouseId: mainWarehouse.id,
      lines: [
        { itemId, description: 'صرف 3 قطع', quantity: '3', unitPrice: '20', taxRate: '0' },
      ],
    },
  });
  check('a sales invoice is created in pieces', salePieces.status === 201, `status ${salePieces.status}`);
  await api(`/sales/invoices/${salePieces.data.id}/post`, { method: 'POST' });

  let card = Number(await warehouseCard(companyId, mainWarehouse.id, itemId));
  eq('after receipt 10 cartons and issues of 2 cartons and 3 pieces, the store holds 93', card, 93);

  const transfer = await api('/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'TRANSFER',
      branchId,
      fromWarehouseId: mainWarehouse.id,
      toWarehouseId: secondWarehouse.id,
      documentDate: today,
      lines: [
        { itemId, quantity: '2', unitName: 'كرتونة', unitCost: '10' },
      ],
    },
  });
  check('a transfer is created in cartons', transfer.status === 201, `status ${transfer.status}`);
  const transferPosted = await api(`/inventory/stock-documents/${transfer.data.id}/post`, { method: 'POST' });
  check('the transfer posts', transferPosted.status === 201 || transferPosted.status === 200, `status ${transferPosted.status}`);

  const transferLine = await prisma.$queryRaw`
    select "unitName", "unitFactor"::text as f, "unitQuantity"::text as uq, "quantity"::text as q
      from stock_document_lines where "documentId" = ${transfer.data.id}::uuid limit 1`;
  eq('the transfer moved 24 base pieces', Number(transferLine[0]?.q), 24);

  const mainAfterTransfer = Number(await warehouseCard(companyId, mainWarehouse.id, itemId));
  const secondAfterTransfer = Number(await warehouseCard(companyId, secondWarehouse.id, itemId));
  eq('the sending store keeps 69', mainAfterTransfer, 69);
  eq('the receiving store holds 24', secondAfterTransfer, 24);
  eq(
    'nothing was created or lost by the transfer',
    mainAfterTransfer + secondAfterTransfer,
    93,
  );

  // ── count ──────────────────────────────────────────────────────────────
  const count = await api('/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'COUNT',
      branchId,
      toWarehouseId: mainWarehouse.id,
      documentDate: today,
      lines: [{ itemId, countedQuantity: '4', unitName: 'كرتونة' }],
    },
  });
  check('a physical count is created', count.status === 201, `status ${count.status}`);
  const countPosted = await api(`/inventory/stock-documents/${count.data.id}/post`, { method: 'POST' });
  check('the count posts', countPosted.status === 201 || countPosted.status === 200, `status ${countPosted.status}`);
  const mainAfterCount = Number(await warehouseCard(companyId, mainWarehouse.id, itemId));
  eq('the counted figure (4 cartons = 48) becomes the store balance', mainAfterCount, 48);

  // The count is also a report the store manager signs: the book figure, the
  // counted figure and the difference, in the units the count was written in.
  const variance = await api(
    `/inventory/reports/stock-take-variance?warehouseId=${mainWarehouse.id}`,
  );
  check('the stock-take difference report is served', variance.status === 200, `status ${variance.status}`);
  const varianceRow = (variance.data?.rows ?? []).find((row) => row.documentNumber === count.data.documentNumber);
  check('the count appears on the difference report', Boolean(varianceRow));
  if (varianceRow) {
    eq('the report shows the book figure before the count', Number(varianceRow.systemQuantity), 69);
    eq('the report shows what the shelf actually held', Number(varianceRow.countedQuantity), 48);
    eq('the report shows the difference that was posted', Number(varianceRow.varianceQuantity), -21);
    check('the report keeps the unit the count was entered in', varianceRow.unitName === 'كرتونة', String(varianceRow.unitName));
    eq('the report states the factor behind the count', Number(varianceRow.unitFactor), 12);
  }

  // Printing the sheet without costs must not leak the value of the loss.
  const varianceHidden = await api(
    `/inventory/reports/stock-take-variance/print?warehouseId=${mainWarehouse.id}&showCost=false`,
  );
  const hiddenHtml = typeof varianceHidden.data === 'string' ? varianceHidden.data : '';
  check(
    'the difference sheet prints without a cost column',
    varianceHidden.status === 200 &&
      !/Unit cost|Variance cost|تكلفة الوحدة|تكلفة الفرق|Shortage cost/i.test(hiddenHtml),
    `status ${varianceHidden.status}`,
  );
  check(
    'the difference sheet still prints the item and its quantities',
    hiddenHtml.includes(`UNIT-${stamp}`) &&
      /48/.test(hiddenHtml) &&
      /21/.test(hiddenHtml),
    'the sheet must still say what was counted and by how much it differed',
  );

  // ── a shortage and a surplus ────────────────────────────────────────────
  const shortage = await api('/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'ADJUSTMENT',
      branchId,
      toWarehouseId: mainWarehouse.id,
      documentDate: today,
      reason: 'عجز تجريبي',
      lines: [{ itemId, quantity: '-1', unitName: 'كرتونة', unitCost: '10' }],
    },
  });
  check('a shortage adjustment is created', shortage.status === 201, `status ${shortage.status}`);
  await api(`/inventory/stock-documents/${shortage.data.id}/post`, { method: 'POST' });

  const surplus = await api('/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'ADJUSTMENT',
      branchId,
      toWarehouseId: mainWarehouse.id,
      documentDate: today,
      reason: 'زيادة تجريبية',
      lines: [{ itemId, quantity: '2', unitCost: '10' }],
    },
  });
  check('a surplus adjustment is created', surplus.status === 201, `status ${surplus.status}`);
  await api(`/inventory/stock-documents/${surplus.data.id}/post`, { method: 'POST' });

  // ── the books must agree ────────────────────────────────────────────────
  const mainFinal = Number(await warehouseCard(companyId, mainWarehouse.id, itemId));
  const secondFinal = Number(await warehouseCard(companyId, secondWarehouse.id, itemId));
  eq('main store: 120 − 24 − 3 − 24 → count 48 → −12 + 2', mainFinal, 38);
  eq('second store still holds the 24 it received', secondFinal, 24);

  const balance = Number(await branchBalance(companyId, branchId, itemId));
  eq('the branch balance equals both stores together', balance, mainFinal + secondFinal);

  const movements = await prisma.$queryRaw`
    select count(*)::int as n,
           coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as net
      from stock_movements
     where "companyId" = ${companyId}::uuid and "itemId" = ${itemId}::uuid`;
  eq(
    'every movement of this item is accounted for in the branch balance',
    Number(movements[0].net),
    balance,
  );
  check('the item moved in more than eight movements', movements[0].n >= 8, `${movements[0].n} movements`);

  const fractional = await prisma.$queryRaw`
    select count(*)::int as n from stock_movements
     where "companyId" = ${companyId}::uuid and "itemId" = ${itemId}::uuid
       and quantity <> round(quantity)`;
  eq('no movement carries a rounding residue', fractional[0].n, 0);

  // ── history does not follow the item's settings ─────────────────────────
  const unitRow = await prisma.itemUnit.findFirst({
    where: { itemId, unit: 'كرتونة' },
    select: { id: true },
  });
  const changed = await api(`/inventory/items/${itemId}/units/${unitRow.id}`, {
    method: 'PATCH',
    json: { factor: '15' },
  });
  check('the carton factor is changed to 15', changed.status === 200, `status ${changed.status}`);

  const oldPurchase = await api(`/purchases/invoices/${purchase.data.id}`);
  const oldLine = oldPurchase.data?.lines?.[0] ?? {};
  eq('the old purchase still says carton', oldLine.unitName ?? oldLine.unit, 'كرتونة');
  eq('the old purchase still holds factor 12, not 15', Number(oldLine.unitFactor), 12);
  eq('the old purchase still holds 120 base pieces', Number(oldLine.quantity), 120);

  const newPurchase = await api('/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: mainWarehouse.id,
      lines: [{ itemId, description: 'بعد تغيير المعامل', quantity: '1', unitName: 'كرتونة', unitPrice: '140', taxRate: '0' }],
    },
  });
  check('a new purchase is created after the change', newPurchase.status === 201, `status ${newPurchase.status}`);
  const newLine = await prisma.$queryRaw`
    select "unitFactor"::text as f, "quantity"::text as q
      from purchase_invoice_lines where "invoiceId" = ${newPurchase.data.id}::uuid limit 1`;
  eq('the new purchase uses the new factor 15', Number(newLine[0]?.f), 15);
  eq('one carton now receives 15 pieces', Number(newLine[0]?.q), 15);

  await api(`/purchases/invoices/${newPurchase.data.id}/post`, { method: 'POST' });
  const afterNew = Number(await warehouseCard(companyId, mainWarehouse.id, itemId));
  eq('the new receipt adds exactly 15 pieces', afterNew, mainFinal + 15);

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
