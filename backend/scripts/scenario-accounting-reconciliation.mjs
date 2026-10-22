#!/usr/bin/env node
/**
 * The full accounting lifecycle, hand-computed end to end.
 *
 *   node backend/scripts/scenario-accounting-reconciliation.mjs [apiBaseUrl]
 *
 * One company year (2024, a year no other script touches) whose every
 * figure is known before anything runs:
 *
 *   capital in 150,000 · an asset bought for 120,000 (salvage 12,000,
 *   60 months → 1,800 a month), depreciated 3 months, sold for 120,000
 *   (gain 5,400) · a small asset (1,200 / 200 / 10) depreciated to its
 *   salvage floor and no further · buy 10 @ 100, pay 500 of 1,140 ·
 *   sell 4 @ 150, collect 300 of 684 · return 1 to us, 2 to the
 *   supplier · settle both · an unallocated advance of 250 · rent 300.
 *
 * The year closes at a 1,150 loss (revenue 5,850 incl. the disposal
 * gain, expenses 7,000), equity 148,850, cash 148,351 — and every
 * statement must tell that same story: trial balance, ledgers, equity
 * changes against the balance sheet, cash-flow sections against the
 * cash ledger, both subledgers against their control accounts,
 * inventory valuation against the inventory account, the asset
 * register against its ledger accounts. Then the year closes, 2025
 * opens on its balances, the closed year refuses new writing, and a
 * reversal lands in the open present.
 *
 * Runs in CI right after scenario-accounting, whose guarded reset
 * leaves a fresh company — so the fixed-asset and valuation figures
 * are this scenario's own, on real PostgreSQL, nothing mocked.
 */
const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-6);
const YEAR_FROM = '2024-01-01';
const YEAR_TO = '2024-12-31';
const today = new Date().toISOString().slice(0, 10);

const money = (value) => Number(Number(value ?? 0).toFixed(4));
const near = (a, b, tolerance = 0.005) => Math.abs(money(a) - money(b)) <= tolerance;

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
    if (options.binary) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.status !== 429 || attempt >= 6) {
        return {
          status: response.status,
          bytes: bytes.length,
          contentType: response.headers.get('content-type') ?? '',
        };
      }
      await sleep(6000);
      continue;
    }
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status !== 429 || attempt >= 6) {
      return { status: response.status, data };
    }
    // The script before this one deliberately trips the login limiter;
    // wait out whatever window it names instead of failing on it.
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
  check(
    label,
    response.status >= 400 && response.status < 500,
    `status ${response.status} ${JSON.stringify(response.data)?.slice(0, 200)}`,
  );
  return response;
}

let chart = [];
const code = (c) => chart.find((row) => row.code === c)?.id;

async function trialBalance(fromDate, toDate) {
  return (await api(`/reports/trial-balance?from=${fromDate}&to=${toDate}`)).data;
}
const rowOf = (trial, c) => (trial?.rows ?? []).find((r) => r.code === c);
const closingOf = (trial, c) => money(rowOf(trial, c)?.closing ?? 0);
const openingOf = (trial, c) => money(rowOf(trial, c)?.opening ?? 0);
const yearTrial = () => trialBalance(YEAR_FROM, YEAR_TO);

function quantityOf(data, itemId) {
  const rows = Array.isArray(data) ? data : data?.items ?? data?.balances ?? [];
  const row = rows.find((entry) => entry.itemId === itemId || entry.item?.id === itemId);
  return money(row?.quantity ?? 0);
}

async function postManualEntry(label, entryDate, lines) {
  const entry = await must(label, '/accounting/journal-entries', {
    method: 'POST',
    json: { entryDate, description: `${label} ${stamp}`, lines },
  });
  if (!entry) return null;
  await api(`/accounting/journal-entries/${entry.id}/submit`, { method: 'POST' });
  await must(`${label} — approved`, `/accounting/journal-entries/${entry.id}/approve`, { method: 'POST' });
  const posted = await must(`${label} — posted`, `/accounting/journal-entries/${entry.id}/post`, { method: 'POST' });
  return posted ?? entry;
}

async function addAccount(codeValue, name, type, parentCode, cashFlowClass) {
  return must(`add ledger account ${codeValue}`, '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: codeValue,
      nameEn: `${name} ${stamp}`,
      nameAr: `${name} ${stamp}`,
      type,
      parentId: code(parentCode),
      isPostable: true,
      ...(cashFlowClass ? { cashFlowClass } : {}),
    },
  });
}

async function main() {
  console.log(`Accounting lifecycle scenario against ${API}\n`);

  const login = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  check('sign in as the administrator', login.status < 300 && Boolean(token), `status ${login.status}`);
  if (!token) return false;

  await must('set the VAT rate to 14% for known figures', '/accounting/settings', {
    method: 'PATCH',
    json: { taxRate: '14', allowNegativeStock: false },
  });

  const chartResponse = await api('/accounting/chart-of-accounts');
  chart = chartResponse.data?.items ?? [];
  for (const needed of ['1101', '1103', '1104', '1105', '1201', '1203', '2101', '2103', '3101', '3102', '4101', '4103', '5101', '5103', '5105']) {
    if (!code(needed)) {
      check(`the chart of accounts contains account ${needed}`, false, 'missing: is the database seeded?');
      return false;
    }
  }

  // The IAS 7 classes are the accountant's decision, made per account.
  // Make them now, the way an accountant would on day one.
  for (const [c, cls] of [
    ['4101', 'OPERATING'], ['4103', 'OPERATING'], ['5103', 'OPERATING'],
    ['1103', 'OPERATING'], ['2101', 'OPERATING'], ['3101', 'FINANCING'],
  ]) {
    await must(`classify ${c} as ${cls}`, `/accounting/chart-of-accounts/${code(c)}`, {
      method: 'PATCH',
      json: { cashFlowClass: cls },
    });
  }

  // ── own ledger accounts, so every figure below is this scenario's ──────
  const cashCode = `1101.REC${stamp}`;
  const assetCode = `1201.REC${stamp}`;
  const accumCode = `1203.REC${stamp}`;
  const deprCode = `5105.REC${stamp}`;
  const cashLedger = await addAccount(cashCode, 'Lifecycle cash', 'ASSET', '1101');
  const assetLedger = await addAccount(assetCode, 'Lifecycle plant', 'ASSET', '1201', 'INVESTING');
  const accumLedger = await addAccount(accumCode, 'Lifecycle accumulated depreciation', 'ASSET', '1203', 'INVESTING');
  const deprLedger = await addAccount(deprCode, 'Lifecycle depreciation expense', 'EXPENSE', '5105');
  if (!cashLedger || !assetLedger || !accumLedger || !deprLedger) return false;
  const cashAccount = await must('open a cash box', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `RECBOX-${stamp}`,
      nameEn: `Lifecycle cash box ${stamp}`,
      nameAr: `خزينة دورة الحياة ${stamp}`,
      kind: 'CASH',
      accountId: cashLedger.id,
    },
  });
  if (!cashAccount) return false;

  const period = await must('open the 2024 fiscal year', '/accounting/fiscal-periods', {
    method: 'POST',
    json: {
      code: `REC-${stamp}`,
      nameEn: `Lifecycle year ${stamp}`,
      nameAr: `سنة دورة الحياة ${stamp}`,
      startDate: YEAR_FROM,
      endDate: YEAR_TO,
    },
  });
  if (!period) return false;

  const customer = await must('create a customer', '/parties/customers', {
    method: 'POST',
    json: { code: `REC-C-${stamp}`, nameEn: `Lifecycle customer ${stamp}`, nameAr: `عميل دورة الحياة ${stamp}`, paymentTermDays: 30 },
  });
  const supplier = await must('create a supplier', '/parties/suppliers', {
    method: 'POST',
    json: { code: `REC-S-${stamp}`, nameEn: `Lifecycle supplier ${stamp}`, nameAr: `مورد دورة الحياة ${stamp}`, paymentTermDays: 30 },
  });
  const category = await must('create a category', '/inventory/categories', {
    method: 'POST',
    json: { code: `REC-CAT-${stamp}`, nameEn: `Lifecycle category ${stamp}`, nameAr: `تصنيف ${stamp}` },
  });
  const item = await must('create a stocked item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `REC-I-${stamp}`,
      nameEn: `Lifecycle item ${stamp}`,
      nameAr: `صنف دورة الحياة ${stamp}`,
      unit: 'PCS',
      isStockTracked: true,
      salePrice: '150',
      purchasePrice: '100',
      categoryId: category?.id,
    },
  });
  if (!customer || !supplier || !item) return false;

  // ── 1. balance is not optional; capital opens the year ─────────────────
  await mustRefuse('an unbalanced entry is refused (100 against 90)', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: '2024-01-02',
      description: `Unbalanced ${stamp}`,
      lines: [
        { accountId: cashLedger.id, debit: '100' },
        { accountId: code('3101'), credit: '90' },
      ],
    },
  });
  const capital = await postManualEntry('the owner puts in 150,000 of capital', '2024-01-02', [
    { accountId: cashLedger.id, debit: '150000' },
    { accountId: code('3101'), credit: '150000' },
  ]);
  if (!capital) return false;
  await mustRefuse(
    'posting the same entry a second time is refused',
    `/accounting/journal-entries/${capital.id}/post`,
    { method: 'POST' },
  );

  // ── 2. fixed assets: register, activation, depreciation, disposal ──────
  const machine = await must('register the machine as a draft asset', '/fixed-assets', {
    method: 'POST',
    json: {
      code: `FA-M-${stamp}`,
      nameEn: `Lifecycle machine ${stamp}`,
      nameAr: `ماكينة دورة الحياة ${stamp}`,
      category: 'Machinery',
      purchaseDate: '2024-01-03',
      inServiceDate: '2024-01-01',
      supplierId: supplier.id,
      cost: '120000',
      salvageValue: '12000',
      usefulLifeMonths: 60,
      assetAccountId: assetLedger.id,
      accumulatedAccountId: accumLedger.id,
      expenseAccountId: deprLedger.id,
    },
  });
  if (!machine) return false;
  check(
    'a draft asset carries cost and book value but no ledger effect yet',
    machine.status === 'DRAFT' && near(machine.bookValue, 120000) && near(closingOf(await yearTrial(), assetCode), 0),
    `status ${machine.status}, book value ${machine.bookValue}`,
  );
  const activated = await must('activate the machine (posts the acquisition)', `/fixed-assets/${machine.id}/activate`, {
    method: 'POST',
    json: { fundingAccountId: cashLedger.id, date: '2024-01-03' },
  });
  check(
    'activation debited the asset account and credited cash',
    activated?.status === 'ACTIVE' &&
      near(closingOf(await yearTrial(), assetCode), 120000) &&
      near(closingOf(await yearTrial(), cashCode), 30000),
    `asset ${closingOf(await yearTrial(), assetCode)}, cash ${closingOf(await yearTrial(), cashCode)}`,
  );
  await mustRefuse('activating the same asset twice is refused', `/fixed-assets/${machine.id}/activate`, {
    method: 'POST',
    json: { fundingAccountId: cashLedger.id, date: '2024-01-03' },
  });
  await mustRefuse('editing an active asset is refused', `/fixed-assets/${machine.id}`, {
    method: 'PATCH',
    json: { cost: '1' },
  });

  const janRun = await must('run January depreciation', '/fixed-assets/depreciation-runs', {
    method: 'POST',
    json: { period: '2024-01', assetIds: [machine.id] },
  });
  check(
    'straight line: (120,000 − 12,000) / 60 = 1,800 for the month',
    near(janRun?.depreciated?.[0]?.amount, 1800) && near(janRun?.run?.totalAmount, 1800),
    `charged ${janRun?.depreciated?.[0]?.amount}`,
  );
  const cashBeforeRetry = closingOf(await yearTrial(), cashCode);
  await mustRefuse('running January depreciation again is refused', '/fixed-assets/depreciation-runs', {
    method: 'POST',
    json: { period: '2024-01', assetIds: [machine.id] },
  });
  const afterRetry = await api(`/fixed-assets/${machine.id}`);
  check(
    'the refused second run changed nothing',
    near(afterRetry.data?.accumulatedDepreciation, 1800) &&
      near(closingOf(await yearTrial(), accumCode), -1800) &&
      near(closingOf(await yearTrial(), cashCode), cashBeforeRetry),
    `accumulated ${afterRetry.data?.accumulatedDepreciation}, ledger ${closingOf(await yearTrial(), accumCode)}`,
  );
  for (const month of ['2024-02', '2024-03']) {
    await must(`run ${month} depreciation`, '/fixed-assets/depreciation-runs', {
      method: 'POST',
      json: { period: month, assetIds: [machine.id] },
    });
  }

  // A small asset to prove the salvage floor: 100 a month for 10 months.
  const tool = await must('register a small tool', '/fixed-assets', {
    method: 'POST',
    json: {
      code: `FA-T-${stamp}`,
      nameEn: `Lifecycle tool ${stamp}`,
      nameAr: `عدة ${stamp}`,
      purchaseDate: '2024-01-03',
      inServiceDate: '2024-01-01',
      cost: '1200',
      salvageValue: '200',
      usefulLifeMonths: 10,
      assetAccountId: assetLedger.id,
      accumulatedAccountId: accumLedger.id,
      expenseAccountId: deprLedger.id,
    },
  });
  if (!tool) return false;
  await must('activate the tool', `/fixed-assets/${tool.id}/activate`, {
    method: 'POST',
    json: { fundingAccountId: cashLedger.id, date: '2024-01-03' },
  });
  for (const month of ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10']) {
    await must(`depreciate the tool for ${month}`, '/fixed-assets/depreciation-runs', {
      method: 'POST',
      json: { period: month, assetIds: [tool.id] },
    });
  }
  const toolDone = await api(`/fixed-assets/${tool.id}`);
  check(
    'book value stops exactly at salvage and the asset is fully depreciated',
    near(toolDone.data?.bookValue, 200) && toolDone.data?.status === 'FULLY_DEPRECIATED',
    `book value ${toolDone.data?.bookValue}, status ${toolDone.data?.status}`,
  );
  await mustRefuse('an eleventh month has nothing left to charge', '/fixed-assets/depreciation-runs', {
    method: 'POST',
    json: { period: '2024-11', assetIds: [tool.id] },
  });
  const toolAfter = await api(`/fixed-assets/${tool.id}`);
  check(
    'book value never fell below salvage',
    near(toolAfter.data?.bookValue, 200),
    `book value ${toolAfter.data?.bookValue}`,
  );

  // ── 3. trading: buy, part-pay, sell, part-collect, rent ────────────────
  const purchase = await must('buy 10 units at 100 on credit', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: '2024-02-01',
      supplierId: supplier.id,
      lines: [{ itemId: item.id, quantity: '10', unitPrice: '100' }],
    },
  });
  if (!purchase) return false;
  await must('post the purchase invoice', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' });
  let trial = await yearTrial();
  check(
    'the purchase posted inventory 1,000, VAT 140, payable 1,140',
    near(closingOf(trial, '1104'), 1000) && near(closingOf(trial, '1105'), 140) && near(closingOf(trial, '2101'), -1140),
    `inventory ${closingOf(trial, '1104')}, VAT ${closingOf(trial, '1105')}, payable ${closingOf(trial, '2101')}`,
  );

  const partPay = await must('pay the supplier 500', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: '2024-02-10',
      cashAccountId: cashAccount.id,
      supplierId: supplier.id,
      amount: '500',
      allocations: [{ purchaseInvoiceId: purchase.id, amount: '500' }],
    },
  });
  if (!partPay) return false;
  await must('post the part payment', `/cash/vouchers/${partPay.id}/post`, { method: 'POST' });

  const sale = await must('sell 4 units at 150 on credit', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: '2024-03-01',
      dueDate: '2024-03-31',
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '4', unitPrice: '150' }],
    },
  });
  if (!sale) return false;
  await must('post the sales invoice', `/sales/invoices/${sale.id}/post`, { method: 'POST' });
  trial = await yearTrial();
  check(
    'the sale posted revenue 600, VAT 84, COGS 400 and a 684 receivable',
    near(closingOf(trial, '4101'), -600) &&
      near(closingOf(trial, '2103'), -84) &&
      near(closingOf(trial, '5101'), 400) &&
      near(closingOf(trial, '1103'), 684) &&
      near(closingOf(trial, '1104'), 600),
    `revenue ${closingOf(trial, '4101')}, COGS ${closingOf(trial, '5101')}, receivable ${closingOf(trial, '1103')}, inventory ${closingOf(trial, '1104')}`,
  );

  const partReceipt = await must('collect 300 of the 684', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: '2024-03-05',
      cashAccountId: cashAccount.id,
      customerId: customer.id,
      amount: '300',
      allocations: [{ salesInvoiceId: sale.id, amount: '300' }],
    },
  });
  if (!partReceipt) return false;
  await must('post the part collection', `/cash/vouchers/${partReceipt.id}/post`, { method: 'POST' });

  const rent = await postManualEntry('pay the rent', '2024-03-06', [
    { accountId: code('5103'), debit: '300' },
    { accountId: cashLedger.id, credit: '300' },
  ]);
  if (!rent) return false;

  // ── 4. returns both ways; the subledgers must follow ───────────────────
  const saleDetail = await api(`/sales/invoices/${sale.id}`);
  const saleLineId = saleDetail.data?.lines?.[0]?.id;
  const creditNote = await must('credit note for 1 returned unit', '/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: sale.id,
      returnDate: '2024-03-10',
      reason: 'Damaged on delivery',
      lines: [{ originalLineId: saleLineId, quantity: '1' }],
    },
  });
  if (creditNote) {
    await must('post the credit note', `/returns/sales/${creditNote.id}/post`, { method: 'POST' });
  }
  const purchaseDetail = await api(`/purchases/invoices/${purchase.id}`);
  const purchaseLineId = purchaseDetail.data?.lines?.[0]?.id;
  const debitNote = await must('debit note for 2 units back to the supplier', '/returns/purchases', {
    method: 'POST',
    json: {
      originalInvoiceId: purchase.id,
      returnDate: '2024-03-12',
      reason: 'Not the ordered quality',
      lines: [{ originalLineId: purchaseLineId, quantity: '2' }],
    },
  });
  if (debitNote) {
    await must('post the debit note', `/returns/purchases/${debitNote.id}/post`, { method: 'POST' });
  }
  trial = await yearTrial();
  check(
    'returns moved stock and ledgers back: 5 units, inventory 500, COGS 300',
    near(quantityOf((await api(`/inventory/stock?itemId=${item.id}`)).data, item.id), 5) &&
      near(closingOf(trial, '1104'), 500) &&
      near(closingOf(trial, '5101'), 300),
    `inventory ${closingOf(trial, '1104')}, COGS ${closingOf(trial, '5101')}`,
  );
  const custRow = ((await api(`/reports/customer-balances?asOf=${today}`)).data?.rows ?? [])
    .find((r) => r.customerId === customer.id);
  const suppRow = ((await api(`/reports/supplier-balances?asOf=${today}`)).data?.rows ?? [])
    .find((r) => r.supplierId === supplier.id);
  check(
    'the customer subledger subtracts the credit note: 684 − 171 − 300 = 213',
    near(custRow?.balance, 213) && near(closingOf(trial, '1103'), 213),
    `subledger ${custRow?.balance}, control ${closingOf(trial, '1103')}`,
  );
  check(
    'the supplier subledger subtracts the debit note: 1,140 − 228 − 500 = 412',
    near(suppRow?.balance, 412) && near(closingOf(trial, '2101'), -412),
    `subledger ${suppRow?.balance}, control ${closingOf(trial, '2101')}`,
  );

  // ── 5. settle; reconcile; an advance; the control-account guard ────────
  const finalReceipt = await must('collect the remaining 213', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: '2024-04-01',
      cashAccountId: cashAccount.id,
      customerId: customer.id,
      amount: '213',
      allocations: [{ salesInvoiceId: sale.id, amount: '213' }],
    },
  });
  if (!finalReceipt) return false;
  await must('post the final collection', `/cash/vouchers/${finalReceipt.id}/post`, { method: 'POST' });
  const finalPay = await must('pay the remaining 412', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: '2024-04-01',
      cashAccountId: cashAccount.id,
      supplierId: supplier.id,
      amount: '412',
      allocations: [{ purchaseInvoiceId: purchase.id, amount: '412' }],
    },
  });
  if (!finalPay) return false;
  await must('post the final payment', `/cash/vouchers/${finalPay.id}/post`, { method: 'POST' });

  for (const side of ['receivables', 'payables']) {
    const rec = (await api(`/reports/${side}-reconciliation?asOf=${today}`)).data;
    check(
      `${side} reconciliation is exact after settlement`,
      near(rec?.difference, 0) && near(rec?.unexplained, 0) && near(rec?.advances, 0) && rec?.isReconciled === true,
      `control ${rec?.controlBalance}, subledger ${rec?.subledger?.total}, unexplained ${rec?.unexplained}`,
    );
  }

  const advance = await must('take a 250 advance with no invoice', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: '2024-04-02',
      cashAccountId: cashAccount.id,
      customerId: customer.id,
      amount: '250',
      allocations: [],
    },
  });
  if (!advance) return false;
  await must('post the advance', `/cash/vouchers/${advance.id}/post`, { method: 'POST' });
  const recAdvance = (await api(`/reports/receivables-reconciliation?asOf=${today}`)).data;
  check(
    'the advance shows as money held, fully explaining the difference',
    near(recAdvance?.advances, 250) && near(recAdvance?.difference, -250) && near(recAdvance?.unexplained, 0),
    `advances ${recAdvance?.advances}, difference ${recAdvance?.difference}, unexplained ${recAdvance?.unexplained}`,
  );
  await mustRefuse('a manual entry straight onto the receivable control is refused', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: '2024-04-03',
      description: `Stray control posting ${stamp}`,
      lines: [
        { accountId: code('1103'), debit: '10' },
        { accountId: code('4101'), credit: '10' },
      ],
    },
  });

  // ── 6. disposal: cost 120,000, accumulated 5,400, sold for 120,000 ─────
  const disposed = await must('sell the machine for 120,000', `/fixed-assets/${machine.id}/dispose`, {
    method: 'POST',
    json: { date: '2024-06-01', proceeds: '120000', proceedsAccountId: cashLedger.id },
  });
  check(
    'disposal gain is proceeds − book value: 120,000 − 114,600 = 5,400',
    near(disposed?.disposal?.gainOrLoss, 5400) &&
      near(disposed?.disposal?.bookValue, 114600) &&
      disposed?.status === 'DISPOSED',
    `gain ${disposed?.disposal?.gainOrLoss}, book value was ${disposed?.disposal?.bookValue}`,
  );
  const register = (await api('/fixed-assets/reports/summary')).data;
  check(
    'the register ties to the ledger after disposal (tool only: 1,200 / 1,000 / 200)',
    near(register?.totals?.cost, 1200) &&
      near(register?.totals?.accumulatedDepreciation, 1000) &&
      near(register?.totals?.bookValue, 200) &&
      (register?.assetAccounts ?? []).every((r) => near(r.difference, 0)) &&
      (register?.accumulatedAccounts ?? []).every((r) => near(r.difference, 0)),
    `cost ${register?.totals?.cost}, accumulated ${register?.totals?.accumulatedDepreciation}, differences ${JSON.stringify([...(register?.assetAccounts ?? []), ...(register?.accumulatedAccounts ?? [])].map((r) => r.difference))}`,
  );

  // ── 7. every statement tells the same story ────────────────────────────
  trial = await yearTrial();
  check('the trial balance balances', near(trial?.totals?.difference, 0), `difference ${trial?.totals?.difference}`);
  check(
    'the trial balance carries the hand-computed closings',
    near(closingOf(trial, cashCode), 148351) &&
      near(closingOf(trial, '1103'), -250) &&
      near(closingOf(trial, '1104'), 500) &&
      near(closingOf(trial, '3101'), -150000) &&
      near(closingOf(trial, '4101'), -600),
    `cash ${closingOf(trial, cashCode)}, AR ${closingOf(trial, '1103')}, inventory ${closingOf(trial, '1104')}, capital ${closingOf(trial, '3101')}`,
  );
  for (const [label, c, accountId] of [
    ['cash', cashCode, cashLedger.id],
    ['revenue', '4101', code('4101')],
    ['capital', '3101', code('3101')],
  ]) {
    const ledger = await api(`/reports/account-ledger/${accountId}?from=${YEAR_FROM}&to=${YEAR_TO}`);
    check(
      `the ${label} ledger closing equals its trial-balance closing`,
      ledger.status === 200 && near(ledger.data?.closing, closingOf(trial, c)),
      `ledger ${ledger.data?.closing}, trial balance ${closingOf(trial, c)}`,
    );
  }

  const equity = (await api(`/reports/equity-changes?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  const balanceSheet = (await api(`/reports/balance-sheet?asOf=${YEAR_TO}`)).data;
  check(
    'equity: 0 − 1,150 (loss incl. 5,400 gain) + 150,000 = 148,850',
    near(equity?.totals?.resultForPeriod, -1150) &&
      near(equity?.totals?.otherMovements, 150000) &&
      near(equity?.totals?.closing, 148850) &&
      near(equity?.totals?.difference, 0),
    `result ${equity?.totals?.resultForPeriod}, closing ${equity?.totals?.closing}`,
  );
  check(
    'equity closing equals balance-sheet equity; the balance sheet balances',
    near(equity?.totals?.closing, balanceSheet?.totals?.equity) &&
      near(balanceSheet?.totals?.difference, 0) &&
      balanceSheet?.isBalanced === true,
    `statement ${equity?.totals?.closing}, balance sheet ${balanceSheet?.totals?.equity}`,
  );

  const cashFlow = (await api(`/reports/cash-flow?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  const sectionNet = (name) =>
    money((cashFlow?.sections ?? []).find((s) => s.cashFlowClass === name)?.net ?? 0);
  check(
    'cash flow: opening 0 + net 148,351 = closing, equal to the cash ledger',
    near(cashFlow?.totals?.opening, 0) &&
      near(cashFlow?.totals?.closing, 148351) &&
      near(cashFlow?.totals?.closing, closingOf(trial, cashCode)),
    `opening ${cashFlow?.totals?.opening}, closing ${cashFlow?.totals?.closing}, ledger ${closingOf(trial, cashCode)}`,
  );
  check(
    'IAS 7 sections: operating 4,951, investing −6,600, financing 150,000, unclassified 0',
    near(sectionNet('operating'), 4951) &&
      near(sectionNet('investing'), -6600) &&
      near(sectionNet('financing'), 150000) &&
      near(sectionNet('unclassified'), 0) &&
      near(
        sectionNet('operating') + sectionNet('investing') + sectionNet('financing') + sectionNet('unclassified'),
        cashFlow?.totals?.net,
      ),
    `operating ${sectionNet('operating')}, investing ${sectionNet('investing')}, financing ${sectionNet('financing')}, unclassified ${sectionNet('unclassified')}`,
  );

  const valuation = (await api('/inventory/reports/valuation')).data;
  check(
    'inventory valuation equals the inventory account (5 units at 100)',
    near(valuation?.totals?.value, 500) && near(valuation?.totals?.difference, 0),
    `valuation ${valuation?.totals?.value}, reported difference ${valuation?.totals?.difference}`,
  );

  // ── 8. the new reports export as real files ────────────────────────────
  // Downloads authenticate with a one-time ticket, the way the browser
  // gets them (see api-check). Server-side PDF needs a browser binary;
  // where the server has none, the printable page is the PDF path, and
  // that is what gets asserted instead of a success that did not happen.
  const ticketed = async (path) => {
    const minted = await api('/auth/download-ticket', { method: 'POST' });
    return `${path}${path.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(minted.data?.ticket ?? '')}`;
  };
  for (const slug of [
    'fixed-assets',
    'depreciation',
    'receivables-reconciliation',
    'payables-reconciliation',
    'cash-flow',
    'equity-changes',
  ]) {
    const file = await api(
      await ticketed(`/exports/${slug}/download?format=xlsx&lang=en&from=${YEAR_FROM}&to=${YEAR_TO}`),
      { binary: true, noAuth: true },
    );
    check(
      `export ${slug} as xlsx produces a real file`,
      file.status === 200 && file.bytes > 200,
      `status ${file.status}, ${file.bytes} bytes, ${file.contentType}`,
    );
  }
  const capabilities = (await api('/exports/capabilities')).data;
  const pdfOffered = (capabilities?.formats ?? []).includes('pdf');
  for (const slug of ['fixed-assets', 'cash-flow']) {
    if (pdfOffered) {
      const file = await api(
        await ticketed(`/exports/${slug}/pdf?lang=en&from=${YEAR_FROM}&to=${YEAR_TO}`),
        { binary: true, noAuth: true },
      );
      check(
        `export ${slug} as a server-made PDF produces a real file`,
        file.status === 200 && file.bytes > 200 && file.contentType.includes('pdf'),
        `status ${file.status}, ${file.bytes} bytes, ${file.contentType}`,
      );
    } else {
      const page = await api(
        await ticketed(`/exports/${slug}/print?lang=en&from=${YEAR_FROM}&to=${YEAR_TO}`),
        { binary: true, noAuth: true },
      );
      check(
        `export ${slug}: no server browser here, so the printable page (the PDF path) answers`,
        page.status === 200 && page.contentType.includes('html') && page.bytes > 200,
        `status ${page.status}, ${page.bytes} bytes, ${page.contentType}`,
      );
    }
  }

  // ── 9. close the year; the next opens on its balances ──────────────────
  const preview = await api(`/accounting/fiscal-periods/${period.id}/closing-preview`);
  check(
    'the closing preview has no blockers',
    preview.status === 200 && (preview.data?.blockers ?? []).length === 0,
    `blockers ${JSON.stringify(preview.data?.blockers ?? [])}`,
  );
  const closed = await must('close the 2024 year', `/accounting/fiscal-periods/${period.id}/close-year`, {
    method: 'POST',
    json: { reason: `Lifecycle scenario ${stamp}` },
  });
  if (!closed) return false;
  const afterClose = await yearTrial();
  check(
    'closing zeroes the result accounts; the 1,150 loss sits in retained earnings',
    near(closingOf(afterClose, '4101'), 0) &&
      near(closingOf(afterClose, '5101'), 0) &&
      near(closingOf(afterClose, '3102'), 1150) &&
      near(closingOf(afterClose, cashCode), 148351) &&
      near(afterClose?.totals?.difference, 0),
    `retained ${closingOf(afterClose, '3102')}, cash ${closingOf(afterClose, cashCode)}`,
  );
  const equityAfter = (await api(`/reports/equity-changes?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  check(
    'the equity statement shows the loss transferred once, closing unchanged',
    near(equityAfter?.result?.transferredToEquity, -1150) &&
      near(equityAfter?.result?.closingUnclosed, 0) &&
      near(equityAfter?.totals?.closing, 148850) &&
      near(equityAfter?.totals?.difference, 0),
    `transferred ${equityAfter?.result?.transferredToEquity}, closing ${equityAfter?.totals?.closing}`,
  );
  const nextYear = await trialBalance('2025-01-01', '2025-01-31');
  check(
    '2025 opens on the 2024 closing balances',
    near(openingOf(nextYear, cashCode), 148351) &&
      near(openingOf(nextYear, '3102'), 1150) &&
      near(openingOf(nextYear, '4101'), 0),
    `cash ${openingOf(nextYear, cashCode)}, retained ${openingOf(nextYear, '3102')}`,
  );

  // ── 10. the closed year is closed — to entries and to depreciation ─────
  const lateEntry = await must('draft an entry dated inside the closed year', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: '2024-05-01',
      description: `Too late ${stamp}`,
      lines: [
        { accountId: cashLedger.id, debit: '10' },
        { accountId: code('4101'), credit: '10' },
      ],
    },
  });
  if (lateEntry) {
    await api(`/accounting/journal-entries/${lateEntry.id}/submit`, { method: 'POST' });
    await api(`/accounting/journal-entries/${lateEntry.id}/approve`, { method: 'POST' });
    await mustRefuse(
      'posting into the closed year is refused',
      `/accounting/journal-entries/${lateEntry.id}/post`,
      { method: 'POST' },
    );
  }
  const lateAsset = await must('register an asset bought inside the closed year', '/fixed-assets', {
    method: 'POST',
    json: {
      code: `FA-L-${stamp}`,
      nameEn: `Late asset ${stamp}`,
      nameAr: `أصل متأخر ${stamp}`,
      purchaseDate: '2024-06-01',
      inServiceDate: '2024-06-01',
      cost: '1000',
      salvageValue: '0',
      usefulLifeMonths: 10,
      assetAccountId: assetLedger.id,
      accumulatedAccountId: accumLedger.id,
      expenseAccountId: deprLedger.id,
    },
  });
  if (lateAsset) {
    await mustRefuse(
      'activating it into the closed year is refused',
      `/fixed-assets/${lateAsset.id}/activate`,
      { method: 'POST', json: { fundingAccountId: cashLedger.id, date: '2024-06-01' } },
    );
  }

  // ── 11. reversal happens in the open present; audit remembers ──────────
  const reversal = await must('reverse the rent entry', `/accounting/journal-entries/${rent.id}/reverse`, {
    method: 'POST',
  });
  const originalAfter = await api(`/accounting/journal-entries/${rent.id}`);
  check(
    'the original is marked reversed and the mirror entry exists',
    Boolean(reversal) && String(originalAfter.data?.status).toUpperCase() === 'REVERSED',
    `original status ${originalAfter.data?.status}`,
  );
  const stillClosed = await yearTrial();
  check(
    'the reversal did not rewrite the closed year',
    near(closingOf(stillClosed, '3102'), 1150) && near(closingOf(stillClosed, cashCode), 148351),
    `retained ${closingOf(stillClosed, '3102')}, cash ${closingOf(stillClosed, cashCode)}`,
  );

  const auditAssets = await api('/admin/audit-logs?entity=fixed_assets&pageSize=50');
  const auditRows = auditAssets.data?.items ?? auditAssets.data?.rows ?? [];
  const auditRuns = await api('/admin/audit-logs?entity=depreciation_runs&pageSize=50');
  const runRows = auditRuns.data?.items ?? auditRuns.data?.rows ?? [];
  check(
    'the audit trail recorded the asset activation, disposal and depreciation runs',
    auditRows.some((r) => r.action === 'ACTIVATE' && r.entityId === machine.id) &&
      auditRows.some((r) => r.action === 'DISPOSE' && r.entityId === machine.id) &&
      runRows.length >= 3,
    `asset entries ${auditRows.length}, run entries ${runRows.length}`,
  );

  // ── 12. a discounted sale in the new year (discount before tax) ────────
  const sale2025 = await must('2025: sell 1 unit at 150 with a 10% document discount', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: '2025-01-05',
      dueDate: '2025-02-04',
      customerId: customer.id,
      discountType: 'PERCENT',
      discountPercent: '10',
      lines: [{ itemId: item.id, quantity: '1', unitPrice: '150' }],
    },
  });
  if (sale2025) {
    await must('post the discounted sale', `/sales/invoices/${sale2025.id}/post`, { method: 'POST' });
    const detail = (await api(`/sales/invoices/${sale2025.id}`)).data;
    check(
      'discount before tax: 150 − 15 = 135 taxable, VAT 18.90, total 153.90, journal linked',
      near(detail?.discountAmount, 15) &&
        near(detail?.taxAmount, 18.9) &&
        near(detail?.totalAmount, 153.9) &&
        Boolean(detail?.journalEntryId),
      `discount ${detail?.discountAmount}, tax ${detail?.taxAmount}, total ${detail?.totalAmount}`,
    );
    const t25 = await trialBalance('2025-01-01', '2025-12-31');
    check(
      'the receivable is the advance −250 plus the discounted total',
      near(closingOf(t25, '1103'), -96.1),
      `receivable ${closingOf(t25, '1103')}`,
    );
    const collect = await must('collect the 153.90', '/cash/vouchers', {
      method: 'POST',
      json: {
        kind: 'RECEIPT',
        voucherDate: '2025-01-06',
        cashAccountId: cashAccount.id,
        customerId: customer.id,
        amount: '153.90',
        allocations: [{ salesInvoiceId: sale2025.id, amount: '153.90' }],
      },
    });
    if (collect) {
      await must('post the collection', `/cash/vouchers/${collect.id}/post`, { method: 'POST' });
    }
    const t25b = await trialBalance('2025-01-01', '2025-12-31');
    check(
      'after collection the receivable is the untouched −250 advance; stock is 4',
      near(closingOf(t25b, '1103'), -250) &&
        near(quantityOf((await api(`/inventory/stock?itemId=${item.id}`)).data, item.id), 4),
      `receivable ${closingOf(t25b, '1103')}`,
    );
  }

  // ── 13. closed year refuses depreciation too; the open year works ──────
  const press = await must('register a press (in service since 2024, capitalised in 2025)', '/fixed-assets', {
    method: 'POST',
    json: {
      code: `FA-P-${stamp}`,
      nameEn: `Lifecycle press ${stamp}`,
      nameAr: `مكبس دورة الحياة ${stamp}`,
      purchaseDate: '2025-01-02',
      inServiceDate: '2024-01-01',
      cost: '1200',
      salvageValue: '0',
      usefulLifeMonths: 12,
      assetAccountId: assetLedger.id,
      accumulatedAccountId: accumLedger.id,
      expenseAccountId: deprLedger.id,
    },
  });
  if (press) {
    await must('activate the press in the open year', `/fixed-assets/${press.id}/activate`, {
      method: 'POST',
      json: { fundingAccountId: cashLedger.id, date: '2025-01-02' },
    });
    await mustRefuse(
      'depreciating June 2024 (inside the closed year) is refused',
      '/fixed-assets/depreciation-runs',
      { method: 'POST', json: { period: '2024-06', assetIds: [press.id] } },
    );
    await must('depreciating January 2025 works', '/fixed-assets/depreciation-runs', {
      method: 'POST',
      json: { period: '2025-01', assetIds: [press.id] },
    });
    const pressAfter = (await api(`/fixed-assets/${press.id}`)).data;
    check(
      'exactly one month was charged — the refused closed-year run left nothing',
      near(pressAfter?.accumulatedDepreciation, 100),
      `accumulated ${pressAfter?.accumulatedDepreciation}`,
    );
    await mustRefuse('deleting an asset that has postings is refused', `/fixed-assets/${press.id}`, {
      method: 'DELETE',
    });
  }

  // ── 14. invalid input leaves no trace ──────────────────────────────────
  const arBefore = closingOf(await trialBalance('2025-01-01', '2025-12-31'), '1103');
  await mustRefuse('a sales invoice with no lines is refused', '/sales/invoices', {
    method: 'POST',
    json: { invoiceDate: '2025-01-10', customerId: customer.id, lines: [] },
  });
  await mustRefuse('a line with zero quantity is refused', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: '2025-01-10',
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '0', unitPrice: '150' }],
    },
  });
  await mustRefuse('a line with a negative quantity is refused', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: '2025-01-10',
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '-1', unitPrice: '150' }],
    },
  });
  await mustRefuse('a voucher with a negative amount is refused', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: '2025-01-10',
      cashAccountId: cashAccount.id,
      customerId: customer.id,
      amount: '-100',
      allocations: [],
    },
  });
  if (sale2025) {
    const over = await must('draft a collection of 999 against the settled 153.90 invoice', '/cash/vouchers', {
      method: 'POST',
      json: {
        kind: 'RECEIPT',
        voucherDate: '2025-01-10',
        cashAccountId: cashAccount.id,
        customerId: customer.id,
        amount: '999',
        allocations: [{ salesInvoiceId: sale2025.id, amount: '999' }],
      },
    });
    if (over) {
      await mustRefuse(
        'collecting more than the invoice has left is refused at posting',
        `/cash/vouchers/${over.id}/post`,
        { method: 'POST' },
      );
    }
  }
  const afterInvalid = await trialBalance('2025-01-01', '2025-12-31');
  check(
    'none of the refused input changed the books',
    near(closingOf(afterInvalid, '1103'), arBefore) && near(afterInvalid?.totals?.difference, 0),
    `receivable before ${arBefore}, after ${closingOf(afterInvalid, '1103')}`,
  );

  // ── 15. what was saved can be read back; aging agrees with the ledger ──
  const supplierBack = (await api(`/parties/suppliers/${supplier.id}`)).data;
  const itemBack = (await api(`/inventory/items/${item.id}`)).data;
  check(
    'the supplier and the item read back exactly as saved',
    supplierBack?.code === `REC-S-${stamp}` && itemBack?.code === `REC-I-${stamp}`,
    `supplier ${supplierBack?.code}, item ${itemBack?.code}`,
  );
  const aging = (await api(`/reports/payables-aging?asOf=${today}`)).data;
  const agingParties = aging?.parties ?? aging?.rows ?? [];
  const supplierAging = agingParties.find((row) => row.partyId === supplier.id);
  check(
    'the supplier owes nothing in aging either (settled; the debit note reduced the debt)',
    supplierAging === undefined || near(supplierAging?.total, 0),
    `aging total ${supplierAging?.total ?? 'no open row'}`,
  );

  // ── 16. the whole company, backed up and put back ──────────────────────
  const backup = (await api('/backup/download')).data;
  check(
    'the company backup carries the fixed-asset and depreciation tables',
    Array.isArray(backup?.tables?.fixedAsset) &&
      backup.tables.fixedAsset.length >= 4 &&
      Array.isArray(backup?.tables?.assetDepreciation) &&
      backup.tables.assetDepreciation.length >= 14 &&
      Array.isArray(backup?.tables?.account),
    `assets ${backup?.tables?.fixedAsset?.length}, depreciation rows ${backup?.tables?.assetDepreciation?.length}`,
  );
  if (backup?.tables) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(backup)], { type: 'application/json' }),
      'kayan-backup.json',
    );
    const restoredResponse = await fetch(`${API}/backup/restore?replace=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    check(
      'restoring the backup over the same (isolated CI) company succeeds',
      restoredResponse.status < 300,
      `status ${restoredResponse.status}`,
    );
    // A restore replaces identity tables; sign in afresh before reading.
    const relogin = await api('/auth/login', {
      method: 'POST',
      json: { username: USERNAME, password: PASSWORD },
      noAuth: true,
    });
    if (relogin.data?.accessToken) token = relogin.data.accessToken;
    const restoredTrial = await yearTrial();
    check(
      'after restore, the books are the same books (2024 cash 148,351; loss 1,150 in retained)',
      near(closingOf(restoredTrial, cashCode), 148351) &&
        near(closingOf(restoredTrial, '3102'), 1150) &&
        near(restoredTrial?.totals?.difference, 0),
      `cash ${closingOf(restoredTrial, cashCode)}, retained ${closingOf(restoredTrial, '3102')}`,
    );
    const restoredRegister = (await api('/fixed-assets/reports/summary')).data;
    check(
      'after restore, the register still ties to the ledger (tool + press)',
      near(restoredRegister?.totals?.cost, 2400) &&
        near(restoredRegister?.totals?.accumulatedDepreciation, 1100) &&
        (restoredRegister?.assetAccounts ?? []).every((r) => near(r.difference, 0)) &&
        (restoredRegister?.accumulatedAccounts ?? []).every((r) => near(r.difference, 0)),
      `cost ${restoredRegister?.totals?.cost}, accumulated ${restoredRegister?.totals?.accumulatedDepreciation}`,
    );
  }

  const failed = results.filter((row) => !row.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      (failed.length ? `\nFAILED:\n  - ${failed.map((row) => `${row.name} (${row.detail})`).join('\n  - ')}` : ''),
  );
  return failed.length === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error('\nThe scenario stopped with an unexpected error:');
    console.error(error);
    process.exit(2);
  });
