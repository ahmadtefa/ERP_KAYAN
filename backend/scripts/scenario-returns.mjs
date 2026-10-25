#!/usr/bin/env node
/**
 * End-to-end costing and reversals for purchase and sales returns. Run only
 * against the disposable PostgreSQL service provisioned by CI (or an equally
 * disposable local database): this creates invoices, stock movements and
 * journal entries and intentionally leaves them in that database.
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... DATABASE_URL=... \
 *     node backend/scripts/scenario-returns.mjs [apiBaseUrl]
 */
import pg from 'pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required; this scenario must use disposable PostgreSQL.');

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);
const near = (value, expected, tolerance = 0.0001) =>
  Math.abs(Number(value ?? 0) - Number(expected)) <= tolerance;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
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
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
    });
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status !== 429 || attempt >= 6) return { status: response.status, data };
    const seconds = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5);
    await sleep(Math.min(seconds + 1, 90) * 1000);
  }
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 240)}`);
  return null;
}

async function sql(query, values = []) {
  const result = await pool.query(query, values);
  return result.rows;
}

async function stock(companyId, branchId, itemId) {
  const rows = await sql(
    `SELECT quantity::text, value::text
       FROM stock_balances
      WHERE "companyId" = $1::uuid AND "branchId" = $2::uuid AND "itemId" = $3::uuid`,
    [companyId, branchId, itemId],
  );
  return rows[0] ?? { quantity: '0', value: '0' };
}

async function assertJournal(returnDocument, label) {
  const rows = await sql(
    `SELECT "totalDebit"::text, "totalCredit"::text
       FROM journal_entries WHERE id = $1::uuid`,
    [returnDocument.journalEntryId],
  );
  const entry = rows[0];
  check(
    label,
    Boolean(entry) && near(entry.totalDebit, entry.totalCredit),
    entry ? `debit ${entry.totalDebit}, credit ${entry.totalCredit}` : 'journal entry missing',
  );
}

async function createAndPostReturn(side, originalInvoiceId, originalLineId) {
  const draft = await must(`create ${side} return draft`, `/returns/${side}`, {
    method: 'POST',
    json: {
      originalInvoiceId,
      returnDate: today,
      reason: 'Return costing scenario',
      lines: [{ originalLineId, quantity: '1.0000' }],
    },
  });
  if (!draft?.id) return null;
  const posted = await must(`post ${side} return`, `/returns/${side}/${draft.id}/post`, { method: 'POST' });
  if (!posted?.id) return null;
  const repeatedPost = await api(`/returns/${side}/${draft.id}/post`, { method: 'POST' });
  check(`a posted ${side} return cannot be posted twice`, repeatedPost.status >= 400,
    `status ${repeatedPost.status}`);
  return posted;
}

async function main() {
  const session = await must('scenario administrator can sign in', '/auth/login', {
    method: 'POST',
    noAuth: true,
    json: { username: USERNAME, password: PASSWORD },
  });
  if (!session?.accessToken) return;
  token = session.accessToken;
  const who = await must('read the current company and branch', '/auth/me');
  const user = who?.user ?? who ?? {};
  const companyId = user.companyId;
  const branchId = user.branchId;
  if (!companyId || !branchId) {
    check('scenario principal has a company and branch', false, 'returns need an assigned branch');
    return;
  }

  const supplier = await must('create a supplier for the purchase scenario', '/parties/suppliers', {
    method: 'POST',
    json: {
      code: `RT-S-${stamp}`,
      nameEn: `Return supplier ${stamp}`,
      nameAr: `مورد المرتجعات ${stamp}`,
    },
  });
  const customer = await must('create a customer for the sales scenario', '/parties/customers', {
    method: 'POST',
    json: {
      code: `RT-C-${stamp}`,
      nameEn: `Return customer ${stamp}`,
      nameAr: `عميل المرتجعات ${stamp}`,
    },
  });
  const purchaseItem = await must('create a stocked purchase-return item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `RT-P-${stamp}`,
      nameEn: `Landed-cost return item ${stamp}`,
      nameAr: `صنف تكلفة شحن ${stamp}`,
      unit: 'piece',
      purchasePrice: '10.0000',
      salePrice: '15.0000',
      isStockTracked: true,
    },
  });
  const salesItem = await must('create a stocked sales-return item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `RT-SL-${stamp}`,
      nameEn: `Sales return item ${stamp}`,
      nameAr: `صنف مرتجع مبيعات ${stamp}`,
      unit: 'piece',
      purchasePrice: '5.0000',
      salePrice: '10.0000',
      isStockTracked: true,
    },
  });
  if (!supplier || !customer || !purchaseItem || !salesItem) return;

  // One cent of landed cost over three units is deliberately awkward at four
  // decimals: the return service must allocate 0.0033, 0.0034, 0.0033 rather
  // than lose or invent a unit through repeated division.
  const purchase = await must('create a purchase invoice with landed cost', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      landedCostCharges: [
        { description: 'Freight', amount: '0.0060' },
        { description: 'Insurance', amount: '0.0040' },
      ],
      lines: [{ itemId: purchaseItem.id, quantity: '3.0000', unitPrice: '10.0000', taxRate: '14.0000' }],
    },
  });
  if (!purchase?.id) return;
  await must('post the landed-cost purchase invoice', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' });
  const purchaseDetail = await must('read the posted purchase invoice lines', `/purchases/invoices/${purchase.id}`);
  const purchaseLine = purchaseDetail?.lines?.[0];
  if (!purchaseLine?.id) return;
  check('purchase invoice retains multiple named landed-cost charges',
    Array.isArray(purchaseDetail.landedCostCharges) && purchaseDetail.landedCostCharges.length === 2 &&
      near(purchaseDetail.landedCostCharges.reduce((sum, charge) => sum + Number(charge.amount), 0), 0.01),
    JSON.stringify(purchaseDetail.landedCostCharges));

  let currentStock = await stock(companyId, branchId, purchaseItem.id);
  check('purchase invoice adds all landed cost to stock value',
    near(currentStock.quantity, 3) && near(currentStock.value, 30.01),
    `quantity ${currentStock.quantity}, value ${currentStock.value}`);

  const reversedPurchaseReturn = await createAndPostReturn('purchases', purchase.id, purchaseLine.id);
  if (!reversedPurchaseReturn?.id) return;
  check('first purchase return line stores its full landed inventory value',
    near(reversedPurchaseReturn.lines?.[0]?.inventoryCostTotal, 10.0033) &&
      near(reversedPurchaseReturn.lines?.[0]?.landedCostAmount, 0.0033),
    `inventory ${reversedPurchaseReturn.lines?.[0]?.inventoryCostTotal}, landed ${reversedPurchaseReturn.lines?.[0]?.landedCostAmount}`);
  await assertJournal(reversedPurchaseReturn, 'purchase return journal balances with VAT and landed cost');

  await must('reverse the first purchase return', `/returns/purchases/${reversedPurchaseReturn.id}/reverse`, { method: 'POST' });
  currentStock = await stock(companyId, branchId, purchaseItem.id);
  check('reversing a purchase return restores the exact stock value',
    near(currentStock.quantity, 3) && near(currentStock.value, 30.01),
    `quantity ${currentStock.quantity}, value ${currentStock.value}`);
  const originalAfterReverse = await sql(
    `SELECT "returnedQuantity"::text, "returnedSubTotal"::text, "returnedTaxTotal"::text, "returnedCostTotal"::text
       FROM purchase_invoice_lines WHERE id = $1::uuid`,
    [purchaseLine.id],
  );
  check('purchase return reversal releases quantity, subtotal, tax, and cost accumulators',
    originalAfterReverse[0] && Object.values(originalAfterReverse[0]).every((value) => near(value, 0)),
    JSON.stringify(originalAfterReverse[0]));

  const purchaseReturnValues = [];
  const purchaseReturnIds = [];
  for (let index = 0; index < 3; index += 1) {
    const returned = await createAndPostReturn('purchases', purchase.id, purchaseLine.id);
    if (!returned?.id) return;
    purchaseReturnIds.push(returned.id);
    purchaseReturnValues.push(Number(returned.lines?.[0]?.inventoryCostTotal ?? NaN));
    await assertJournal(returned, `purchase partial return ${index + 1} journal balances`);
    currentStock = await stock(companyId, branchId, purchaseItem.id);
    check(`purchase partial return ${index + 1} reduces stock at its allocated cost`,
      near(currentStock.quantity, 2 - index) &&
        near(currentStock.value, [20.0067, 10.0033, 0][index]),
      `quantity ${currentStock.quantity}, value ${currentStock.value}`);
  }
  check('all purchase partial returns retain the exact landed-cost rounding remainder',
    purchaseReturnValues.every((value, index) => near(value, [10.0033, 10.0034, 10.0033][index])) &&
      near(purchaseReturnValues.reduce((sum, value) => sum + value, 0), 30.01),
    purchaseReturnValues.join(', '));
  const purchaseAccumulator = await sql(
    `SELECT "returnedQuantity"::text, "returnedSubTotal"::text, "returnedTaxTotal"::text, "returnedCostTotal"::text
       FROM purchase_invoice_lines WHERE id = $1::uuid`,
    [purchaseLine.id],
  );
  check('fully returned purchase line exactly matches its source totals',
    near(purchaseAccumulator[0]?.returnedQuantity, 3) &&
      near(purchaseAccumulator[0]?.returnedSubTotal, 30) &&
      near(purchaseAccumulator[0]?.returnedTaxTotal, 4.2) &&
      near(purchaseAccumulator[0]?.returnedCostTotal, 30.01),
    JSON.stringify(purchaseAccumulator[0]));
  const prematurePurchaseReverse = await api(`/purchases/invoices/${purchase.id}/reverse`, { method: 'POST' });
  check('source purchase invoice cannot be reversed while posted returns remain active',
    prematurePurchaseReverse.status >= 400,
    `status ${prematurePurchaseReverse.status}`);

  for (const returnId of [...purchaseReturnIds].reverse()) {
    await must('reverse a posted purchase partial return', `/returns/purchases/${returnId}/reverse`, { method: 'POST' });
  }
  currentStock = await stock(companyId, branchId, purchaseItem.id);
  const releasedPurchaseAccumulator = await sql(
    `SELECT "returnedQuantity"::text, "returnedSubTotal"::text, "returnedTaxTotal"::text, "returnedCostTotal"::text
       FROM purchase_invoice_lines WHERE id = $1::uuid`,
    [purchaseLine.id],
  );
  check('reversing all purchase returns restores the source line and landed-cost stock value',
    near(currentStock.quantity, 3) && near(currentStock.value, 30.01) &&
      releasedPurchaseAccumulator[0] &&
      Object.values(releasedPurchaseAccumulator[0]).every((value) => near(value, 0)),
    `stock ${currentStock.quantity}/${currentStock.value}, accumulators ${JSON.stringify(releasedPurchaseAccumulator[0])}`);

  const reversedPurchase = await must('reverse the original landed-cost purchase invoice',
    `/purchases/invoices/${purchase.id}/reverse`, { method: 'POST' });
  check('purchase invoice reversal records the reversed state',
    String(reversedPurchase?.status).toLowerCase() === 'reversed',
    `status ${reversedPurchase?.status}`);
  const reversedPurchaseStock = await stock(companyId, branchId, purchaseItem.id);
  check('purchase invoice reversal removes the original quantity and its landed value exactly once',
    near(reversedPurchaseStock.quantity, 0) && near(reversedPurchaseStock.value, 0),
    `quantity ${reversedPurchaseStock.quantity}, value ${reversedPurchaseStock.value}`);
  const purchaseReversalJournal = await sql(
    `SELECT original."totalDebit"::text AS "originalDebit",
            original."totalCredit"::text AS "originalCredit",
            reversal."totalDebit"::text AS "reversalDebit",
            reversal."totalCredit"::text AS "reversalCredit",
            reversal."reversalOfId"::text AS "reversalOfId"
       FROM purchase_invoices invoice
       JOIN journal_entries original ON original.id = invoice."journalEntryId"
       JOIN journal_entries reversal ON reversal."reversalOfId" = original.id
      WHERE invoice.id = $1::uuid`,
    [purchase.id],
  );
  check('purchase invoice reversal mirrors a balanced journal including landed cost',
    Boolean(purchaseReversalJournal[0]) &&
      near(purchaseReversalJournal[0].originalDebit, purchaseReversalJournal[0].originalCredit) &&
      near(purchaseReversalJournal[0].reversalDebit, purchaseReversalJournal[0].reversalCredit) &&
      near(purchaseReversalJournal[0].originalDebit, purchaseReversalJournal[0].reversalCredit) &&
      near(purchaseReversalJournal[0].originalCredit, purchaseReversalJournal[0].reversalDebit),
    JSON.stringify(purchaseReversalJournal[0]));
  const repeatedPurchaseReverse = await api(`/purchases/invoices/${purchase.id}/reverse`, { method: 'POST' });
  check('a reversed landed-cost purchase invoice cannot be reversed twice',
    repeatedPurchaseReverse.status >= 400,
    `status ${repeatedPurchaseReverse.status}`);
  const stockAfterRepeatedPurchaseReverse = await stock(companyId, branchId, purchaseItem.id);
  check('a repeated purchase invoice reversal cannot change inventory again',
    near(stockAfterRepeatedPurchaseReverse.quantity, 0) && near(stockAfterRepeatedPurchaseReverse.value, 0),
    `quantity ${stockAfterRepeatedPurchaseReverse.quantity}, value ${stockAfterRepeatedPurchaseReverse.value}`);

  // Sales costing has a separate source line. The return and its reversal must
  // use the sale's stored cost, not the item's current purchase price.
  const salesPurchase = await must('create source stock for the sales scenario', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      landedCostAmount: '0.0100',
      lines: [{ itemId: salesItem.id, quantity: '3.0000', unitPrice: '5.0000', taxRate: '0.0000' }],
    },
  });
  if (!salesPurchase?.id) return;
  await must('post source stock for the sales scenario', `/purchases/invoices/${salesPurchase.id}/post`, { method: 'POST' });
  const sale = await must('create a sales invoice for the return scenario', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [{ itemId: salesItem.id, quantity: '3.0000', unitPrice: '10.0000', taxRate: '14.0000' }],
    },
  });
  if (!sale?.id) return;
  await must('post the sales invoice', `/sales/invoices/${sale.id}/post`, { method: 'POST' });
  const saleDetail = await must('read the posted sales invoice lines', `/sales/invoices/${sale.id}`);
  const saleLine = saleDetail?.lines?.[0];
  if (!saleLine?.id) return;

  const salesReturnValues = [];
  const salesReturnIds = [];
  const reversedSalesReturn = await createAndPostReturn('sales', sale.id, saleLine.id);
  if (!reversedSalesReturn?.id) return;
  salesReturnValues.push(Number(reversedSalesReturn.lines?.[0]?.costTotal ?? NaN));
  await assertJournal(reversedSalesReturn, 'sales return journal balances with the exact source cost');
  await must('reverse the first sales return', `/returns/sales/${reversedSalesReturn.id}/reverse`, { method: 'POST' });
  const sourceAfterSalesReverse = await sql(
    `SELECT "returnedQuantity"::text, "returnedSubTotal"::text, "returnedTaxTotal"::text, "returnedCostTotal"::text
       FROM sales_invoice_lines WHERE id = $1::uuid`,
    [saleLine.id],
  );
  check('sales return reversal releases quantity, subtotal, tax, and cost accumulators',
    sourceAfterSalesReverse[0] && Object.values(sourceAfterSalesReverse[0]).every((value) => near(value, 0)),
    JSON.stringify(sourceAfterSalesReverse[0]));

  salesReturnValues.length = 0;
  for (let index = 0; index < 3; index += 1) {
    const returned = await createAndPostReturn('sales', sale.id, saleLine.id);
    if (!returned?.id) return;
    salesReturnIds.push(returned.id);
    salesReturnValues.push(Number(returned.lines?.[0]?.costTotal ?? NaN));
    await assertJournal(returned, `sales partial return ${index + 1} journal balances`);
  }
  const sourceSalesAccumulator = await sql(
    `SELECT "quantity"::text, "lineTotal"::text, "taxAmount"::text,
            "returnedQuantity"::text, "returnedSubTotal"::text, "returnedTaxTotal"::text,
            "costTotal"::text, "returnedCostTotal"::text
       FROM sales_invoice_lines WHERE id = $1::uuid`,
    [saleLine.id],
  );
  const sourceSalesLine = sourceSalesAccumulator[0];
  check('all sales partial returns exactly reverse net sales, VAT, quantity, and cost',
    sourceSalesLine &&
      near(sourceSalesLine.returnedQuantity, sourceSalesLine.quantity) &&
      near(sourceSalesLine.returnedSubTotal, sourceSalesLine.lineTotal) &&
      near(sourceSalesLine.returnedTaxTotal, sourceSalesLine.taxAmount) &&
      near(sourceSalesLine.returnedCostTotal, sourceSalesLine.costTotal) &&
      near(salesReturnValues.reduce((sum, value) => sum + value, 0), sourceSalesLine.costTotal),
    `${JSON.stringify(sourceSalesLine)}; returned costs ${salesReturnValues.join(', ')}`);

  const finalSalesStock = await stock(companyId, branchId, salesItem.id);
  check('all sales returns restore the original inventory cost and quantity',
    near(finalSalesStock.quantity, 3) && near(finalSalesStock.value, 15.01),
    `quantity ${finalSalesStock.quantity}, value ${finalSalesStock.value}`);
  const prematureSalesReverse = await api(`/sales/invoices/${sale.id}/reverse`, { method: 'POST' });
  check('source sales invoice cannot be reversed while posted returns remain active',
    prematureSalesReverse.status >= 400,
    `status ${prematureSalesReverse.status}`);
  const stockAfterBlockedSalesReverse = await stock(companyId, branchId, salesItem.id);
  check('blocked sales invoice reversal does not change stock',
    near(stockAfterBlockedSalesReverse.quantity, 3) && near(stockAfterBlockedSalesReverse.value, 15.01),
    `quantity ${stockAfterBlockedSalesReverse.quantity}, value ${stockAfterBlockedSalesReverse.value}`);

  for (const returnId of [...salesReturnIds].reverse()) {
    await must('reverse a posted sales partial return', `/returns/sales/${returnId}/reverse`, { method: 'POST' });
  }
  const releasedSalesAccumulator = await sql(
    `SELECT "returnedQuantity"::text, "returnedSubTotal"::text, "returnedTaxTotal"::text, "returnedCostTotal"::text
       FROM sales_invoice_lines WHERE id = $1::uuid`,
    [saleLine.id],
  );
  const stockAfterSalesReturnReversals = await stock(companyId, branchId, salesItem.id);
  check('reversing all sales returns restores the source line accumulators and removes returned stock',
    releasedSalesAccumulator[0] && Object.values(releasedSalesAccumulator[0]).every((value) => near(value, 0)) &&
      near(stockAfterSalesReturnReversals.quantity, 0) && near(stockAfterSalesReturnReversals.value, 0),
    `accumulators ${JSON.stringify(releasedSalesAccumulator[0])}; stock ${stockAfterSalesReturnReversals.quantity}/${stockAfterSalesReturnReversals.value}`);

  const reversedSale = await must('reverse the source sales invoice after returns are reversed',
    `/sales/invoices/${sale.id}/reverse`, { method: 'POST' });
  check('source sales invoice reversal records the reversed state',
    String(reversedSale?.status).toLowerCase() === 'reversed',
    `status ${reversedSale?.status}`);
  const restoredSaleStock = await stock(companyId, branchId, salesItem.id);
  check('source sales invoice reversal records the returned stock in its original cost',
    near(restoredSaleStock.quantity, 3) && near(restoredSaleStock.value, 15.01),
    `quantity ${restoredSaleStock.quantity}, value ${restoredSaleStock.value}`);
  const salesReversalJournal = await sql(
    `SELECT original."totalDebit"::text AS "originalDebit",
            original."totalCredit"::text AS "originalCredit",
            reversal."totalDebit"::text AS "reversalDebit",
            reversal."totalCredit"::text AS "reversalCredit"
       FROM sales_invoices invoice
       JOIN journal_entries original ON original.id = invoice."journalEntryId"
       JOIN journal_entries reversal ON reversal."reversalOfId" = original.id
      WHERE invoice.id = $1::uuid`,
    [sale.id],
  );
  check('sales invoice reversal mirrors a balanced journal exactly once',
    Boolean(salesReversalJournal[0]) &&
      near(salesReversalJournal[0].originalDebit, salesReversalJournal[0].originalCredit) &&
      near(salesReversalJournal[0].reversalDebit, salesReversalJournal[0].reversalCredit) &&
      near(salesReversalJournal[0].originalDebit, salesReversalJournal[0].reversalCredit) &&
      near(salesReversalJournal[0].originalCredit, salesReversalJournal[0].reversalDebit),
    JSON.stringify(salesReversalJournal[0]));
  const repeatedSalesReverse = await api(`/sales/invoices/${sale.id}/reverse`, { method: 'POST' });
  check('a reversed sales invoice cannot be reversed twice', repeatedSalesReverse.status >= 400,
    `status ${repeatedSalesReverse.status}`);
  const stockAfterRepeatedSalesReverse = await stock(companyId, branchId, salesItem.id);
  check('a repeated sales invoice reversal cannot change inventory again',
    near(stockAfterRepeatedSalesReverse.quantity, 3) && near(stockAfterRepeatedSalesReverse.value, 15.01),
    `quantity ${stockAfterRepeatedSalesReverse.quantity}, value ${stockAfterRepeatedSalesReverse.value}`);

  console.log('\nReturn scenario results:');
  for (const result of results) console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${result.name}`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
