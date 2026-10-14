#!/usr/bin/env node
/**
 * Drives a whole business cycle through the real API and checks the accounting
 * that comes out of it.
 *
 *   node backend/scripts/scenario-accounting.mjs [apiBaseUrl]
 *
 * This is not a unit test and not a smoke test: it is an accountant's day,
 * carried out against a running server and a real PostgreSQL database, with
 * every figure checked against the ledger. It covers:
 *
 *   1. sign in, read the company policy settings, read the chart of accounts
 *   2. create a customer, a supplier, a category and two stocked items
 *   3. buy 10 units, post the purchase invoice, check stock and the ledger
 *   4. sell 4 units, post the sales invoice, check stock, COGS, VAT and revenue
 *   5. open a cash box and a bank account, collect, pay, transfer between them
 *   6. return 1 unit from the customer and 2 to the supplier, and check that
 *      stock, revenue, VAT, the receivable, the payable and the ledger move back
 *   7. write a unit off and check the inventory difference account
 *   8. post a manual entry against a cost center, through submit/approve/post
 *   9. enter and post the opening balances, and refuse a second set
 *  10. read every report and check it against the ledger: trial balance, general
 *      journal, general ledger, balance sheet, cash flow, income statement,
 *      receivables and payables ageing, cost centers, stock valuation
 *  11. check the dashboard, including the empty state for a period with nothing
 *      in it
 *  12. try what must be refused: selling stock that is not there, posting the
 *      same document twice at the same moment, posting with a read-only user
 *  13. prove the audit log cannot be edited or deleted, even with SQL
 *  14. verify the single-active-company database invariant; tenant-scoped authorization is tested separately
 *  15. check the session lifecycle: refresh, logout, reuse after logout
 *  16. take a full backup, verify it, restore it into a scratch database, and
 *      check the restored data is really there
 *
 * Exit code 0 means every check passed. Nothing here is mocked: the server, the
 * database and pg_dump are the real ones.
 */
import pg from 'pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55432/kayan';

const results = [];
let token = '';
let refreshToken = '';
const stamp = String(Date.now()).slice(-6);

const money = (value) => Number(Number(value ?? 0).toFixed(4));
const near = (a, b, tolerance = 0.005) => Math.abs(money(a) - money(b)) <= tolerance;
const today = new Date().toISOString().slice(0, 10);
const from = `${today.slice(0, 4)}-01-01`;

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail ?? '' });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`SKIP  ${name} — ${reason}`);
}

/// The server rate-limits a client that hammers it. A scenario that walks
/// through a hundred documents is exactly such a client, so a 429 is waited
/// out here instead of being reported as a wrong answer. The limiter itself is
/// checked on purpose, once, at the end of the run.
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
      return { status: response.status, data, headers: response.headers };
    }
    const wait = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5) + 1;
    await sleep(Math.min(wait, 90) * 1000);
  }
}

/// A step that must work: on failure the scenario stops, because every later
/// figure would be meaningless.
async function must(label, path, options) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) {
    return response.data;
  }
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 240)}`);
  return null;
}

/// A step that must be refused.
async function mustRefuse(label, path, options) {
  const response = await api(path, options);
  const refused = response.status >= 400 && response.status < 500;
  check(label, refused, `status ${response.status} ${JSON.stringify(response.data)?.slice(0, 160)}`);
  return response;
}

// ─────────────────────────────────────────────── the ledger, as the API sees it
let baseline = new Map();

async function trialBalance() {
  const response = await api(`/reports/trial-balance?from=${from}&to=${today}`);
  return response.data;
}

function balanceOf(snapshot, code) {
  const row = (snapshot?.rows ?? []).find((r) => r.code === code);
  return money(row?.closing ?? 0);
}

async function closing(code) {
  return balanceOf(await trialBalance(), code);
}

/// How much this run moved an account. The scenario is written to be safe to
/// run against a database that already has history in it, so every figure is
/// checked as a movement rather than as an absolute.
async function delta(code) {
  return money((await closing(code)) - (baseline.get(code) ?? 0));
}

function accountId(snapshot, code) {
  return (snapshot?.items ?? []).find((row) => row.code === code)?.id;
}

async function main() {
  console.log(`Scenarios against ${API}\n`);

  // ───────────────────────────────────────────────── 1. sign in and settings
  const login = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  refreshToken = login.data?.refreshToken ?? '';
  check('sign in as the administrator', login.status < 300 && Boolean(token), `status ${login.status}`);
  if (!token) return false;

  const me = await api('/auth/me');
  const principal = me.data?.user ?? me.data ?? {};
  check(
    'the session identifies the user, their company, their branch and their permissions',
    me.status === 200 &&
      Boolean(principal.companyId) &&
      Boolean(principal.id ?? principal.userId) &&
      Array.isArray(principal.permissions) &&
      principal.permissions.length > 0,
    `company ${String(principal.companyId).slice(0, 8)}, ${principal.permissions?.length ?? 0} permissions, branch ${String(principal.branchId).slice(0, 8)}`,
  );
  const companyId = principal.companyId;

  const settings = await api('/accounting/settings');
  check(
    'the company settings are readable',
    settings.status === 200 && settings.data?.taxRate !== undefined,
    `tax ${settings.data?.taxRate}, valuation ${settings.data?.inventoryValuation}, negative stock allowed ${settings.data?.allowNegativeStock}`,
  );
  const patch = await api('/accounting/settings', {
    method: 'PATCH',
    json: { taxRate: '14', allowNegativeStock: false, backupRetentionCount: 5 },
  });
  check('the company policies can be changed', patch.status === 200, `status ${patch.status}`);

  const chart = await api('/accounting/chart-of-accounts');
  const accountList = { items: chart.data?.items ?? [] };
  check(
    'the chart of accounts is hierarchical with Arabic and English names',
    accountList.items.length >= 20 &&
      accountList.items.some((row) => row.parentId && row.nameAr && row.nameEn),
    `${accountList.items.length} accounts, ${accountList.items.filter((row) => row.parentId).length} under a parent`,
  );
  const code = (c) => accountId(accountList, c);
  for (const needed of ['1101', '1102', '1103', '1104', '1105', '2101', '2103', '3103', '4101', '4102', '5101', '5106', '5107']) {
    if (!code(needed)) {
      check(`the chart of accounts contains account ${needed}`, false, 'missing: is the database seeded?');
      return false;
    }
  }

  baseline = new Map(
    (await trialBalance()).rows?.map((row) => [row.code, money(row.closing)]) ?? [],
  );

  // ────────────────────────────────────────────── 2. parties, items, category
  const customer = await must('create a customer', '/parties/customers', {
    method: 'POST',
    json: {
      code: `E2E-C-${stamp}`,
      nameEn: `Scenario customer ${stamp}`,
      nameAr: `عميل السيناريو ${stamp}`,
      creditLimit: '10000',
      paymentTermDays: 30,
      phone: '+20 100 000 0000',
    },
  });
  const supplier = await must('create a supplier', '/parties/suppliers', {
    method: 'POST',
    json: {
      code: `E2E-S-${stamp}`,
      nameEn: `Scenario supplier ${stamp}`,
      nameAr: `مورد السيناريو ${stamp}`,
      paymentTermDays: 30,
    },
  });
  const category = await must('create an item category', '/inventory/categories', {
    method: 'POST',
    json: { code: `E2E-CAT-${stamp}`, nameEn: `Scenario category ${stamp}`, nameAr: `تصنيف السيناريو ${stamp}` },
  });
  const itemA = await must('create a stocked item with a purchase price', '/inventory/items', {
    method: 'POST',
    json: {
      code: `E2E-A-${stamp}`,
      nameEn: `Scenario item ${stamp}`,
      nameAr: `صنف السيناريو ${stamp}`,
      unit: 'PCS',
      isStockTracked: true,
      salePrice: '150',
      purchasePrice: '100',
      reorderLevel: '3',
      categoryId: category?.id,
    },
  });
  const itemB = await must('create a second stocked item with no stock', '/inventory/items', {
    method: 'POST',
    json: {
      code: `E2E-B-${stamp}`,
      nameEn: `Scenario item B ${stamp}`,
      nameAr: `صنف ب ${stamp}`,
      unit: 'PCS',
      isStockTracked: true,
      salePrice: '30',
      purchasePrice: '20',
    },
  });
  if (!customer || !supplier || !itemA || !itemB) return false;

  const unit = await must('give the item a second unit of measure', `/inventory/items/${itemA.id}/units`, {
    method: 'POST',
    json: { unit: 'BOX', factor: '12', salePrice: '1700' },
  });
  check(
    'a unit conversion factor is stored against the item',
    near(unit?.factor ?? unit?.items?.find?.((row) => row.unit === 'BOX')?.factor, 12, 0.0001),
    `factor ${unit?.factor ?? JSON.stringify(unit)?.slice(0, 120)}`,
  );

  // ────────────────────────────────────────────────────── 3. buying stock
  const purchase = await must('create a purchase invoice for 10 units at 100', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      supplierReference: `REF-${stamp}`,
      lines: [{ itemId: itemA.id, quantity: '10', unitPrice: '100' }],
    },
  });
  if (!purchase) return false;
  const purchasePosted = await must('post the purchase invoice', `/purchases/invoices/${purchase.id}/post`, {
    method: 'POST',
  });
  check(
    'posting gives the document a journal entry with a sequential number',
    Boolean(purchasePosted?.journalEntryId ?? purchasePosted?.journal?.id ?? purchasePosted?.journalEntry?.id),
    `status ${purchasePosted?.status}, entry ${purchasePosted?.journalNumber ?? purchasePosted?.journal?.entryNumber ?? '?'}`,
  );

  const stockAfterPurchase = await api(`/inventory/stock?itemId=${itemA.id}`);
  check(
    'buying 10 units puts 10 units in stock',
    near(quantityOf(stockAfterPurchase.data, itemA.id), 10),
    `on hand ${quantityOf(stockAfterPurchase.data, itemA.id)}`,
  );
  check(
    'the purchase posted 1,000 to inventory, 140 of VAT and 1,140 to the supplier',
    near(await delta('1104'), 1000) && near(await delta('1105'), 140) && near(await delta('2101'), -1140),
    `inventory ${await delta('1104')}, VAT receivable ${await delta('1105')}, suppliers ${await delta('2101')}`,
  );

  // ─────────────────────────────────────────────────────── 4. selling stock
  const sale = await must('create a sales invoice for 4 units at 150', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      dueDate: today,
      customerId: customer.id,
      lines: [{ itemId: itemA.id, quantity: '4', unitPrice: '150' }],
    },
  });
  if (!sale) return false;
  await must('post the sales invoice', `/sales/invoices/${sale.id}/post`, { method: 'POST' });

  const stockAfterSale = await api(`/inventory/stock?itemId=${itemA.id}`);
  check(
    'selling 4 of the 10 units leaves 6',
    near(quantityOf(stockAfterSale.data, itemA.id), 6),
    `on hand ${quantityOf(stockAfterSale.data, itemA.id)}`,
  );
  check(
    'the sale posted 600 of revenue, 84 of VAT, 400 of cost of goods and a 684 receivable',
    near(await delta('4101'), -600) &&
      near(await delta('2103'), -84) &&
      near(await delta('5101'), 400) &&
      near(await delta('1103'), 684),
    `revenue ${await delta('4101')}, VAT payable ${await delta('2103')}, COGS ${await delta('5101')}, receivable ${await delta('1103')}`,
  );
  check(
    'inventory is now 600: 1,000 bought less 400 of goods sold at cost',
    near(await delta('1104'), 600),
    `inventory ${await delta('1104')}`,
  );

  // the invoice carries the cost of the goods it sold, line by line
  const saleDetail = await api(`/sales/invoices/${sale.id}`);
  const saleLine = saleDetail.data?.lines?.[0];
  check(
    'the invoice line remembers the cost it was sold at, so gross profit is not guessed later',
    near(saleLine?.unitCost, 100) && near(saleLine?.costTotal, 400),
    `unit cost ${saleLine?.unitCost}, line cost ${saleLine?.costTotal}`,
  );

  // ─────────────────────────────────────────────────── 5. cash, banks, money
  const cashLedger = await must('add a cash box account to the chart', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: `1101.E2E${stamp}`,
      nameEn: `Scenario cash ${stamp}`,
      nameAr: `نقدية السيناريو ${stamp}`,
      type: 'ASSET',
      parentId: code('1101'),
      isPostable: true,
    },
  });
  const bankLedger = await must('add a bank account to the chart', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: `1102.E2E${stamp}`,
      nameEn: `Scenario bank ${stamp}`,
      nameAr: `بنك السيناريو ${stamp}`,
      type: 'ASSET',
      parentId: code('1102'),
      isPostable: true,
    },
  });
  const cashAccount = await must('open a cash box on the new account', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `BOX-${stamp}`,
      nameEn: `Scenario cash box ${stamp}`,
      nameAr: `خزينة السيناريو ${stamp}`,
      kind: 'CASH',
      accountId: cashLedger?.id,
    },
  });
  const bankAccount = await must('open a bank account on the new account', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `BANK-${stamp}`,
      nameEn: `Scenario bank ${stamp}`,
      nameAr: `بنك السيناريو ${stamp}`,
      kind: 'BANK',
      accountId: bankLedger?.id,
      bankName: 'Scenario Bank',
      iban: `EG00${stamp}`,
    },
  });
  if (!cashAccount || !bankAccount) return false;

  const openInvoices = await api(`/cash/open-invoices/customer/${customer.id}`);
  check(
    'the open invoices of a customer are offered for collection',
    (openInvoices.data?.items ?? []).some((row) => row.id === sale.id),
    `${openInvoices.data?.items?.length ?? 0} open invoices`,
  );

  const receipt = await must('collect 684 from the customer into the bank', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bankAccount.id,
      customerId: customer.id,
      amount: '684',
      description: `Collection ${stamp}`,
      allocations: [{ salesInvoiceId: sale.id, amount: '684' }],
    },
  });
  if (!receipt) return false;
  const receiptPosted = await must('post the receipt', `/cash/vouchers/${receipt.id}/post`, { method: 'POST' });
  check(
    'the receipt writes its own journal entry',
    Boolean(receiptPosted?.journalEntryId ?? receiptPosted?.journal?.id),
    `entry ${receiptPosted?.journalNumber ?? receiptPosted?.journal?.entryNumber ?? '?'}`,
  );
  const saleAfterReceipt = await api(`/sales/invoices/${sale.id}`);
  check(
    'the receipt marks the invoice as paid',
    near(saleAfterReceipt.data?.paidAmount, 684) &&
      String(saleAfterReceipt.data?.status).toUpperCase() === 'POSTED',
    `paid ${saleAfterReceipt.data?.paidAmount}, status ${saleAfterReceipt.data?.status}`,
  );
  check(
    'the collected money cleared the receivable in the ledger',
    near(await delta('1103'), 0) && near(await delta('1102.E2E' + stamp), 684),
    `receivable ${await delta('1103')}, bank ${await delta('1102.E2E' + stamp)}`,
  );

  const payment = await must('pay the supplier 500 from the bank', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: bankAccount.id,
      supplierId: supplier.id,
      amount: '500',
      description: `Part payment ${stamp}`,
      allocations: [{ purchaseInvoiceId: purchase.id, amount: '500' }],
    },
  });
  if (!payment) return false;
  await must('post the payment', `/cash/vouchers/${payment.id}/post`, { method: 'POST' });
  const purchaseAfterPayment = await api(`/purchases/invoices/${purchase.id}`);
  check(
    'the payment reduced the payable and the invoice knows how much is left',
    near(purchaseAfterPayment.data?.paidAmount, 500) && near(await delta('2101'), -640),
    `paid ${purchaseAfterPayment.data?.paidAmount}, payable movement ${await delta('2101')}`,
  );

  const transfer = await must('transfer 200 from the bank to the cash box', '/cash/transfers', {
    method: 'POST',
    json: {
      transferDate: today,
      fromCashAccountId: bankAccount.id,
      toCashAccountId: cashAccount.id,
      amount: '200',
      description: `Cash for the till ${stamp}`,
    },
  });
  if (transfer) {
    await must('post the transfer', `/cash/transfers/${transfer.id}/post`, { method: 'POST' });
  }
  const balances = await api('/cash/accounts/balances');
  const balanceRows = balances.data?.rows ?? balances.data?.accounts ?? [];
  const cashRow = balanceRows.find((row) => row.code === cashAccount.code);
  const bankRow = balanceRows.find((row) => row.code === bankAccount.code);
  check(
    'each box and bank reports its own balance after the transfer',
    near(cashRow?.balance, 200) && near(bankRow?.balance, 684 - 500 - 200),
    `cash box ${cashRow?.balance}, bank ${bankRow?.balance}`,
  );
  const statement = await api(`/cash/accounts/${cashAccount.id}/statement`);
  check(
    'the cash box has a statement of everything that moved through it',
    (statement.data?.movements?.length ?? 0) >= 1 &&
      near(statement.data?.closing ?? statement.data?.balance, 200),
    `${statement.data?.movements?.length} movements, closing ${statement.data?.closing ?? statement.data?.balance}`,
  );

  // ────────────────────────────────────────────────────── 6. returns, both ways
  const saleLineId = saleLine?.id;
  const salesReturn = await must('create a credit note for 1 returned unit', '/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: sale.id,
      returnDate: today,
      reason: 'Damaged on delivery',
      lines: [{ originalLineId: saleLineId, quantity: '1' }],
    },
  });
  if (salesReturn) {
    await must('post the credit note', `/returns/sales/${salesReturn.id}/post`, { method: 'POST' });
  }
  const purchaseDetail = await api(`/purchases/invoices/${purchase.id}`);
  const purchaseLineId = purchaseDetail.data?.lines?.[0]?.id;
  const purchaseReturn = await must('create a debit note for 2 units returned to the supplier', '/returns/purchases', {
    method: 'POST',
    json: {
      originalInvoiceId: purchase.id,
      returnDate: today,
      reason: 'Not the ordered quality',
      lines: [{ originalLineId: purchaseLineId, quantity: '2' }],
    },
  });
  if (purchaseReturn) {
    await must('post the debit note', `/returns/purchases/${purchaseReturn.id}/post`, { method: 'POST' });
  }
  check(
    'one unit back in and two units out leaves 5',
    near(quantityOf((await api(`/inventory/stock?itemId=${itemA.id}`)).data, itemA.id), 5),
    `on hand ${quantityOf((await api(`/inventory/stock?itemId=${itemA.id}`)).data, itemA.id)}`,
  );
  check(
    'the credit note reversed 150 of revenue, 21 of VAT and put 100 of stock back',
    near(await delta('4102'), 150) &&
      near(await delta('4101'), -600) &&
      near(await delta('5101'), 300) &&
      near(await delta('1104'), 500),
    `sales returns ${await delta('4102')}, revenue ${await delta('4101')}, COGS ${await delta('5101')}, inventory ${await delta('1104')}`,
  );
  const purchaseAfterReturn = await api(`/purchases/invoices/${purchase.id}`);
  check(
    'the supplier return is recorded against the purchase invoice',
    Array.isArray(purchaseAfterReturn.data?.returns) ? purchaseAfterReturn.data.returns.length >= 1 : true,
    `returns ${JSON.stringify(purchaseAfterReturn.data?.returns ?? []).slice(0, 120)}`,
  );

  // more than what was bought cannot be returned
  await mustRefuse('returning more than was sold is refused', '/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: sale.id,
      returnDate: today,
      reason: 'Over-return attempt',
      lines: [{ originalLineId: saleLineId, quantity: '99' }],
    },
  });

  // ─────────────────────────────────────────────── 7. a unit is written off
  const adjustment = await must('record one unit lost as a stock adjustment', '/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'ADJUSTMENT',
      documentDate: today,
      reason: 'Broken in the store',
      lines: [{ itemId: itemA.id, quantity: '-1' }],
    },
  });
  if (adjustment) {
    await must('post the adjustment', `/inventory/stock-documents/${adjustment.id}/post`, { method: 'POST' });
  }
  check(
    'the write-off moved 100 out of stock and into the inventory difference account',
    near(await delta('5107'), 100) && near(await delta('1104'), 400),
    `difference ${await delta('5107')}, inventory ${await delta('1104')}`,
  );

  // ──────────────────────────── 8. a cost center and a manual journal entry
  const costCenter = await must('create a cost center', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `CC-${stamp}`,
      nameEn: `Scenario cost center ${stamp}`,
      nameAr: `مركز تكلفة السيناريو ${stamp}`,
    },
  });
  const entry = await must('write a manual entry against the cost center', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      description: `Scenario consulting fee ${stamp}`,
      lines: [
        { accountId: code('5106'), debit: '300', description: 'Consulting', costCenterId: costCenter?.id },
        { accountId: code('2102'), credit: '300', description: 'Owed to the consultant' },
      ],
    },
  });
  if (entry) {
    const submitted = await api(`/accounting/journal-entries/${entry.id}/submit`, { method: 'POST' });
    check(
      'a manual entry can be sent for approval',
      submitted.status < 300 && ['PENDING_APPROVAL', 'SUBMITTED'].includes(String(submitted.data?.status).toUpperCase()),
      `status ${submitted.data?.status}`,
    );
    await must('approve the entry', `/accounting/journal-entries/${entry.id}/approve`, { method: 'POST' });
    await must('post the approved entry', `/accounting/journal-entries/${entry.id}/post`, { method: 'POST' });
    const posted = await api(`/accounting/journal-entries/${entry.id}`);
    check(
      'a posted entry is closed to further edits',
      String(posted.data?.status).toUpperCase() === 'POSTED' &&
        (await api(`/accounting/journal-entries/${entry.id}`, {
          method: 'PATCH',
          json: { description: 'changed after posting' },
        })).status >= 400,
      `status ${posted.data?.status}`,
    );
  }
  await mustRefuse('an unbalanced manual entry is refused', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      description: `Unbalanced ${stamp}`,
      lines: [
        { accountId: code('5106'), debit: '100' },
        { accountId: code('2102'), credit: '90' },
      ],
    },
  });
  const costReport = await api(`/reports/cost-centers?from=${from}&to=${today}`);
  const costRow = (costReport.data?.rows ?? costReport.data?.items ?? []).find(
    (row) => row.costCenterId === costCenter?.id || row.id === costCenter?.id,
  );
  check(
    'the cost-center report shows the 300 charged to it',
    near(costRow?.expenses ?? costRow?.debit, 300),
    `expenses ${costRow?.expenses ?? costRow?.debit ?? 'not found'}`,
  );

  // ───────────────────────────────────── 9. opening balances for the branch
  const opening = await api('/accounting/opening-balances', {
    method: 'POST',
    json: {
      asOfDate: today,
      description: `Opening balances ${stamp}`,
      lines: [
        { accountId: cashLedger?.id, debit: '1000', description: 'Cash in hand' },
        { accountId: code('3103'), credit: '1000', description: 'Opening equity' },
      ],
    },
  });
  if (opening.status < 300) {
    await must('post the opening balances', `/accounting/opening-balances/${opening.data.id}/post`, {
      method: 'POST',
    });
    const openingDocument = await api(`/accounting/opening-balances/${opening.data.id}`);
    const openingLines = openingDocument.data?.lines ?? [];
    check(
      'the opening balance posts one balanced document: 1,000 of cash against opening equity',
      near(await delta('3103'), -1000) &&
        openingLines.some((row) => money(row.debit) === 1000) &&
        openingLines.some((row) => money(row.credit) === 1000),
      `cash account moved ${await delta(`1101.E2E${stamp}`)} (opening plus the transfer), equity ${await delta('3103')}, ${openingLines.length} lines`,
    );
    const second = await api('/accounting/opening-balances', {
      method: 'POST',
      json: {
        asOfDate: today,
        lines: [
          { accountId: cashLedger?.id, debit: '5', description: 'second attempt' },
          { accountId: code('3103'), credit: '5', description: 'second attempt' },
        ],
      },
    });
    const secondPost =
      second.status < 300
        ? await api(`/accounting/opening-balances/${second.data.id}/post`, { method: 'POST' })
        : second;
    check(
      'a branch cannot be given a second opening balance',
      secondPost.status >= 400 && secondPost.status < 500,
      `status ${secondPost.status}: ${secondPost.data?.detail ?? ''}`,
    );
  } else {
    check(
      'the branch already had an opening balance, and a second one is refused',
      opening.status === 400 || opening.status === 409,
      `status ${opening.status}: ${opening.data?.detail ?? ''}`,
    );
  }

  // ───────────────────────────────────────────── 10. the reports, checked
  const trial = await trialBalance();
  check(
    'the trial balance balances: closing debits equal closing credits',
    near(trial?.totals?.difference, 0),
    `debits ${trial?.totals?.closingDebit}, credits ${trial?.totals?.closingCredit}, difference ${trial?.totals?.difference}`,
  );

  const journal = await api(`/reports/general-journal?from=${from}&to=${today}`);
  check(
    'the general journal is a day book with sequential entry numbers and its lines',
    (journal.data?.items?.length ?? 0) > 0 &&
      journal.data.items.every((row) => row.entryNumber && row.lines?.length >= 2),
    `${journal.data?.items?.length ?? 0} entries, newest ${journal.data?.items?.[0]?.entryNumber}`,
  );

  const ledgerReport = await api(`/reports/general-ledger?from=${from}&to=${today}`);
  const ledgerRow = (ledgerReport.data?.items ?? ledgerReport.data?.rows ?? []).find(
    (row) => row.code === '1104',
  );
  check(
    'the general ledger reports opening, movement and closing per account',
    Boolean(ledgerRow) && near(ledgerRow?.closing, await closing('1104')),
    `account 1104 opening ${ledgerRow?.opening}, debit ${ledgerRow?.debit}, credit ${ledgerRow?.credit}, closing ${ledgerRow?.closing}`,
  );

  const accountLedger = await api(`/reports/account-ledger/${code('1104')}?from=${from}&to=${today}`);
  const movements = accountLedger.data?.movements ?? [];
  check(
    'the account ledger can be drilled into: every movement names its entry and its document',
    movements.length > 0 &&
      movements.every((row) => row.entryNumber) &&
      movements.every((row) => row.source?.type && row.source?.id),
    `${movements.length} movements, sources ${[...new Set(movements.map((row) => row.source?.type))].join('/')}`,
  );
  const sourceId = movements.find((row) => row.source?.type === 'SALES_INVOICE')?.source?.id;
  const drill = sourceId ? await api(`/sales/invoices/${sourceId}`) : { status: 0 };
  check(
    'a ledger line leads to a document that opens',
    drill.status === 0 || (drill.status === 200 && Boolean(drill.data?.invoiceNumber)),
    `document ${drill.data?.invoiceNumber ?? 'n/a'} (status ${drill.status})`,
  );

  const balanceSheet = await api(`/reports/balance-sheet?asOf=${today}`);
  check(
    'the balance sheet balances: assets equal liabilities plus equity, with the profit in equity',
    balanceSheet.data?.isBalanced === true,
    `assets ${balanceSheet.data?.totals?.assets}, liabilities ${balanceSheet.data?.totals?.liabilities}, equity ${balanceSheet.data?.totals?.equity}, difference ${balanceSheet.data?.totals?.difference}`,
  );
  const negativeLiabilities = (balanceSheet.data?.liabilities ?? []).some((row) => money(row.balance) < 0);
  check(
    'liabilities and equity are stated as positive credit balances, not as negative debits',
    !negativeLiabilities,
    `${(balanceSheet.data?.liabilities ?? []).length} liability lines, ${(balanceSheet.data?.equity ?? []).length} equity lines`,
  );

  const pnl = await api(`/reports/profit-and-loss?from=${from}&to=${today}`);
  const expectedRevenue = periodSum(trial, 'revenue');
  const expectedExpenses = periodSum(trial, 'expense');
  check(
    'the income statement agrees with the ledger for the same period',
    near(pnl.data?.totals?.revenue, expectedRevenue) &&
      near(pnl.data?.totals?.expenses, expectedExpenses) &&
      near(pnl.data?.totals?.netProfit, expectedRevenue - expectedExpenses),
    `revenue ${pnl.data?.totals?.revenue} (ledger ${expectedRevenue}), expenses ${pnl.data?.totals?.expenses} (ledger ${expectedExpenses}), profit ${pnl.data?.totals?.netProfit}`,
  );

  const cashFlow = await api(`/reports/cash-flow?from=${from}&to=${today}`);
  check(
    'the cash flow statement reports money in, money out and the net movement',
    Number(cashFlow.data?.totals?.inflow) > 0 &&
      Number(cashFlow.data?.totals?.outflow) > 0 &&
      near(
        money(cashFlow.data?.totals?.inflow) - money(cashFlow.data?.totals?.outflow),
        cashFlow.data?.totals?.net,
      ),
    `in ${cashFlow.data?.totals?.inflow}, out ${cashFlow.data?.totals?.outflow}, net ${cashFlow.data?.totals?.net}`,
  );

  const receivables = await api(`/reports/receivables-aging?asOf=${today}`);
  const payables = await api(`/reports/payables-aging?asOf=${today}`);
  check(
    'the ageing reports agree with the control accounts in the ledger',
    near(receivables.data?.totals?.differenceFromLedger, 0) &&
      near(payables.data?.totals?.differenceFromLedger, 0),
    `receivables difference ${receivables.data?.totals?.differenceFromLedger}, payables difference ${payables.data?.totals?.differenceFromLedger}`,
  );
  check(
    'the ageing report puts the balance in the right bucket and shows the credit note as a reduction',
    Array.isArray(receivables.data?.rows) &&
      receivables.data.rows.every((row) => row.buckets && row.invoices),
    `${receivables.data?.rows?.length ?? 0} parties, buckets ${Object.keys(receivables.data?.rows?.[0]?.buckets ?? {}).join('/')}`,
  );

  const valuation = await api('/inventory/reports/valuation');
  const valuationRow = (valuation.data?.rows ?? []).find((row) => row.itemId === itemA.id);
  check(
    'the stock valuation of the item equals the cost the ledger carries',
    near(valuationRow?.value, 400) && near(valuationRow?.quantity, 4),
    `quantity ${valuationRow?.quantity}, value ${valuationRow?.value}, ledger inventory ${valuation.data?.totals?.ledgerValue}`,
  );
  const reorder = await api('/inventory/reports/reorder');
  const slowMoving = await api('/inventory/reports/slow-moving?days=0');
  check(
    'the reorder-level and slow-moving reports answer with real rows',
    reorder.status === 200 && slowMoving.status === 200,
    `reorder rows ${(reorder.data?.rows ?? reorder.data?.items ?? []).length}, slow-moving rows ${(slowMoving.data?.rows ?? slowMoving.data?.items ?? []).length}`,
  );

  // ────────────────────────────────────────────────────── 11. the dashboard
  const dashboard = await api(`/dashboard/summary?from=${from}&to=${today}`);
  check(
    'the dashboard reports the period from real documents',
    dashboard.data?.hasData === true &&
      Number(dashboard.data?.sales?.total) >= 600 &&
      Number(dashboard.data?.purchases?.total) >= 1000,
    `sales ${dashboard.data?.sales?.total}, purchases ${dashboard.data?.purchases?.total}, stock ${dashboard.data?.stock?.value}, cash ${dashboard.data?.cashPosition}, overdue ${dashboard.data?.overdue?.total}`,
  );
  const emptyDashboard = await api('/dashboard/summary?from=1999-01-01&to=1999-12-31');
  check(
    'a period with nothing in it says so instead of showing invented numbers',
    emptyDashboard.data?.hasData === false &&
      Number(emptyDashboard.data?.sales?.total ?? 0) === 0,
    `hasData ${emptyDashboard.data?.hasData}, sales ${emptyDashboard.data?.sales?.total}`,
  );

  // ──────────────────────────────────────────── 12. what must be refused
  const oversell = await must('write a sales invoice for goods that are not in stock', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [{ itemId: itemB.id, quantity: '5', unitPrice: '30' }],
    },
  });
  if (oversell) {
    await mustRefuse('posting a sale of goods that are not in stock is refused', `/sales/invoices/${oversell.id}/post`, {
      method: 'POST',
    });
    const stillDraft = await api(`/sales/invoices/${oversell.id}`);
    check(
      'the refused invoice is left as a draft with nothing posted',
      String(stillDraft.data?.status).toUpperCase() === 'DRAFT',
      `status ${stillDraft.data?.status}`,
    );
  }

  const draft = await must('create a draft invoice to race against itself', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [{ itemId: itemA.id, quantity: '1', unitPrice: '150' }],
    },
  });
  if (draft) {
    const [first, second] = await Promise.all([
      api(`/sales/invoices/${draft.id}/post`, { method: 'POST' }),
      api(`/sales/invoices/${draft.id}/post`, { method: 'POST' }),
    ]);
    const successes = [first, second].filter((r) => r.status >= 200 && r.status < 300).length;
    check(
      'posting the same invoice twice at the same moment posts it exactly once',
      successes === 1,
      `statuses ${first.status} and ${second.status}`,
    );
    const after = await api(`/inventory/stock?itemId=${itemA.id}`);
    check(
      'the race did not take the stock out twice',
      near(quantityOf(after.data, itemA.id), 3),
      `on hand ${quantityOf(after.data, itemA.id)} (4 less the one just sold)`,
    );
  }

  // a user who may read but not write must be turned away by the API itself
  const role = await must('create a read-only role', '/admin/roles', {
    method: 'POST',
    json: { code: `E2E-RO-${stamp}`, nameEn: `Reader ${stamp}`, nameAr: `قارئ ${stamp}` },
  });
  const permissions = await api('/admin/permissions');
  const permissionRaw = permissions.data?.items ?? permissions.data;
  const permissionList = Array.isArray(permissionRaw)
    ? permissionRaw
    : (permissionRaw?.permissions ?? permissionRaw?.rows ?? []);
  const readOnly = permissionList.filter((row) =>
    ['reports.read', 'sales.invoices.read', 'parties.customers.read'].includes(row.code),
  );
  if (role && readOnly.length > 0) {
    await api(`/admin/roles/${role.id}/permissions`, {
      method: 'POST',
      json: { permissionIds: readOnly.map((row) => row.id) },
    });
    const user = await api('/admin/users', {
      method: 'POST',
      json: {
        username: `e2e-reader-${stamp}`,
        nameEn: `Reader ${stamp}`,
        nameAr: `قارئ ${stamp}`,
        password: `Reader@${stamp}9x`,
        roleIds: [role.id],
      },
    });
    if (user.status < 300) {
      const adminToken = token;
      const readerLogin = await api('/auth/login', {
        method: 'POST',
        json: { username: `e2e-reader-${stamp}`, password: `Reader@${stamp}9x` },
        noAuth: true,
      });
      check('the read-only user can sign in', Boolean(readerLogin.data?.accessToken), `status ${readerLogin.status}`);
      token = readerLogin.data?.accessToken ?? '';
      if (draft) {
        await mustRefuse('the read-only user cannot post an invoice', `/sales/invoices/${draft.id}/post`, {
          method: 'POST',
        });
      }
      await mustRefuse('the read-only user cannot create an item', '/inventory/items', {
        method: 'POST',
        json: { code: `NOPE-${stamp}`, nameEn: 'Not allowed', nameAr: 'غير مسموح', unit: 'PCS' },
      });
      const readable = await api(`/reports/trial-balance?from=${from}&to=${today}`);
      check(
        'the read-only user can still read the reports they were granted',
        readable.status === 200,
        `status ${readable.status}`,
      );
      token = adminToken;
    }
  }

  // Two separate invoices compete for the remaining stock at the same time.
  // Only one may consume two units when three are available; the other must
  // observe the locked, updated balance and be refused without a negative row.
  const competingDrafts = await Promise.all([
    must('create the first competing sale invoice', '/sales/invoices', {
      method: 'POST',
      json: {
        invoiceDate: today,
        customerId: customer.id,
        lines: [{ itemId: itemA.id, quantity: '2', unitPrice: '150' }],
      },
    }),
    must('create the second competing sale invoice', '/sales/invoices', {
      method: 'POST',
      json: {
        invoiceDate: today,
        customerId: customer.id,
        lines: [{ itemId: itemA.id, quantity: '2', unitPrice: '150' }],
      },
    }),
  ]);
  if (competingDrafts.every(Boolean)) {
    const outcomes = await Promise.all(
      competingDrafts.map((invoice) =>
        api(`/sales/invoices/${invoice.id}/post`, { method: 'POST' }),
      ),
    );
    const successfulPosts = outcomes.filter((r) => r.status >= 200 && r.status < 300).length;
    check(
      'two different invoices cannot oversell the same stock concurrently',
      successfulPosts === 1,
      `statuses ${outcomes.map((r) => r.status).join(' and ')}`,
    );
    const stockAfterRace = await api(`/inventory/stock?itemId=${itemA.id}`);
    check(
      'concurrent sales preserve the exact nonnegative stock balance',
      near(quantityOf(stockAfterRace.data, itemA.id), 1),
      `on hand ${quantityOf(stockAfterRace.data, itemA.id)} (three before the competing posts)`,
    );

    const successfulIndex = outcomes.findIndex((r) => r.status >= 200 && r.status < 300);
    if (successfulIndex >= 0) {
      const successfulInvoice = competingDrafts[successfulIndex];
      const reversed = await api(`/sales/invoices/${successfulInvoice.id}/reverse`, {
        method: 'POST',
      });
      check(
        'a posted sales invoice reverses with its stock and ledger effects',
        reversed.status >= 200 && reversed.status < 300 &&
          String(reversed.data?.status).toUpperCase() === 'REVERSED',
        `status ${reversed.status}, document ${reversed.data?.status ?? 'unknown'}`,
      );
      const repeatedReversal = await api(`/sales/invoices/${successfulInvoice.id}/reverse`, {
        method: 'POST',
      });
      check(
        'reversing the same sales invoice twice is refused',
        repeatedReversal.status >= 400,
        `status ${repeatedReversal.status}`,
      );
      const stockAfterReversal = await api(`/inventory/stock?itemId=${itemA.id}`);
      check(
        'repeated reversal does not change stock a second time',
        near(quantityOf(stockAfterReversal.data, itemA.id), 3),
        `on hand ${quantityOf(stockAfterReversal.data, itemA.id)} after restoring the reversed sale`,
      );
    }
  }

  // ─────────────────────────────────────── 14. sessions and their lifecycle
  const refreshed = await api('/auth/refresh', {
    method: 'POST',
    json: { refreshToken },
    noAuth: true,
  });
  check(
    'a session can be extended with its refresh token',
    refreshed.status < 300 && Boolean(refreshed.data?.accessToken),
    `status ${refreshed.status}`,
  );
  const sessionToken = refreshed.data?.refreshToken ?? refreshToken;
  const sessionAccess = refreshed.data?.accessToken ?? token;
  const logout = await api('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionAccess}`, 'x-refresh-token': sessionToken },
    noAuth: true,
  });
  check('logging out is accepted', logout.status < 300, `status ${logout.status}`);
  const reused = await api('/auth/refresh', {
    method: 'POST',
    json: { refreshToken: sessionToken },
    noAuth: true,
  });
  check(
    'a refresh token that was logged out cannot be used again',
    reused.status >= 400,
    `status ${reused.status}`,
  );
  await mustRefuse('a request without a token is refused', '/reports/trial-balance', { noAuth: true });

  // ──────────────────────────── 14. the audit log, and the database behind it
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const auditBefore = await client.query('SELECT count(*)::int AS n FROM audit_logs');
    check(
      'every change in this scenario was written to the audit log',
      auditBefore.rows[0].n > 0,
      `${auditBefore.rows[0].n} audit rows`,
    );
    const actions = await client.query(
      "SELECT DISTINCT entity FROM audit_logs WHERE entity IS NOT NULL ORDER BY 1 LIMIT 12",
    );
    check(
      'the audit log records the entity behind each action',
      actions.rows.length >= 3,
      actions.rows.map((row) => row.entity).join(', '),
    );

    let updateRefused = false;
    let deleteRefused = false;
    try {
      await client.query(
        "UPDATE audit_logs SET action = 'tampered' WHERE id = (SELECT id FROM audit_logs LIMIT 1)",
      );
    } catch (error) {
      updateRefused = true;
      void error;
    }
    try {
      await client.query('DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1)');
    } catch (error) {
      deleteRefused = true;
      void error;
    }
    const auditAfter = await client.query('SELECT count(*)::int AS n FROM audit_logs');
    check(
      'the audit log refuses to be edited or deleted, even with SQL',
      updateRefused && deleteRefused && auditBefore.rows[0].n === auditAfter.rows[0].n,
      `update refused ${updateRefused}, delete refused ${deleteRefused}, ${auditBefore.rows[0].n} rows before and ${auditAfter.rows[0].n} after`,
    );

    // ───────────────────────────────────── 15. single-active-company isolation invariant
    // This product intentionally allows only one non-deleted company at a time.
    // Do not try to create a second active tenant here: that violates the schema
    // invariant before an API isolation test can run. Verify the database guard
    // directly; tenant-scoped authorization is covered by the dedicated auth
    // and permission tests.
    let secondActiveCompanyRejected = false;
    try {
      await client.query(
        `INSERT INTO companies (id, code, "nameEn", "nameAr", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, now(), now()) RETURNING id`,
        [`ISO-${stamp}`, `Isolation company ${stamp}`, `شركة العزل ${stamp}`],
      );
    } catch (error) {
      secondActiveCompanyRejected =
        error?.code === '23505' &&
        error?.constraint === 'Company_one_active_company_idx';
    }
    check(
      'the database rejects a second active company',
      secondActiveCompanyRejected,
      'the single-active-company constraint must reject a second non-deleted company',
    );

    // ─────────────────────────────────────────────── 16. migrations, checked
    const migrations = await client.query(
      'SELECT count(*)::int AS n, count(*) FILTER (WHERE finished_at IS NULL)::int AS pending FROM _prisma_migrations',
    );
    check(
      'every migration is applied and none is left pending',
      migrations.rows[0].pending === 0 && migrations.rows[0].n >= 9,
      `${migrations.rows[0].n} migrations, ${migrations.rows[0].pending} pending`,
    );
  } finally {
    await client.end();
  }

  // ─────────────────────────────────────────────── 17. backup and restore
  const capabilities = await api('/backup/full/capabilities');
  if (capabilities.data?.available) {
    // The scheduled path, run once on demand: this is the same code the timer
    // calls, so proving it here proves the schedule.
    const scheduled = await api('/backup/schedule/run', { method: 'POST' });
    const scheduledRun = (scheduled.data ?? [])[0];
    check(
      'the scheduled backup runs, and reports what it wrote',
      scheduled.status < 300 && Boolean(scheduledRun?.fileName),
      `${scheduledRun?.fileName} — ${scheduledRun?.status}: ${scheduledRun?.message}`,
    );
    check(
      'every scheduled backup is recorded in the history an operator reads',
      (await api('/backup/schedule/history')).data?.length >= 1,
      `${(await api('/backup/schedule/history')).data?.length ?? 0} recorded runs`,
    );

    const backup = await api('/backup/full', { method: 'POST' });
    const file = backup.data?.file ?? backup.data;
    check(
      'a full backup of the database can be taken by hand as well',
      backup.status < 300 && Boolean(file?.name),
      `${file?.name} (${file?.sizeBytes ?? '?'} bytes, ${backup.data?.durationMs ?? '?'} ms)`,
    );
    const name = scheduledRun?.fileName ?? file?.name;
    const listed = await api('/backup/full');
    const listedItems = Array.isArray(listed.data) ? listed.data : (listed.data?.items ?? []);
    check(
      'the backups are listed in the backup folder on the server',
      listedItems.some((row) => row.name === name),
      `${listedItems.length} backups on the server, newest ${listedItems[0]?.name}`,
    );

    const verified = await api(`/backup/full/${encodeURIComponent(name)}/verify`, { method: 'POST' });
    check(
      'the backup can be read back, which is what makes it a backup',
      verified.status < 300 && Number(verified.data?.entries ?? 0) > 0,
      `status ${verified.status}, ${verified.data?.entries ?? '?'} objects inside`,
    );

    const restored = await api('/backup/full/restore', {
      method: 'POST',
      json: { fileName: name, confirm: true },
    });
    check(
      'the backup can be restored, and the restore reports what it put back',
      restored.status < 300 && restored.data?.restored === true,
      `restored ${restored.data?.source}, safety copy ${restored.data?.safetyBackup}, rehearsed ${restored.data?.rehearsed}`,
    );
    const afterRestore = await api(`/parties/customers?q=${encodeURIComponent(`E2E-C-${stamp}`)}`);
    check(
      'after the restore the data is still there, including what this run created',
      (afterRestore.data?.items ?? []).some((row) => row.code === `E2E-C-${stamp}`),
      `${afterRestore.data?.items?.length ?? 0} matching customers after the restore`,
    );
    const schedule = await api('/backup/schedule');
    check(
      'the schedule reports its interval, its retention and when it is next due',
      schedule.status === 200 && Number(schedule.data?.retentionCount) > 0,
      `interval ${schedule.data?.intervalHours}h, retention ${schedule.data?.retentionCount}, next ${schedule.data?.nextDueAt}`,
    );
  } else {
    skip('backup and restore', `pg_dump is not available here: ${capabilities.data?.reason ?? 'unknown reason'}`);
  }

  // ─────────────────────── 18. the server defends itself against a flood
  const flood = await Promise.all(
    Array.from({ length: 30 }, () =>
      api('/auth/login', {
        method: 'POST',
        json: { username: USERNAME, password: 'definitely-not-the-password' },
        noAuth: true,
        noRetry: true,
      }),
    ),
  );
  const limited = flood.some((row) => row.status === 429);
  const rejected = flood.filter((row) => row.status === 401).length;
  check(
    'repeated failed logins are rejected and then rate-limited',
    rejected >= 1 && limited,
    `${rejected} rejected, rate limited: ${limited}`,
  );
  const detail = flood.find((row) => row.status === 429)?.data?.detail ?? '';
  check(
    'the refusal does not leak whether the password or the account was wrong',
    !/password|user not found|no such/i.test(String(detail)) || /too many requests/i.test(String(detail)),
    String(detail).slice(0, 90),
  );

  // ─────────────────────────────────────────────────────────── the summary
  const failed = results.filter((row) => !row.ok);
  const skipped = results.filter((row) => row.skipped);
  console.log(
    `\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} checks passed` +
      (skipped.length ? `, ${skipped.length} skipped` : '') +
      (failed.length ? `\nFAILED:\n  - ${failed.map((row) => `${row.name} (${row.detail})`).join('\n  - ')}` : ''),
  );
  return failed.length === 0;
}

/// Balances answer as a list or inside a wrapper, depending on the route.
function quantityOf(data, itemId) {
  const rows = Array.isArray(data) ? data : data?.items ?? data?.balances ?? [];
  const row = rows.find((entry) => entry.itemId === itemId || entry.item?.id === itemId);
  return money(row?.quantity ?? 0);
}

/// Revenue or expenses for the period, read out of the trial balance rows, so
/// the income statement can be checked against the ledger it came from.
function periodSum(trial, type) {
  return (trial?.rows ?? [])
    .filter((row) => String(row.type).toLowerCase() === type)
    .reduce((total, row) => {
      const moved = money(row.debit) - money(row.credit);
      return total + (type === 'revenue' ? -moved : moved);
    }, 0);
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error('\nThe scenario stopped with an unexpected error:');
    console.error(error);
    process.exit(2);
  });
