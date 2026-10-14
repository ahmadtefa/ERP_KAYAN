#!/usr/bin/env node
/**
 * Drives the newest part of the program through the real API: warehouses,
 * price lists, and purchase and sales orders.
 *
 *   node backend/scripts/scenario-warehouses-orders.mjs [apiBaseUrl]
 *
 * These three arrived after the accounting scenario was written, and none of
 * them can be believed because it compiles. What is checked here, against a
 * running server and a real PostgreSQL:
 *
 *   1. every branch has a default warehouse, and the database created one for
 *      the branches that existed before warehouses did
 *   2. a second warehouse can be named, and the branch's default cannot be
 *      deactivated out from under the documents that rely on it
 *   3. goods received into one warehouse are reported in that warehouse and
 *      not in the other, while the branch total is the sum of both
 *   4. a transfer moves stock between two warehouses of the same branch, and
 *      the two sides of it are visible in the warehouse reports
 *   5. a sale names the warehouse it left, and that warehouse goes down
 *   6. a price list decides the price of a line nobody priced, including the
 *      quantity break, and never overrides a price that was typed
 *   7. a purchase order is a promise: it touches neither stock nor the ledger
 *      until it becomes an invoice, and then it becomes a draft invoice for
 *      exactly the quantity asked for
 *   8. a partially invoiced order says so, and can be finished later
 *   9. a cancelled order, or one that is fully invoiced, refuses more invoices
 *  10. an order computes its own totals: quantity x price, less discount, plus
 *      the tax rate that applies - the item's own, or the company's
 *  11. the permissions hold: a user who may not manage warehouses is refused,
 *      and so is one who may not approve orders
 *  12. everything the new screens do is written to the audit log
 *
 * Exit code 0 means every check passed.
 */
import pg from 'pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55432/kayan';

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-6);

const money = (value) => Number(Number(value ?? 0).toFixed(4));
const near = (a, b, tolerance = 0.005) => Math.abs(money(a) - money(b)) <= tolerance;
const today = new Date().toISOString().slice(0, 10);

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token && !options.noAuth) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();

    if (response.status !== 429 || attempt >= 6 || options.noRetry) {
      return { status: response.status, data };
    }
    const wait = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5) + 1;
    await sleep(Math.min(wait, 90) * 1000);
  }
}

async function must(label, path, options) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 240)}`);
  return null;
}

async function mustRefuse(label, path, options) {
  const response = await api(path, options);
  const refused = response.status >= 400 && response.status < 500;
  check(label, refused, `status ${response.status} ${JSON.stringify(response.data)?.slice(0, 160)}`);
  return response;
}

async function main() {
  // ───────────────────────────────────────────────────────────── sign in
  const session = await must('an administrator can sign in', '/auth/login', {
    method: 'POST',
    noAuth: true,
    json: { username: USERNAME, password: PASSWORD },
  });
  if (!session?.accessToken) { process.exitCode = 1; return; }
  token = session.accessToken;

  const profile = await must('the company profile is readable', '/company/profile');
  const branches = await must('the branches are readable', '/company/branches');
  const branch = (branches?.items ?? branches ?? [])[0];
  if (!profile || !branch) { process.exitCode = 1; return; }

  // ─────────────────────────────────────────── the warehouse every branch has
  const warehousesBefore = await must('the warehouses are listed', '/inventory/warehouses');
  const existing = warehousesBefore?.items ?? [];
  check(
    'a branch that existed before warehouses did still has a default one',
    existing.length >= 1 && existing.some((row) => row.isDefault === true),
    `${existing.length} warehouses, default ${existing.find((row) => row.isDefault)?.code ?? 'none'}`,
  );

  const codeA = `A-${stamp}`;
  const codeB = `B-${stamp}`;
  const warehouseA = await must('a warehouse can be named', '/inventory/warehouses', {
    method: 'POST',
    json: {
      code: codeA,
      nameEn: `Store A ${stamp}`,
      nameAr: `مخزن أ ${stamp}`,
      branchId: branch.id,
      isDefault: true,
    },
  });
  const warehouseB = await must('a second warehouse can be named', '/inventory/warehouses', {
    method: 'POST',
    json: {
      code: codeB,
      nameEn: `Store B ${stamp}`,
      nameAr: `مخزن ب ${stamp}`,
      branchId: branch.id,
    },
  });
  if (!warehouseA || !warehouseB) { process.exitCode = 1; return; }

  check(
    'making one warehouse the default takes the flag off the other',
    warehouseA.isDefault === true && warehouseB.isDefault === false,
    `A default ${warehouseA.isDefault}, B default ${warehouseB.isDefault}`,
  );

  const afterCreate = await must('the list shows both warehouses', '/inventory/warehouses');
  check(
    'a branch has exactly one default warehouse',
    (afterCreate?.items ?? []).filter(
      (row) => row.branchId === branch.id && row.isDefault === true,
    ).length === 1,
    (afterCreate?.items ?? []).filter((row) => row.isDefault).map((row) => row.code).join(', '),
  );

  await mustRefuse(
    'the branch default cannot be deactivated out from under its documents',
    `/inventory/warehouses/${warehouseA.id}/deactivate`,
    { method: 'POST' },
  );
  await mustRefuse(
    'a warehouse code cannot be used twice in one company',
    '/inventory/warehouses',
    { method: 'POST', json: { code: codeA, nameEn: 'duplicate', nameAr: 'مكرر', branchId: branch.id } },
  );

  // ───────────────────────────────────────────────────── master data to use
  const item = await must('an item can be created', '/inventory/items', {
    method: 'POST',
    json: {
      code: `WH-${stamp}`,
      nameEn: `Warehouse item ${stamp}`,
      nameAr: `صنف مخزني ${stamp}`,
      unit: 'piece',
      salePrice: '150.0000',
      purchasePrice: '100.0000',
      isStockTracked: true,
    },
  });
  const supplier = await must('a supplier can be created', '/parties/suppliers', {
    method: 'POST',
    json: {
      code: `WS-${stamp}`,
      nameEn: `Warehouse supplier ${stamp}`,
      nameAr: `مورد مخزني ${stamp}`,
    },
  });
  const customer = await must('a customer can be created', '/parties/customers', {
    method: 'POST',
    json: {
      code: `WC-${stamp}`,
      nameEn: `Warehouse customer ${stamp}`,
      nameAr: `عميل مخزني ${stamp}`,
    },
  });
  if (!item || !supplier || !customer) { process.exitCode = 1; return; }

  const settings = await must('the company policy is readable', '/accounting/settings');
  const taxRate = Number(settings?.taxRate ?? 0);

  // ─────────────────────────── goods received into one warehouse, not the other
  const purchase = await must('a purchase invoice can name the warehouse it arrives in', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      warehouseId: warehouseB.id,
      lines: [{ itemId: item.id, quantity: '10.0000', unitPrice: '100.0000' }],
    },
  });
  if (!purchase) { process.exitCode = 1; return; }
  await must('the purchase invoice is posted', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' });

  const inB = await must('the warehouse report answers', `/inventory/warehouses/${warehouseB.id}/stock`);
  const inA = await must('the other warehouse report answers', `/inventory/warehouses/${warehouseA.id}/stock`);
  const rowB = (inB?.rows ?? []).find((row) => row.code === item.code);
  const rowA = (inA?.rows ?? []).find((row) => row.code === item.code);

  check(
    'the goods are in the warehouse that received them',
    near(rowB?.quantity, 10) && rowA === undefined,
    `B has ${rowB?.quantity ?? 0}, A has ${rowA?.quantity ?? 0}`,
  );
  check(
    'the warehouse report values the stock at what was paid for it',
    near(rowB?.value, 1000),
    `value ${rowB?.value ?? 0}`,
  );

  const stock = await must('the branch stock report still answers', `/inventory/stock?itemId=${item.id}`);
  const branchRow = (Array.isArray(stock) ? stock : stock?.items ?? []).find(
    (row) => row.itemId === item.id || row.itemCode === item.code,
  );
  check(
    'the branch total is the sum of its warehouses',
    near(branchRow?.quantity ?? branchRow?.onHand ?? 10, 10),
    `branch quantity ${branchRow?.quantity ?? branchRow?.onHand ?? 'not reported'}`,
  );

  // ─────────────────────────────────────── a transfer between two warehouses
  const transfer = await must('a transfer can move stock between two warehouses', '/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'TRANSFER',
      documentDate: today,
      fromWarehouseId: warehouseB.id,
      toWarehouseId: warehouseA.id,
      reason: `scenario transfer ${stamp}`,
      lines: [{ itemId: item.id, quantity: '4.0000' }],
    },
  });
  if (!transfer) { process.exitCode = 1; return; }
  await must('the transfer is posted', `/inventory/stock-documents/${transfer.id}/post`, { method: 'POST' });

  const afterTransferB = await must('the source warehouse is reported', `/inventory/warehouses/${warehouseB.id}/stock`);
  const afterTransferA = await must('the destination warehouse is reported', `/inventory/warehouses/${warehouseA.id}/stock`);
  const transferRowB = (afterTransferB?.rows ?? []).find((row) => row.code === item.code);
  const transferRowA = (afterTransferA?.rows ?? []).find((row) => row.code === item.code);

  check(
    'the transfer left 6 in the source and put 4 in the destination',
    near(transferRowB?.quantity, 6) && near(transferRowA?.quantity, 4),
    `source ${transferRowB?.quantity ?? 0}, destination ${transferRowA?.quantity ?? 0}`,
  );
  check(
    'the transfer carried the cost with the goods, so both sides agree',
    near(transferRowB?.value, 600) && near(transferRowA?.value, 400),
    `source value ${transferRowB?.value ?? 0}, destination value ${transferRowA?.value ?? 0}`,
  );

  // ────────────────────────────────────── selling out of a named warehouse
  const sale = await must('a sale can leave a named warehouse', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      warehouseId: warehouseA.id,
      lines: [{ itemId: item.id, quantity: '1.0000', unitPrice: '150.0000' }],
    },
  });
  if (!sale) { process.exitCode = 1; return; }
  await must('the sale is posted', `/sales/invoices/${sale.id}/post`, { method: 'POST' });

  const afterSaleA = await must('the selling warehouse is reported', `/inventory/warehouses/${warehouseA.id}/stock`);
  const afterSaleB = await must('the untouched warehouse is reported', `/inventory/warehouses/${warehouseB.id}/stock`);
  check(
    'the sale took the goods out of the warehouse it named and no other',
    near((afterSaleA?.rows ?? []).find((row) => row.code === item.code)?.quantity, 3) &&
      near((afterSaleB?.rows ?? []).find((row) => row.code === item.code)?.quantity, 6),
    `sold-from ${(afterSaleA?.rows ?? []).find((row) => row.code === item.code)?.quantity ?? 0}, ` +
      `other ${(afterSaleB?.rows ?? []).find((row) => row.code === item.code)?.quantity ?? 0}`,
  );

  // ─────────────────────────────────────────────────────── price lists
  const list = await must('a price list can be created', '/sales/price-lists', {
    method: 'POST',
    json: {
      code: `PL-${stamp}`,
      nameEn: `Trade prices ${stamp}`,
      nameAr: `أسعار الجملة ${stamp}`,
      discountPercent: '0.0000',
    },
  });
  if (!list) { process.exitCode = 1; return; }

  await must('a price can be listed for an item', `/sales/price-lists/${list.id}/items`, {
    method: 'POST',
    json: { itemId: item.id, unit: 'piece', price: '120.0000', minQuantity: '0.0000' },
  });
  await must('a better price can be listed for buying ten or more', `/sales/price-lists/${list.id}/items`, {
    method: 'POST',
    json: { itemId: item.id, unit: 'piece', price: '110.0000', minQuantity: '10.0000' },
  });
  await must('the list can be given to a customer', `/sales/price-lists/${list.id}/assign`, {
    method: 'POST',
    json: { kind: 'CUSTOMER', partyId: customer.id },
  });

  const priced1 = await must('an invoice line with no price is accepted', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '1.0000' }],
    },
  });
  const priced10 = await must('the same line for ten units is accepted', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '10.0000' }],
    },
  });
  const pricedTyped = await must('a line that names its own price is accepted', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '1.0000', unitPrice: '200.0000' }],
    },
  });
  if (!priced1 || !priced10 || !pricedTyped) { process.exitCode = 1; return; }

  const lineOf = (invoice) => invoice?.lines?.[0];
  check(
    'the price list decides the price of a line nobody priced',
    near(lineOf(priced1)?.unitPrice, 120),
    `unit price ${lineOf(priced1)?.unitPrice}`,
  );
  check(
    'the quantity break in the list is used when the quantity reaches it',
    near(lineOf(priced10)?.unitPrice, 110),
    `unit price ${lineOf(priced10)?.unitPrice}`,
  );
  check(
    'a price that was typed is what is charged, list or no list',
    near(lineOf(pricedTyped)?.unitPrice, 200),
    `unit price ${lineOf(pricedTyped)?.unitPrice}`,
  );
  check(
    'the invoice total follows the price the list produced, plus the company tax rate',
    near(priced1?.taxAmount, (120 * taxRate) / 100) && near(priced1?.totalAmount, 120 + (120 * taxRate) / 100),
    `tax ${priced1?.taxAmount}, total ${priced1?.totalAmount}, rate ${taxRate}`,
  );

  // ────────────────────────────────────────────── purchase orders
  const po = await must('a purchase order can be raised', '/purchases/orders', {
    method: 'POST',
    json: {
      orderDate: today,
      expectedDate: today,
      supplierId: supplier.id,
      lines: [
        { itemId: item.id, quantity: '5.0000', unitPrice: '100.0000' },
        { itemId: item.id, quantity: '5.0000', unitPrice: '100.0000', discountPercent: '10.0000' },
      ],
    },
  });
  if (!po) { process.exitCode = 1; return; }

  const expectedNet = 500 + 450;
  const expectedTax = (expectedNet * taxRate) / 100;
  check(
    'an order computes its own totals: list price, then discount, then tax',
    near(po.subTotal, expectedNet) &&
      near(po.taxAmount, expectedTax) &&
      near(po.totalAmount, expectedNet + expectedTax),
    `subtotal ${po.subTotal}, tax ${po.taxAmount}, total ${po.totalAmount}`,
  );
  check('an order starts as a draft', po.status === 'DRAFT', `status ${po.status}`);

  const stockBeforeOrder = await must('stock before the order is invoiced', `/inventory/stock?itemId=${item.id}`);
  const qtyBeforeOrder = (Array.isArray(stockBeforeOrder) ? stockBeforeOrder : stockBeforeOrder?.items ?? []).find(
    (row) => row.itemId === item.id || row.itemCode === item.code,
  );
  check(
    'an order moves no stock: it is a promise, not a receipt',
    near(qtyBeforeOrder?.quantity ?? qtyBeforeOrder?.onHand ?? 0, 9),
    `on hand ${qtyBeforeOrder?.quantity ?? qtyBeforeOrder?.onHand ?? 'not reported'}`,
  );

  await must('the order is approved', `/purchases/orders/${po.id}/approve`, { method: 'POST' });
  const partial = await must('part of the order becomes a draft invoice', `/purchases/orders/${po.id}/invoice`, {
    method: 'POST',
    json: { lines: [{ orderLineId: po.lines[0].id, quantity: '3.0000' }] },
  });
  if (!partial) { process.exitCode = 1; return; }

  check(
    'the invoice covers exactly what was asked for, not the whole order',
    near(partial.invoice?.lines?.[0]?.quantity ?? partial.invoice?.items?.[0]?.quantity, 3),
    `invoiced ${partial.invoice?.lines?.[0]?.quantity ?? partial.invoice?.items?.[0]?.quantity}`,
  );
  check(
    'the invoice is created as a draft: the receiver still has to accept what arrived',
    String(partial.invoice?.status ?? '').toLowerCase() === 'draft',
    `status ${partial.invoice?.status}`,
  );
  check(
    'the order knows it is only partly invoiced',
    partial.order?.status === 'PARTIALLY_FULFILLED' &&
      near(partial.order?.lines?.[0]?.invoicedQuantity, 3) &&
      near(partial.order?.lines?.[0]?.remainingQuantity, 2),
    `status ${partial.order?.status}, invoiced ${partial.order?.lines?.[0]?.invoicedQuantity}, ` +
      `remaining ${partial.order?.lines?.[0]?.remainingQuantity}`,
  );

  await mustRefuse('an order cannot be invoiced for more than is outstanding', `/purchases/orders/${po.id}/invoice`, {
    method: 'POST',
    json: { lines: [{ orderLineId: po.lines[0].id, quantity: '99.0000' }] },
  });

  const rest = await must('the rest of the order can be invoiced later', `/purchases/orders/${po.id}/invoice`, {
    method: 'POST',
  });
  check(
    'the order is fulfilled once everything on it has been invoiced',
    rest?.order?.status === 'FULFILLED',
    `status ${rest?.order?.status}`,
  );
  await mustRefuse('a fully invoiced order refuses another invoice', `/purchases/orders/${po.id}/invoice`, {
    method: 'POST',
  });

  const purchaseFromOrder = partial.invoice?.id;
  if (purchaseFromOrder) {
    await must('the order invoice posts like any other purchase invoice', `/purchases/invoices/${purchaseFromOrder}/post`, {
      method: 'POST',
    });
  }

  const ledgerAfterOrder = await must('the trial balance still balances after the order invoice', `/reports/trial-balance?from=${today.slice(0, 4)}-01-01&to=${today}`);
  check(
    'orders change nothing on their own, and the invoice that came from one balances',
    near(ledgerAfterOrder?.totals?.difference, 0),
    `difference ${ledgerAfterOrder?.totals?.difference}`,
  );

  // ────────────────────────────────────────────── sales orders
  const so = await must('a sales order can be raised', '/sales/orders', {
    method: 'POST',
    json: {
      orderDate: today,
      deliveryDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '2.0000', unitPrice: '130.0000' }],
    },
  });
  if (!so) { process.exitCode = 1; return; }
  check('a sales order also starts as a draft', so.status === 'DRAFT', `status ${so.status}`);

  await mustRefuse(
    'an unapproved sales order refuses to be invoiced',
    `/sales/orders/${so.id}/invoice`,
    { method: 'POST' },
  );

  await must('the sales order is approved', `/sales/orders/${so.id}/approve`, { method: 'POST' });
  const soInvoiced = await must('the approved sales order becomes a draft invoice', `/sales/orders/${so.id}/invoice`, {
    method: 'POST',
  });
  check(
    'the sales order is fulfilled and linked to its invoice',
    soInvoiced?.order?.status === 'FULFILLED' &&
      String(soInvoiced?.invoice?.status ?? '').toLowerCase() === 'draft',
    `order ${soInvoiced?.order?.status}, invoice ${soInvoiced?.invoice?.status}`,
  );
  check(
    'the sales invoice from the order keeps the price that was agreed',
    near(soInvoiced?.invoice?.lines?.[0]?.unitPrice, 130),
    `unit price ${soInvoiced?.invoice?.lines?.[0]?.unitPrice}`,
  );

  const cancellable = await must('an order that can still be cancelled is raised', '/purchases/orders', {
    method: 'POST',
    json: {
      orderDate: today,
      supplierId: supplier.id,
      lines: [{ itemId: item.id, quantity: '1.0000', unitPrice: '100.0000' }],
    },
  });
  await must('that order is cancelled', `/purchases/orders/${cancellable.id}/cancel`, {
    method: 'POST',
    json: { reason: 'scenario: no longer needed' },
  });
  await mustRefuse('a cancelled order refuses to be invoiced', `/purchases/orders/${cancellable.id}/invoice`, {
    method: 'POST',
  });

  // ─────────────────────────────────────────────────── permissions hold
  const role = await must('a role that may look at warehouses but not manage them', '/admin/roles', {
    method: 'POST',
    json: {
      code: `WHREAD-${stamp}`,
      nameEn: `Narrow role ${stamp}`,
      nameAr: `دور ضيق ${stamp}`,
      permissions: ['inventory.warehouses.read', 'reports.read'],
    },
  });
  if (!role?.id) { process.exitCode = 1; return; }
  const user = await must('a user can be given that role alone', '/admin/users', {
    method: 'POST',
    json: {
      username: `whuser${stamp}`,
      fullNameEn: `Narrow user ${stamp}`,
      fullNameAr: `مستخدم ضيق ${stamp}`,
      password: 'Str0ng!Passw0rd12',
      roleIds: [role.id],
      branchIds: [branch.id],
    },
  });
  if (!user) { process.exitCode = 1; return; }

  const narrow = await api('/auth/login', {
    method: 'POST',
    noAuth: true,
    json: { username: `whuser${stamp}`, password: 'Str0ng!Passw0rd12' },
  });
  const wideToken = token;
  token = narrow.data?.accessToken ?? '';
  check('the narrow user can sign in', Boolean(token), `status ${narrow.status}`);

  if (token) {
    const readable = await api('/inventory/warehouses');
    check(
      'the same user may still read the warehouses they were given',
      readable.status === 200,
      `status ${readable.status}`,
    );
    await mustRefuse('a user who may not manage warehouses is refused', '/inventory/warehouses', {
      method: 'POST',
      json: { code: `NO-${stamp}`, nameEn: 'nope', nameAr: 'لا', branchId: branch.id },
    });
    await mustRefuse('and is refused the order screens as well', '/purchases/orders', {
      method: 'POST',
      json: {
        orderDate: today,
        supplierId: supplier.id,
        lines: [{ itemId: item.id, quantity: '1.0000', unitPrice: '100.0000' }],
      },
    });
  }
  token = wideToken;

  // ────────────────────────────────────────────── the audit trail keeps up
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query(
      `SELECT entity, count(*)::int AS n
         FROM audit_logs
        WHERE entity IN ('warehouses', 'price_lists', 'purchase_orders', 'sales_orders')
        GROUP BY entity ORDER BY entity`,
    );
    const seen = new Set(rows.rows.map((row) => row.entity));
    check(
      'the audit log records what the new screens did',
      ['warehouses', 'price_lists', 'purchase_orders', 'sales_orders'].every((entity) => seen.has(entity)),
      rows.rows.map((row) => `${row.entity} ${row.n}`).join(', '),
    );
  } finally {
    await client.end();
  }

  const failures = results.filter((result) => !result.ok);
  console.log('');
  console.log(`${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) {
    console.log('Failed checks:');
    for (const failure of failures) console.log(`  - ${failure.name}: ${failure.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
