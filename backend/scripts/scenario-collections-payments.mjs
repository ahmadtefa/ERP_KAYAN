#!/usr/bin/env node
/**
 * End-to-end integration of customer collections and supplier payments.
 *
 * A collection is not "a receipt was created". It is a chain:
 *
 *   invoice -> receipt/payment -> allocation rows -> invoice paid amount
 *           -> customer/supplier balance -> cash or bank balance
 *           -> journal entry -> ledger lines -> trial balance
 *
 * This scenario walks that chain for every case the product has to survive:
 * a part payment, the rest, one receipt across several invoices, money on
 * account, a reversal, and every refusal the server is supposed to make
 * (too much, zero, negative, a reversed invoice, a draft invoice, an invoice
 * that belongs to someone else, another currency, a second posting).
 *
 * Every figure is checked twice where it exists twice: once through the API
 * the screen uses, and once in SQL, so a report that agrees with itself but
 * not with the ledger is still a failure. Nothing is trusted because it
 * returned 201.
 *
 * Run only against disposable PostgreSQL:
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... DATABASE_URL=postgresql://... \
 *     node backend/scripts/scenario-collections-payments.mjs [apiBaseUrl]
 */
import pg from 'pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required; this scenario must use disposable PostgreSQL.');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);
const from = '2000-01-01';

const money = (value) => Math.round(Number(value ?? 0) * 10000) / 10000;
/// A DATE column comes back from node-postgres as a Date in local time; the
/// scenario only ever compares calendar days, so the local day is the one.
const isoDate = (value) =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value ?? '').slice(0, 10);
const near = (value, expected, tolerance = 0.0001) => Math.abs(money(value) - money(expected)) <= tolerance;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const bearer = options.token ?? token;
  if (bearer && !options.noAuth) headers.Authorization = `Bearer ${bearer}`;
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
    const seconds = Number(/(\d+)\s*second/.exec(String(data?.detail ?? data?.message ?? ''))?.[1] ?? 5);
    await sleep(Math.min(seconds + 1, 90) * 1000);
  }
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 260)}`);
  return null;
}

/// A request the server has to refuse. 4xx is the expected answer; a 2xx is a
/// defect and is reported as one, with what was returned.
async function refuse(label, path, options = {}) {
  const response = await api(path, options);
  const refused = response.status >= 400 && response.status < 500;
  const message = String(
    response.data?.detail ?? response.data?.message ?? response.data?.error ?? '',
  );
  check(
    label,
    refused,
    `status ${response.status}${message ? ` — ${message.slice(0, 150)}` : ''}`,
  );
  return { ...response, message };
}

async function sql(query, values = []) {
  const result = await pool.query(query, values);
  return result.rows;
}

// ─────────────────────────────────────────────────────────── the ledger
async function trialBalance() {
  const response = await api(`/reports/trial-balance?from=${from}&to=${today}`);
  return response.data;
}
function balanceOf(snapshot, code) {
  const row = (snapshot?.rows ?? []).find((r) => r.code === code);
  return money(row?.closing ?? 0);
}
let baseline = new Map();
const delta = async (code) => money(balanceOf(await trialBalance(), code) - (baseline.get(code) ?? 0));

/// What the documents say the ledger should have moved. Every posted voucher
/// adds to it and every reversal subtracts, so the reconciliation at the end
/// compares the ledger with the business documents rather than with a number
/// typed into the test.
///
/// Signs follow the trial balance: an asset closes debit-positive, a liability
/// closes debit-positive too (so a credit balance is negative).
const model = { receivable: 0, payable: 0, cash: new Map() };
function record(kind, amount, cashLedgerCode, direction = 1, party = 'customer') {
  const moved = money(amount) * direction;
  const incoming = kind === 'RECEIPT';
  // A receipt from a customer and a payment to a supplier are the normal
  // direction; the other two are refunds and move the control account back.
  if (party === 'customer') model.receivable = money(model.receivable + (incoming ? -moved : moved));
  else model.payable = money(model.payable + (incoming ? -moved : moved));
  model.cash.set(cashLedgerCode, money((model.cash.get(cashLedgerCode) ?? 0) + (incoming ? moved : -moved)));
}
function recordInvoice(kind, total) {
  if (kind === 'SALES') model.receivable = money(model.receivable + money(total));
  else model.payable = money(model.payable - money(total));
}

// ─────────────────────────────────────────── the journal, as the database has it
async function journalOfVoucher(voucherId) {
  const entries = await sql(
    `SELECT id, "entryNumber", status, currency, "entryDate", "totalDebit"::text AS debit,
            "totalCredit"::text AS credit, "sourceType", "sourceId", "sourceNumber", "reversalOfId"
       FROM journal_entries
      WHERE "sourceType" = 'CASH_VOUCHER' AND "sourceId" = $1::uuid
      ORDER BY "createdAt"`,
    [voucherId],
  );
  const lines = entries.length
    ? await sql(
        `SELECT l.debit::text AS debit, l.credit::text AS credit, a.code AS "accountCode"
           FROM journal_lines l JOIN accounts a ON a.id = l."accountId"
          WHERE l."journalEntryId" = ANY($1::uuid[]) ORDER BY l."lineNumber"`,
        [entries.map((entry) => entry.id)],
      )
    : [];
  return { entries, lines };
}

const debitOf = (lines, code) =>
  money(lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + Number(line.debit), 0));
const creditOf = (lines, code) =>
  money(lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + Number(line.credit), 0));

/// The accounting of one voucher, checked the way an auditor would: one entry,
/// balanced, in the voucher's currency and date, traceable to the document,
/// and touching exactly the two accounts it is supposed to touch.
async function assertVoucherEntry(label, voucher, expected) {
  const { entries, lines } = await journalOfVoucher(voucher.id);
  if (entries.length !== 1) {
    check(`${label}: exactly one journal entry for the voucher`, false, `${entries.length} entries`);
    return;
  }
  const entry = entries[0];
  check(
    `${label}: one balanced entry dated with the voucher, in ${expected.currency}`,
    near(entry.debit, expected.amount) &&
      near(entry.credit, expected.amount) &&
      entry.currency === expected.currency &&
      isoDate(entry.entryDate) === expected.date,
    `${entry.entryNumber} debit ${entry.debit} credit ${entry.credit} ${entry.currency} ${isoDate(entry.entryDate)}`,
  );
  check(
    `${label}: entry is traceable to the voucher (source type, id and number)`,
    entry.sourceType === 'CASH_VOUCHER' &&
      entry.sourceId === voucher.id &&
      entry.sourceNumber === voucher.voucherNumber,
    `${entry.sourceType}/${String(entry.sourceId).slice(0, 8)}/${entry.sourceNumber}`,
  );
  const isReceipt = expected.kind === 'RECEIPT';
  const cashCode = expected.cashAccountCode;
  const partyCode = expected.partyCode;
  check(
    `${label}: cash side is ${isReceipt ? 'debited' : 'credited'} ${expected.amount} on ${cashCode}`,
    isReceipt ? near(debitOf(lines, cashCode), expected.amount) : near(creditOf(lines, cashCode), expected.amount),
    `debit ${debitOf(lines, cashCode)}, credit ${creditOf(lines, cashCode)} on ${cashCode}`,
  );
  check(
    `${label}: partner side is ${isReceipt ? 'credited' : 'debited'} ${expected.amount} on ${partyCode}`,
    isReceipt ? near(creditOf(lines, partyCode), expected.amount) : near(debitOf(lines, partyCode), expected.amount),
    `debit ${debitOf(lines, partyCode)}, credit ${creditOf(lines, partyCode)} on ${partyCode}`,
  );
  check(
    `${label}: entry balance is ${expected.amount} and no other account was touched`,
    near(entry.debit, expected.amount) &&
      new Set(lines.map((line) => line.accountCode)).size === 2,
    `${lines.length} lines: ${[...new Set(lines.map((line) => line.accountCode))].join(', ')}`,
  );
  return entry;
}

/// A reversal must be a mirror, not a second settlement.
async function assertReversalEntry(label, voucher, originalEntryId, expected) {
  const entries = await sql(
    `SELECT id, "totalDebit"::text AS debit, "reversalOfId", status
       FROM journal_entries
      WHERE "sourceType" = 'CASH_VOUCHER' AND "sourceId" = $1::uuid
      ORDER BY "createdAt"`,
    [voucher.id],
  );
  const reversal = entries.find((entry) => entry.reversalOfId === originalEntryId);
  check(
    `${label}: the reversal is a mirror entry of the original, not a second one`,
    Boolean(reversal) && near(reversal.debit, expected.amount) && entries.length === 2,
    `${entries.length} entries, reversal ${reversal?.id?.slice(0, 8) ?? 'missing'}`,
  );
  return reversal;
}

async function main() {
  console.log(`Collections and payments against ${API}\n`);

  const login = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  check('sign in as the administrator', login.status < 300 && Boolean(token), `status ${login.status}`);
  if (!token) return false;

  const me = await api('/auth/me');
  const principal = me.data?.user ?? me.data ?? {};
  const companyId = principal.companyId;
  const branches = await api('/company/branches');
  const branchId = (branches.data?.items ?? branches.data ?? [])[0]?.id;
  check(
    'the session has a company and a branch',
    Boolean(companyId) && Boolean(branchId),
    `company ${String(companyId).slice(0, 8)}, branch ${String(branchId).slice(0, 8)}`,
  );

  const chart = await api('/accounting/chart-of-accounts');
  const accounts = chart.data?.items ?? [];
  const accountId = (code) => accounts.find((row) => row.code === code)?.id;
  for (const needed of ['1101', '1102', '1103', '2101']) {
    if (!accountId(needed)) {
      check(`the chart of accounts contains account ${needed}`, false, 'missing: is the database seeded?');
      return false;
    }
  }
  const AR = '1103';
  const AP = '2101';
  baseline = new Map((await trialBalance()).rows?.map((row) => [row.code, money(row.closing)]) ?? []);

  // ─────────────────────────────────────────────────────── 1. fixtures
  const item = await must('create a stocked item priced at 100.00', '/inventory/items', {
    method: 'POST',
    json: {
      code: `CP-ITEM-${stamp}`,
      nameEn: `Collections item ${stamp}`,
      nameAr: `صنف التحصيل ${stamp}`,
      unit: 'PCS',
      isStockTracked: true,
      salePrice: '100',
      purchasePrice: '60',
      taxRate: '0',
    },
  });
  if (!item) return false;

  const customerA = await must('create customer A', '/parties/customers', {
    method: 'POST',
    json: { code: `CP-CA-${stamp}`, nameEn: `Alpha ${stamp}`, nameAr: `ألفا ${stamp}`, paymentTermDays: 30 },
  });
  const customerB = await must('create customer B', '/parties/customers', {
    method: 'POST',
    json: { code: `CP-CB-${stamp}`, nameEn: `Beta ${stamp}`, nameAr: `بيتا ${stamp}`, paymentTermDays: 30 },
  });
  const stockSupplier = await must('create the supplier the stock is bought from', '/parties/suppliers', {
    method: 'POST',
    json: { code: `CP-ST-${stamp}`, nameEn: `Stock supplier ${stamp}`, nameAr: `مورد المخزون ${stamp}` },
  });
  const supplierA = await must('create supplier A', '/parties/suppliers', {
    method: 'POST',
    json: { code: `CP-SA-${stamp}`, nameEn: `Supplier Alpha ${stamp}`, nameAr: `مورد ألفا ${stamp}`, paymentTermDays: 30 },
  });
  const supplierB = await must('create supplier B', '/parties/suppliers', {
    method: 'POST',
    json: { code: `CP-SB-${stamp}`, nameEn: `Supplier Beta ${stamp}`, nameAr: `مورد بيتا ${stamp}`, paymentTermDays: 30 },
  });
  if (!customerA || !customerB || !supplierA || !supplierB || !stockSupplier) return false;

  // Selling a stocked item needs stock, and a purchase invoice is how stock
  // arrives. It is deliberately a separate supplier so the payable checks
  // below stay about the invoices they name.
  const stockPurchase = await must('buy 40 units of stock at 60.00', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: stockSupplier.id,
      lines: [{ itemId: item.id, quantity: '40', unitPrice: '60' }],
    },
  });
  if (!stockPurchase) return false;
  const stockPosted = await must('post the stock purchase', `/purchases/invoices/${stockPurchase.id}/post`, {
    method: 'POST',
  });
  check(
    'the stock purchase is posted and the goods are on hand',
    String(stockPosted?.status).toLowerCase() === 'posted',
    `status ${stockPosted?.status}, total ${stockPosted?.totalAmount}`,
  );
  recordInvoice('PURCHASE', 2400);

  const newAccount = async (label, code, name) =>
    must(label, '/accounting/chart-of-accounts', {
      method: 'POST',
      json: {
        code: `1102.CP${stamp}${code}`,
        nameEn: `${name} ${stamp}`,
        nameAr: `${name} ${stamp}`,
        type: 'ASSET',
        parentId: accountId('1102'),
        isPostable: true,
      },
    });
  const bankLedger = await newAccount('open a bank ledger account', 'B', 'Bank');
  const cashLedger = await newAccount('open a cash ledger account', 'C', 'Cash');
  const usdLedger = await newAccount('open a second-currency ledger account', 'U', 'USD box');
  if (!bankLedger || !cashLedger || !usdLedger) return false;

  const bank = await must('open a bank cash account in EGP', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `CP-BANK-${stamp}`,
      nameEn: `Bank ${stamp}`,
      nameAr: `بنك ${stamp}`,
      kind: 'BANK',
      accountId: bankLedger.id,
      currency: 'EGP',
    },
  });
  const cashBox = await must('open a cash box in EGP', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `CP-CASH-${stamp}`,
      nameEn: `Cash ${stamp}`,
      nameAr: `خزينة ${stamp}`,
      kind: 'CASH',
      accountId: cashLedger.id,
      currency: 'EGP',
    },
  });
  const usdBox = await must('open a cash box in USD', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `CP-USD-${stamp}`,
      nameEn: `Dollar box ${stamp}`,
      nameAr: `خزينة دولار ${stamp}`,
      kind: 'CASH',
      accountId: usdLedger.id,
      currency: 'USD',
    },
  });
  if (!bank || !cashBox || !usdBox) return false;

  const invoice = (label, customerId, quantity) =>
    must(label, '/sales/invoices', {
      method: 'POST',
      json: { invoiceDate: today, dueDate: today, customerId, lines: [{ itemId: item.id, quantity, unitPrice: '100' }] },
    });
  const post = (label, path) => must(label, path, { method: 'POST' });

  const salesA1 = await invoice('create invoice A1 for 1,000.00', customerA.id, '10');
  const salesA2 = await invoice('create invoice A2 for 500.00', customerA.id, '5');
  const salesA3 = await invoice('create invoice A3 for 300.00', customerA.id, '3');
  const salesB1 = await invoice('create invoice B1 for customer B, 100.00', customerB.id, '1');
  const salesDraft = await invoice('create a draft invoice for 100.00', customerA.id, '1');
  const salesReversed = await invoice('create an invoice that will be reversed, 200.00', customerA.id, '2');
  if (!salesA1 || !salesA2 || !salesA3 || !salesB1 || !salesDraft || !salesReversed) return false;

  for (const [label, doc] of [
    ['A1', salesA1],
    ['A2', salesA2],
    ['A3', salesA3],
    ['B1', salesB1],
    ['the reversal candidate', salesReversed],
  ]) {
    await post(`post invoice ${label}`, `/sales/invoices/${doc.id}/post`);
  }
  await post('reverse the reversal candidate', `/sales/invoices/${salesReversed.id}/reverse`);
  // Only documents that stay live move the ledger at the end of the run: the
  // pair that was posted and then reversed cancels out. The amounts are read
  // back from the server, so tax or rounding cannot invalidate the model.
  const postedSales = [];
  for (const doc of [salesA1, salesA2, salesA3, salesB1]) {
    const detail = (await api(`/sales/invoices/${doc.id}`)).data;
    if (String(detail?.status).toUpperCase() === 'POSTED') postedSales.push(detail);
  }
  for (const detail of postedSales) recordInvoice('SALES', Number(detail.totalAmount));

  const purchase = (label, supplierId, quantity) =>
    must(label, '/purchases/invoices', {
      method: 'POST',
      json: { invoiceDate: today, supplierId, lines: [{ itemId: item.id, quantity, unitPrice: '60' }] },
    });
  const payA1 = await purchase('create purchase invoice S1 for 600.00', supplierA.id, '10');
  const payA2 = await purchase('create purchase invoice S2 for 240.00', supplierA.id, '4');
  const payA3 = await purchase('create purchase invoice S3 for 120.00', supplierA.id, '2');
  const payB1 = await purchase('create purchase invoice for supplier B, 60.00', supplierB.id, '1');
  const payDraft = await purchase('create a draft purchase invoice for 60.00', supplierA.id, '1');
  const payReversed = await purchase('create a purchase invoice that will be reversed, 120.00', supplierA.id, '2');
  if (!payA1 || !payA2 || !payA3 || !payB1 || !payDraft || !payReversed) return false;
  for (const [label, doc] of [
    ['S1', payA1],
    ['S2', payA2],
    ['S3', payA3],
    ['supplier B', payB1],
    ['the reversal candidate', payReversed],
  ]) {
    await post(`post purchase invoice ${label}`, `/purchases/invoices/${doc.id}/post`);
  }
  await post('reverse the purchase reversal candidate', `/purchases/invoices/${payReversed.id}/reverse`);
  const postedPurchases = [];
  for (const doc of [payA1, payA2, payA3, payB1]) {
    const detail = (await api(`/purchases/invoices/${doc.id}`)).data;
    if (String(detail?.status).toUpperCase() === 'POSTED') postedPurchases.push(detail);
  }
  for (const detail of postedPurchases) recordInvoice('PURCHASE', Number(detail.totalAmount));

  const readInvoice = async (path) => (await api(path)).data;
  for (const [label, path, expected] of [
    ['invoice A1', `/sales/invoices/${salesA1.id}`, 1000],
    ['invoice A2', `/sales/invoices/${salesA2.id}`, 500],
    ['invoice A3', `/sales/invoices/${salesA3.id}`, 300],
    ['purchase S1', `/purchases/invoices/${payA1.id}`, 600],
    ['purchase S2', `/purchases/invoices/${payA2.id}`, 240],
    ['purchase S3', `/purchases/invoices/${payA3.id}`, 120],
  ]) {
    const doc = await readInvoice(path);
    check(
      `${label} is posted for its full value with nothing paid yet`,
      near(doc?.totalAmount, expected) && near(doc?.paidAmount, 0) && String(doc?.status).toUpperCase() === 'POSTED',
      `total ${doc?.totalAmount}, paid ${doc?.paidAmount}, status ${doc?.status}`,
    );
  }
  const reversedSales = await readInvoice(`/sales/invoices/${salesReversed.id}`);
  check(
    'a reversed sales invoice is reported as reversed',
    String(reversedSales?.status).toUpperCase() === 'REVERSED',
    `status ${reversedSales?.status}`,
  );

  // ────────────────────────────────────────── 2. customer: part then full
  const receipt1 = await must('collect 400.00 of invoice A1 into the bank', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId: customerA.id,
      amount: '400',
      description: `Part collection ${stamp}`,
      reference: `PART-${stamp}`,
      allocations: [{ salesInvoiceId: salesA1.id, amount: '400' }],
    },
  });
  if (!receipt1) return false;
  const beforeReceipt1 = { receivable: await delta(AR), bank: await delta(bankLedger.code) };
  const receipt1Posted = await post('post the part collection', `/cash/vouchers/${receipt1.id}/post`);
  record('RECEIPT', 400, bankLedger.code);
  const a1AfterPart = await readInvoice(`/sales/invoices/${salesA1.id}`);
  check(
    'invoice A1 keeps 600.00 outstanding after a 400.00 collection',
    near(a1AfterPart?.paidAmount, 400) && near(a1AfterPart?.balanceDue, 600),
    `paid ${a1AfterPart?.paidAmount}, due ${a1AfterPart?.balanceDue}`,
  );
  const receipt1Journal = await assertVoucherEntry('part collection', receipt1Posted ?? receipt1, {
    kind: 'RECEIPT',
    amount: 400,
    currency: 'EGP',
    date: today,
    cashAccountCode: bankLedger.code,
    partyCode: AR,
  });
  check(
    'the part collection moved exactly 400.00 out of receivables and into the bank',
    near((await delta(AR)) - beforeReceipt1.receivable, -400) &&
      near((await delta(bankLedger.code)) - beforeReceipt1.bank, 400),
    `receivable ${money((await delta(AR)) - beforeReceipt1.receivable)}, bank ${money((await delta(bankLedger.code)) - beforeReceipt1.bank)}`,
  );

  const receipt2 = await must('collect the remaining 600.00 of invoice A1', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId: customerA.id,
      amount: '600',
      allocations: [{ salesInvoiceId: salesA1.id, amount: '600' }],
    },
  });
  if (!receipt2) return false;
  await post('post the final collection', `/cash/vouchers/${receipt2.id}/post`);
  record('RECEIPT', 600, bankLedger.code);
  const a1AfterFull = await readInvoice(`/sales/invoices/${salesA1.id}`);
  check(
    'invoice A1 is fully settled: paid equals its total and nothing is due',
    near(a1AfterFull?.paidAmount, 1000) && near(a1AfterFull?.balanceDue, 0),
    `paid ${a1AfterFull?.paidAmount}, due ${a1AfterFull?.balanceDue}`,
  );
  const openAfterA1 = await api(`/cash/open-invoices/customer/${customerA.id}`);
  check(
    'a fully settled invoice is no longer offered for collection',
    !(openAfterA1.data?.items ?? []).some((row) => row.id === salesA1.id),
    `${(openAfterA1.data?.items ?? []).length} open invoices left`,
  );

  // ───────────────────────────────────────── 3. customer: one receipt, two invoices
  const receipt3 = await must('collect 500.00 spread over invoices A2 and A3', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId: customerA.id,
      amount: '500',
      allocations: [
        { salesInvoiceId: salesA2.id, amount: '300' },
        { salesInvoiceId: salesA3.id, amount: '200' },
      ],
    },
  });
  if (!receipt3) return false;
  await post('post the split collection', `/cash/vouchers/${receipt3.id}/post`);
  record('RECEIPT', 500, bankLedger.code);
  const [a2, a3] = await Promise.all([
    readInvoice(`/sales/invoices/${salesA2.id}`),
    readInvoice(`/sales/invoices/${salesA3.id}`),
  ]);
  const receipt3Detail = await api(`/cash/vouchers/${receipt3.id}`);
  check(
    'the split collection paid each invoice exactly what it was given',
    near(a2?.paidAmount, 300) && near(a2?.balanceDue, 200) && near(a3?.paidAmount, 200) && near(a3?.balanceDue, 100),
    `A2 paid ${a2?.paidAmount}/due ${a2?.balanceDue}, A3 paid ${a3?.paidAmount}/due ${a3?.balanceDue}`,
  );
  check(
    'the voucher lists one allocation per invoice, and they add up to the voucher',
    (receipt3Detail.data?.allocations ?? []).length === 2 &&
      near((receipt3Detail.data?.allocations ?? []).reduce((sum, row) => sum + Number(row.amount), 0), 500) &&
      near(receipt3Detail.data?.amount, 500),
    `${(receipt3Detail.data?.allocations ?? []).length} allocations, voucher ${receipt3Detail.data?.amount}`,
  );
  const allocationRows = await sql(
    `SELECT "salesInvoiceId", amount::text FROM cash_voucher_allocations WHERE "voucherId" = $1::uuid ORDER BY amount DESC`,
    [receipt3.id],
  );
  check(
    'the allocation rows in the database match the two invoices and nothing else',
    allocationRows.length === 2 && near(allocationRows[0].amount, 300) && near(allocationRows[1].amount, 200),
    allocationRows.map((row) => `${String(row.salesInvoiceId).slice(0, 8)}=${row.amount}`).join(', '),
  );
  await assertVoucherEntry('split collection', receipt3Detail.data, {
    kind: 'RECEIPT',
    amount: 500,
    currency: 'EGP',
    date: today,
    cashAccountCode: bankLedger.code,
    partyCode: AR,
  });

  // ───────────────────────────────────────────────── 4. money left on account
  const receipt4 = await must('collect 50.00 with no invoice named', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: cashBox.id,
      customerId: customerA.id,
      amount: '50',
      description: `On account ${stamp}`,
    },
  });
  if (!receipt4) return false;
  const beforeReceipt4 = { receivable: await delta(AR), cash: await delta(cashLedger.code) };
  const receipt4Posted = await post('post the on-account receipt', `/cash/vouchers/${receipt4.id}/post`);
  record('RECEIPT', 50, cashLedger.code);
  await assertVoucherEntry('on-account receipt', receipt4Posted ?? receipt4, {
    kind: 'RECEIPT',
    amount: 50,
    currency: 'EGP',
    date: today,
    cashAccountCode: cashLedger.code,
    partyCode: AR,
  });
  check(
    'money with no invoice named becomes a credit on the customer account, not a lost document',
    near((await delta(AR)) - beforeReceipt4.receivable, -50) &&
      near((await delta(cashLedger.code)) - beforeReceipt4.cash, 50),
    `receivable ${money((await delta(AR)) - beforeReceipt4.receivable)}, cash ${money((await delta(cashLedger.code)) - beforeReceipt4.cash)}`,
  );

  // ──────────────────────────────────── 5. balances: customer A, B and cash/bank
  const summaryA = await api(`/parties/customers/summary/${customerA.id}`);
  const summaryB = await api(`/parties/customers/summary/${customerB.id}`);
  const customerTotalsA = summaryA.data?.totals ?? {};
  check(
    'customer A: invoiced 1,800.00, collected 1,550.00, still owed 300.00 on invoices',
    near(customerTotalsA.invoiced, 1800) &&
      near(customerTotalsA.paid, 1550) &&
      near(customerTotalsA.outstanding, 300),
    `invoiced ${customerTotalsA.invoiced}, paid ${customerTotalsA.paid}, outstanding ${customerTotalsA.outstanding}`,
  );
  check(
    'customer B was not touched by any of customer A collections',
    near(summaryB.data?.totals?.invoiced, 100) &&
      near(summaryB.data?.totals?.paid, 0) &&
      near(summaryB.data?.totals?.outstanding, 100),
    `invoiced ${summaryB.data?.totals?.invoiced}, paid ${summaryB.data?.totals?.paid}, outstanding ${summaryB.data?.totals?.outstanding}`,
  );
  const balancesReport = await api('/reports/customer-balances');
  const reportRowA = (balancesReport.data?.rows ?? balancesReport.data?.items ?? []).find(
    (row) => row.customerId === customerA.id || row.id === customerA.id || row.code === customerA.code,
  );
  check(
    'the customer balance report shows the same 300.00 the summary does',
    near(reportRowA?.balance ?? reportRowA?.outstanding, 300),
    `report row ${JSON.stringify(reportRowA)?.slice(0, 160)}`,
  );
  const statementA = await api(`/parties/customers/statement/${customerA.id}`);
  const closingA = Number(statementA.data?.closingBalance ?? 0);
  check(
    'the customer statement, the summary and the balance report tell one story',
    near(closingA, 250) &&
      near(customerTotalsA.netBalance, closingA) &&
      near(reportRowA?.netBalance, closingA),
    `statement ${closingA}, summary net ${customerTotalsA.netBalance} (outstanding ${customerTotalsA.outstanding} ` +
      `less on-account ${customerTotalsA.onAccount}), report net ${reportRowA?.netBalance}`,
  );
  // A refund goes the other way, and the credit has to shrink rather than grow.
  const beforeRefund = { receivable: await delta(AR), bank: await delta(bankLedger.code) };
  const refund = await must('refund 30.00 of the customer credit from the bank', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId: customerA.id,
      amount: '30',
      description: `Refund ${stamp}`,
    },
  });
  if (refund) {
    const postedRefund = await post('post the refund', `/cash/vouchers/${refund.id}/post`);
    record('PAYMENT', 30, bankLedger.code, 1, 'customer');
    check(
      'a refund to a customer puts 30.00 back on their account and takes it out of the bank',
      near((await delta(AR)) - beforeRefund.receivable, 30) &&
        near((await delta(bankLedger.code)) - beforeRefund.bank, -30),
      `receivable ${money((await delta(AR)) - beforeRefund.receivable)}, bank ${money((await delta(bankLedger.code)) - beforeRefund.bank)}`,
    );
    await assertVoucherEntry('refund', postedRefund ?? refund, {
      kind: 'PAYMENT',
      amount: 30,
      currency: 'EGP',
      date: today,
      cashAccountCode: bankLedger.code,
      partyCode: AR,
    });
    const afterRefund = await api(`/parties/customers/summary/${customerA.id}`);
    const totalsAfterRefund = afterRefund.data?.totals ?? {};
    check(
      'the refund uses up the credit: 20.00 left on account, 280.00 owed',
      near(totalsAfterRefund.onAccount, 20) && near(totalsAfterRefund.netBalance, 280),
      `on account ${totalsAfterRefund.onAccount}, net ${totalsAfterRefund.netBalance}`,
    );
  }

  const cashBalances = await api('/cash/accounts/balances');
  const cashRows = cashBalances.data?.rows ?? cashBalances.data?.accounts ?? [];
  const rowOf = (account) => cashRows.find((row) => row.code === account.code);
  check(
    'the bank and the cash box each hold exactly what was collected into them, less the refund',
    near(rowOf(bank)?.balance, 1470) && near(rowOf(cashBox)?.balance, 50),
    `bank ${rowOf(bank)?.balance}, cash ${rowOf(cashBox)?.balance}`,
  );

  // ───────────────────────────────────────────── 6. supplier: part then rest
  const payment1 = await must('pay 200.00 of purchase invoice S1 from the bank', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: bank.id,
      supplierId: supplierA.id,
      amount: '200',
      description: `Part payment ${stamp}`,
      allocations: [{ purchaseInvoiceId: payA1.id, amount: '200' }],
    },
  });
  if (!payment1) return false;
  const payment1Posted = await post('post the part payment', `/cash/vouchers/${payment1.id}/post`);
  record('PAYMENT', 200, bankLedger.code, 1, 'supplier');
  const s1AfterPart = await readInvoice(`/purchases/invoices/${payA1.id}`);
  check(
    'purchase invoice S1 keeps 400.00 unpaid after a 200.00 payment',
    near(s1AfterPart?.paidAmount, 200) && near(s1AfterPart?.balanceDue, 400),
    `paid ${s1AfterPart?.paidAmount}, due ${s1AfterPart?.balanceDue}`,
  );
  await assertVoucherEntry('part payment', payment1Posted ?? payment1, {
    kind: 'PAYMENT',
    amount: 200,
    currency: 'EGP',
    date: today,
    cashAccountCode: bankLedger.code,
    partyCode: AP,
  });

  const payment2 = await must('pay the remaining 400.00 of purchase invoice S1', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: bank.id,
      supplierId: supplierA.id,
      amount: '400',
      allocations: [{ purchaseInvoiceId: payA1.id, amount: '400' }],
    },
  });
  if (!payment2) return false;
  await post('post the final payment voucher', `/cash/vouchers/${payment2.id}/post`);
  record('PAYMENT', 400, bankLedger.code, 1, 'supplier');
  const s1AfterFull = await readInvoice(`/purchases/invoices/${payA1.id}`);
  check(
    'purchase invoice S1 is fully paid: paid equals its total and nothing is due',
    near(s1AfterFull?.paidAmount, 600) && near(s1AfterFull?.balanceDue, 0),
    `paid ${s1AfterFull?.paidAmount}, due ${s1AfterFull?.balanceDue}`,
  );

  // ───────────────────────────────────── 7. supplier: one payment, two invoices
  const payment3 = await must('pay 360.00 spread over purchase invoices S2 and S3', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: cashBox.id,
      supplierId: supplierA.id,
      amount: '360',
      allocations: [
        { purchaseInvoiceId: payA2.id, amount: '240' },
        { purchaseInvoiceId: payA3.id, amount: '120' },
      ],
    },
  });
  if (!payment3) return false;
  await post('post the split payment', `/cash/vouchers/${payment3.id}/post`);
  record('PAYMENT', 360, cashLedger.code, 1, 'supplier');
  const [s2, s3] = await Promise.all([
    readInvoice(`/purchases/invoices/${payA2.id}`),
    readInvoice(`/purchases/invoices/${payA3.id}`),
  ]);
  check(
    'the split payment settled both purchase invoices completely',
    near(s2?.paidAmount, 240) && near(s2?.balanceDue, 0) && near(s3?.paidAmount, 120) && near(s3?.balanceDue, 0),
    `S2 paid ${s2?.paidAmount}/due ${s2?.balanceDue}, S3 paid ${s3?.paidAmount}/due ${s3?.balanceDue}`,
  );
  await assertVoucherEntry('split payment', (await api(`/cash/vouchers/${payment3.id}`)).data, {
    kind: 'PAYMENT',
    amount: 360,
    currency: 'EGP',
    date: today,
    cashAccountCode: cashLedger.code,
    partyCode: AP,
  });

  // Money paid to a supplier before there is an invoice is a prepayment, not a
  // lost document: it belongs on their account and must reconcile the same way
  // an on-account receipt does.
  const prepayment = await must('pay supplier A 40.00 with no invoice named', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: bank.id,
      supplierId: supplierA.id,
      amount: '40',
      description: `Prepayment ${stamp}`,
    },
  });
  if (prepayment) {
    await post('post the prepayment', `/cash/vouchers/${prepayment.id}/post`);
    record('PAYMENT', 40, bankLedger.code, 1, 'supplier');
    await assertVoucherEntry('prepayment', (await api(`/cash/vouchers/${prepayment.id}`)).data, {
      kind: 'PAYMENT',
      amount: 40,
      currency: 'EGP',
      date: today,
      cashAccountCode: bankLedger.code,
      partyCode: AP,
    });
  }

  const summarySupplierA = await api(`/parties/suppliers/summary/${supplierA.id}`);
  const summarySupplierB = await api(`/parties/suppliers/summary/${supplierB.id}`);
  const supplierTotalsA = summarySupplierA.data?.totals ?? {};
  check(
    'supplier A: invoiced 960.00, paid 1,000.00, nothing outstanding and a 40.00 prepayment',
    near(supplierTotalsA.invoiced, 960) &&
      near(supplierTotalsA.paid, 1000) &&
      near(supplierTotalsA.outstanding, 0) &&
      near(supplierTotalsA.onAccount, 40),
    `invoiced ${supplierTotalsA.invoiced}, paid ${supplierTotalsA.paid}, outstanding ${supplierTotalsA.outstanding}, on account ${supplierTotalsA.onAccount}`,
  );
  check(
    'supplier B was not touched by any payment meant for supplier A',
    near(summarySupplierB.data?.totals?.outstanding, 60) && near(summarySupplierB.data?.totals?.paid, 0),
    `outstanding ${summarySupplierB.data?.totals?.outstanding}, paid ${summarySupplierB.data?.totals?.paid}`,
  );
  const supplierBalances = await api('/reports/supplier-balances');
  const supplierRowB = (supplierBalances.data?.rows ?? supplierBalances.data?.items ?? []).find(
    (row) => row.supplierId === supplierB.id || row.id === supplierB.id || row.code === supplierB.code,
  );
  check(
    'the supplier balance report shows supplier B is still owed 60.00',
    near(supplierRowB?.balance ?? supplierRowB?.outstanding, 60),
    `report row ${JSON.stringify(supplierRowB)?.slice(0, 160)}`,
  );
  const supplierRowA = (supplierBalances.data?.rows ?? supplierBalances.data?.items ?? []).find(
    (row) => row.supplierId === supplierA.id,
  );
  const supplierStatementA = await api(`/parties/suppliers/statement/${supplierA.id}`);
  const closingSupplierA = Number(supplierStatementA.data?.closingBalance ?? 0);
  // The supplier statement is debit-positive (a negative closing means we owe
  // them), the summary and the report are liability-positive. They must be the
  // same figure with opposite signs, not two different figures.
  check(
    'the supplier statement, the summary and the report agree on the 40.00 prepayment',
    near(closingSupplierA, 40) &&
      near(supplierTotalsA.netBalance, -closingSupplierA) &&
      near(supplierRowA?.netBalance, supplierTotalsA.netBalance),
    `statement ${closingSupplierA}, summary net ${supplierTotalsA.netBalance}, report net ${supplierRowA?.netBalance}`,
  );

  // The mirror image: money back from a supplier uses up the prepayment.
  const supplierBeforeRefund = { payable: await delta(AP), bank: await delta(bankLedger.code) };
  const supplierRefund = await must('receive 10.00 back from supplier A', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      supplierId: supplierA.id,
      amount: '10',
      description: `Supplier refund ${stamp}`,
    },
  });
  if (supplierRefund) {
    await post('post the supplier refund', `/cash/vouchers/${supplierRefund.id}/post`);
    record('RECEIPT', 10, bankLedger.code, 1, 'supplier');
    check(
      'money back from a supplier increases what we owe and lands in the bank',
      near((await delta(AP)) - supplierBeforeRefund.payable, -10) &&
        near((await delta(bankLedger.code)) - supplierBeforeRefund.bank, 10),
      `payable ${money((await delta(AP)) - supplierBeforeRefund.payable)}, bank ${money((await delta(bankLedger.code)) - supplierBeforeRefund.bank)}`,
    );
    const afterSupplierRefund = await api(`/parties/suppliers/summary/${supplierA.id}`);
    check(
      'the supplier refund reduces the prepayment from 40.00 to 30.00',
      near(afterSupplierRefund.data?.totals?.onAccount, 30),
      `on account ${afterSupplierRefund.data?.totals?.onAccount}, net ${afterSupplierRefund.data?.totals?.netBalance}`,
    );
  }

  // ───────────────────────────────────────────── 8. every refusal, both sides
  const receiptOf = (customerId, amount, allocations, extra = {}) => ({
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId,
      amount,
      ...(allocations ? { allocations } : {}),
      ...extra,
    },
  });
  const paymentOf = (supplierId, amount, allocations, extra = {}) => ({
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: bank.id,
      supplierId,
      amount,
      ...(allocations ? { allocations } : {}),
      ...extra,
    },
  });

  const overpay = await refuse(
    'a collection larger than what the invoice still owes is refused',
    '/cash/vouchers',
    receiptOf(customerA.id, '201', [{ salesInvoiceId: salesA2.id, amount: '201' }]),
  );
  check(
    'the refusal names the invoice and what is left on it',
    /200\.0000|left to pay|only/i.test(overpay.message),
    overpay.message.slice(0, 140),
  );
  await refuse('a zero collection is refused', '/cash/vouchers', receiptOf(customerA.id, '0'));
  await refuse('a negative collection is refused', '/cash/vouchers', receiptOf(customerA.id, '-100'));
  await refuse(
    'a collection against an invoice that belongs to another customer is refused',
    '/cash/vouchers',
    receiptOf(customerA.id, '100', [{ salesInvoiceId: salesB1.id, amount: '100' }]),
  );
  await refuse(
    'a collection against a reversed invoice is refused',
    '/cash/vouchers',
    receiptOf(customerA.id, '100', [{ salesInvoiceId: salesReversed.id, amount: '100' }]),
  );
  await refuse(
    'a collection against a fully paid invoice is refused',
    '/cash/vouchers',
    receiptOf(customerA.id, '100', [{ salesInvoiceId: salesA1.id, amount: '100' }]),
  );
  await refuse(
    'a collection in a different currency than the invoice is refused',
    '/cash/vouchers',
    receiptOf(customerA.id, '100', [{ salesInvoiceId: salesA2.id, amount: '100' }], {
      cashAccountId: usdBox.id,
    }),
  );
  const missingCustomer = '00000000-0000-4000-8000-00000000dead';
  await refuse('a collection for a customer that does not exist is refused', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId: missingCustomer,
      amount: '10',
    },
  });
  await refuse(
    'a payment for an invoice of another supplier is refused',
    '/cash/vouchers',
    paymentOf(supplierA.id, '10', [{ purchaseInvoiceId: payB1.id, amount: '10' }]),
  );
  await refuse(
    'a payment against a reversed purchase invoice is refused',
    '/cash/vouchers',
    paymentOf(supplierA.id, '10', [{ purchaseInvoiceId: payReversed.id, amount: '10' }]),
  );
  await refuse(
    'a payment against a fully paid purchase invoice is refused',
    '/cash/vouchers',
    paymentOf(supplierA.id, '10', [{ purchaseInvoiceId: payA1.id, amount: '10' }]),
  );
  await refuse(
    'a payment larger than the purchase invoice still owes is refused',
    '/cash/vouchers',
    paymentOf(supplierA.id, '500', [{ purchaseInvoiceId: payA2.id, amount: '500' }]),
  );
  await refuse('a zero payment is refused', '/cash/vouchers', paymentOf(supplierA.id, '0'));
  await refuse('a negative payment is refused', '/cash/vouchers', paymentOf(supplierA.id, '-50'));

  // A draft invoice may be named, but it cannot be settled until it is posted:
  // the create is allowed on purpose (the invoice can be posted first), the
  // posting of the voucher is what refuses.
  const draftReceipt = await must(
    'a draft invoice may be named on a receipt that is still a draft',
    '/cash/vouchers',
    receiptOf(customerA.id, '100', [{ salesInvoiceId: salesDraft.id, amount: '100' }]),
  );
  if (draftReceipt) {
    const draftPost = await refuse(
      'posting a collection that settles an unposted invoice is refused',
      `/cash/vouchers/${draftReceipt.id}/post`,
      { method: 'POST' },
    );
    check(
      'the draft invoice refusal says the invoice is not posted',
      /not posted/i.test(draftPost.message),
      draftPost.message.slice(0, 140),
    );
    const stillDraft = await api(`/sales/invoices/${salesDraft.id}`);
    check(
      'the refused posting changed nothing: the invoice is still unpaid and the voucher still a draft',
      near(stillDraft.data?.paidAmount, 0) &&
        String((await api(`/cash/vouchers/${draftReceipt.id}`)).data?.status).toLowerCase() === 'draft',
      `invoice paid ${stillDraft.data?.paidAmount}`,
    );
    const orphan = await journalOfVoucher(draftReceipt.id);
    check('the refused posting wrote no journal entry at all', orphan.entries.length === 0, `${orphan.entries.length} entries`);
  }

  // ────────────────────────────────────────── 9. reversing a collection
  const beforeReversal = { receivable: await delta(AR), bank: await delta(bankLedger.code) };
  const beforeReversalInvoice = await readInvoice(`/sales/invoices/${salesA1.id}`);
  const reversed = await post('reverse the first collection', `/cash/vouchers/${receipt1.id}/reverse`, {
    method: 'POST',
    json: { reason: `Reversed by ${stamp}` },
  });
  record('RECEIPT', 400, bankLedger.code, -1);
  const afterReversalInvoice = await readInvoice(`/sales/invoices/${salesA1.id}`);
  check(
    'reversing the collection puts the 400.00 back on invoice A1',
    near(beforeReversalInvoice?.paidAmount, 1000) &&
      near(afterReversalInvoice?.paidAmount, 600) &&
      near(afterReversalInvoice?.balanceDue, 400),
    `paid ${beforeReversalInvoice?.paidAmount} -> ${afterReversalInvoice?.paidAmount}`,
  );
  check(
    'the reversed collection is reported as reversed',
    String(reversed?.status).toLowerCase() === 'reversed' ||
      String((await api(`/cash/vouchers/${receipt1.id}`)).data?.status).toLowerCase() === 'reversed',
    `status ${reversed?.status}`,
  );
  await assertReversalEntry('collection reversal', receipt1, receipt1Journal?.id, { amount: 400 });
  check(
    'the reversal moved the same 400.00 back into receivables and out of the bank',
    near((await delta(AR)) - beforeReversal.receivable, 400) &&
      near((await delta(bankLedger.code)) - beforeReversal.bank, -400),
    `receivable ${money((await delta(AR)) - beforeReversal.receivable)}, bank ${money((await delta(bankLedger.code)) - beforeReversal.bank)}`,
  );
  await refuse('the same collection cannot be reversed twice', `/cash/vouchers/${receipt1.id}/reverse`, {
    method: 'POST',
    json: {},
  });
  await refuse('a reversed collection cannot be posted again', `/cash/vouchers/${receipt1.id}/post`, {
    method: 'POST',
  });
  await refuse('the same collection cannot be posted a second time', `/cash/vouchers/${receipt3.id}/post`, {
    method: 'POST',
  });

  // Re-collect what the reversal reopened: the invoice is payable again.
  const recollection = await must('collect the 400.00 the reversal reopened', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: bank.id,
      customerId: customerA.id,
      amount: '400',
      allocations: [{ salesInvoiceId: salesA1.id, amount: '400' }],
    },
  });
  if (recollection) {
    await post('post the re-collection', `/cash/vouchers/${recollection.id}/post`);
    record('RECEIPT', 400, bankLedger.code);
    const recollected = await readInvoice(`/sales/invoices/${salesA1.id}`);
    check(
      'the reopened invoice can be collected again and ends fully settled',
      near(recollected?.paidAmount, 1000) && near(recollected?.balanceDue, 0),
      `paid ${recollected?.paidAmount}, due ${recollected?.balanceDue}`,
    );
  }

  // A posting attempt made twice for the *same* voucher is covered above. Two
  // separate identical documents are a different question: the server has no
  // idempotency key, so the second one is a second document. It must still not
  // be able to overpay an invoice, and it must stay on the customer account.
  const duplicateAttempt = await refuse(
    'a copy of a settled collection cannot take the same money off the invoice again',
    '/cash/vouchers',
    receiptOf(customerA.id, '500', [{ salesInvoiceId: salesA2.id, amount: '300' }]),
  );
  check(
    'the duplicate is refused because the invoice is already paid to the allocation limit',
    /left to pay|only|200/i.test(duplicateAttempt.message),
    duplicateAttempt.message.slice(0, 140),
  );

  // ────────────────────────────────────────── 10. reversing a payment
  const paymentJournal = (await journalOfVoucher(payment2.id)).entries[0];
  const reversedPayment = await post('reverse the final payment', `/cash/vouchers/${payment2.id}/reverse`, {
    method: 'POST',
    json: { reason: `Returned by ${stamp}` },
  });
  record('PAYMENT', 400, bankLedger.code, -1, 'supplier');
  const s1AfterReversal = await readInvoice(`/purchases/invoices/${payA1.id}`);
  check(
    'reversing the payment gives the 400.00 back to the payable',
    near(s1AfterReversal?.paidAmount, 200) && near(s1AfterReversal?.balanceDue, 400),
    `paid ${s1AfterReversal?.paidAmount}, due ${s1AfterReversal?.balanceDue}`,
  );
  check(
    'the reversed payment is reported as reversed',
    String(reversedPayment?.status).toLowerCase() === 'reversed' ||
      String((await api(`/cash/vouchers/${payment2.id}`)).data?.status).toLowerCase() === 'reversed',
    `status ${reversedPayment?.status}`,
  );
  await assertReversalEntry('payment reversal', payment2, paymentJournal?.id, { amount: 400 });
  await refuse('a reversed payment cannot be posted again', `/cash/vouchers/${payment2.id}/post`, {
    method: 'POST',
  });

  // ─────────────────────────────────────────── 11. permissions, not the admin
  const roleFor = async (label, code, permissions) =>
    must(label, '/admin/roles', {
      method: 'POST',
      json: {
        code: `${code}-${stamp}`,
        nameEn: `${code} ${stamp}`,
        nameAr: `${code} ${stamp}`,
        permissions,
      },
    });
  const collectorRole = await roleFor('create a collector role without the right to post', 'COLLECTOR', [
    'cash.vouchers.read',
    'cash.vouchers.create',
    'cash.accounts.read',
    'parties.customers.read',
  ]);
  const posterRole = await roleFor('create a poster role with the right to post', 'POSTER', [
    'cash.vouchers.read',
    'cash.vouchers.create',
    'cash.vouchers.post',
    'cash.accounts.read',
    'parties.customers.read',
    'accounting.journal.read',
  ]);
  const viewerRole = await roleFor('create a read-only cash role', 'VIEWER', [
    'cash.vouchers.read',
    'cash.accounts.read',
  ]);
  if (!collectorRole || !posterRole || !viewerRole) return false;

  const makeUser = async (label, username, roleIds) =>
    must(label, '/admin/users', {
      method: 'POST',
      json: {
        username,
        fullNameEn: username,
        fullNameAr: username,
        password: `Temp-${stamp}-Password1`,
        roleIds,
        branchIds: [branchId],
      },
    });
  const collector = await makeUser('create a collector user', `collector-${stamp}`, [collectorRole.id]);
  const poster = await makeUser('create a poster user', `poster-${stamp}`, [posterRole.id]);
  const viewer = await makeUser('create a viewer user', `viewer-${stamp}`, [viewerRole.id]);
  if (!collector || !poster || !viewer) return false;

  const signInAs = async (username) => {
    const response = await api('/auth/login', {
      method: 'POST',
      json: { username, password: `Temp-${stamp}-Password1` },
      noAuth: true,
    });
    return response.data?.accessToken ?? '';
  };
  const collectorToken = await signInAs(`collector-${stamp}`);
  const posterToken = await signInAs(`poster-${stamp}`);
  const viewerToken = await signInAs(`viewer-${stamp}`);
  check(
    'the three non-administrator users can sign in',
    Boolean(collectorToken) && Boolean(posterToken) && Boolean(viewerToken),
    `${collectorToken ? 'collector ' : ''}${posterToken ? 'poster ' : ''}${viewerToken ? 'viewer' : ''}`.trim(),
  );

  const collectorSession = await api('/auth/me', { token: collectorToken });
  check(
    'the collector session carries only the permissions of its role',
    (collectorSession.data?.user ?? collectorSession.data ?? {}).permissions?.includes('cash.vouchers.create') &&
      !(collectorSession.data?.user ?? collectorSession.data ?? {}).permissions?.includes('cash.vouchers.post'),
    `${((collectorSession.data?.user ?? collectorSession.data ?? {}).permissions ?? []).length} permissions`,
  );
  const collectorCreates = await api('/cash/vouchers', {
    token: collectorToken,
    ...receiptOf(customerA.id, '25'),
  });
  check(
    'a user with cash.vouchers.create but not cash.vouchers.post can write a draft receipt',
    collectorCreates.status < 300,
    `status ${collectorCreates.status}`,
  );
  if (collectorCreates.status < 300) {
    const collectorPosts = await api(`/cash/vouchers/${collectorCreates.data.id}/post`, {
      token: collectorToken,
      method: 'POST',
    });
    check(
      'the same user is refused the posting of their own draft',
      collectorPosts.status === 403,
      `status ${collectorPosts.status}`,
    );
    const posterPosts = await api(`/cash/vouchers/${collectorCreates.data.id}/post`, {
      token: posterToken,
      method: 'POST',
    });
    check(
      'a different user who does hold cash.vouchers.post can post it',
      posterPosts.status < 300,
      `status ${posterPosts.status}`,
    );
    if (posterPosts.status < 300) record('RECEIPT', 25, bankLedger.code);
    const posterReverses = await api(`/cash/vouchers/${collectorCreates.data.id}/reverse`, {
      token: posterToken,
      method: 'POST',
      json: {},
    });
    if (posterReverses.status < 300) record('RECEIPT', 25, bankLedger.code, -1);
  }
  const collectorJournal = await api(`/accounting/journal-entries/${receipt3Detail.data?.journalEntryId ?? 'x'}`, {
    token: collectorToken,
  });
  check(
    'a user without accounting.journal.read cannot open the journal entry of a collection',
    collectorJournal.status === 403,
    `status ${collectorJournal.status}`,
  );
  const posterJournal = await api(`/accounting/journal-entries/${receipt3Detail.data?.journalEntryId ?? 'x'}`, {
    token: posterToken,
  });
  check(
    'a user with accounting.journal.read can open the same entry',
    posterJournal.status === 200 &&
      (posterJournal.data?.lines ?? []).some((line) => line.accountCode === AR),
    `status ${posterJournal.status}, ${(posterJournal.data?.lines ?? []).length} lines`,
  );
  const viewerCreates = await api('/cash/vouchers', {
    token: viewerToken,
    ...receiptOf(customerA.id, '25'),
  });
  check(
    'a read-only user cannot create a receipt at all',
    viewerCreates.status === 403,
    `status ${viewerCreates.status}`,
  );
  const viewerLists = await api('/cash/vouchers?pageSize=5', { token: viewerToken });
  check(
    'the read-only user can still list receipts',
    viewerLists.status === 200,
    `status ${viewerLists.status}`,
  );

  // ─────────────────────────── 12. traceability, one hop at a time
  const traceVoucher = (await api(`/cash/vouchers/${receipt3.id}`)).data;
  const traceJournal = await api(`/accounting/journal-entries/${traceVoucher.journalEntryId}`);
  const traceInvoice = await readInvoice(`/sales/invoices/${salesA2.id}`);
  const traceInvoiceJournal = await api(`/accounting/journal-entries/${traceInvoice.journalEntryId}`);
  check(
    'collection -> invoice -> journal entry can be walked in both directions',
    Boolean(traceVoucher.journalEntryId) &&
      traceJournal.status === 200 &&
      traceInvoiceJournal.status === 200 &&
      (traceInvoiceJournal.data?.lines ?? []).some((line) => line.accountCode === AR),
    `voucher ${traceVoucher.voucherNumber} -> entry ${traceJournal.data?.entryNumber}, invoice ${traceInvoice.invoiceNumber} -> entry ${traceInvoiceJournal.data?.entryNumber}`,
  );
  const traceRows = await sql(
    `SELECT j."sourceType", j."sourceId"::text AS "sourceId", j."sourceNumber", v."voucherNumber", v."customerId"::text AS "customerId"
       FROM cash_vouchers v JOIN journal_entries j ON j.id = v."journalEntryId"
      WHERE v.id = $1::uuid`,
    [receipt3.id],
  );
  check(
    'the database ties the entry to the document, the document to the customer',
    traceRows.length === 1 &&
      traceRows[0].sourceType === 'CASH_VOUCHER' &&
      traceRows[0].sourceId === receipt3.id &&
      traceRows[0].sourceNumber === traceRows[0].voucherNumber &&
      traceRows[0].customerId === customerA.id,
    `${traceRows[0]?.sourceType} ${traceRows[0]?.sourceNumber} customer ${String(traceRows[0]?.customerId).slice(0, 8)}`,
  );
  const invoiceSource = await sql(
    `SELECT "sourceType", "sourceId"::text AS "sourceId", "sourceNumber" FROM journal_entries WHERE id = $1::uuid`,
    [traceInvoice.journalEntryId],
  );
  check(
    'the invoice journal is traceable back to the invoice itself',
    invoiceSource.length === 1 &&
      invoiceSource[0].sourceType === 'SALES_INVOICE' &&
      invoiceSource[0].sourceId === salesA2.id,
    `${invoiceSource[0]?.sourceType} ${invoiceSource[0]?.sourceNumber}`,
  );

  // ─────────────────────────── 13. no duplicate and no stray entries
  const duplicateEntries = await sql(
    `SELECT j."sourceId"::text AS id, count(*)::int AS entries, v.status AS "voucherStatus",
            max(CASE WHEN j."reversalOfId" IS NULL THEN 1 ELSE 0 END)::int AS originals
       FROM journal_entries j JOIN cash_vouchers v ON v.id = j."sourceId"
      WHERE j."sourceType" = 'CASH_VOUCHER'
      GROUP BY j."sourceId", v.status HAVING count(*) > 1`,
  );
  check(
    'a second entry exists only for a reversed voucher, and it is a mirror of the first',
    duplicateEntries.every((row) => row.entries === 2 && row.voucherStatus === 'REVERSED' && row.originals === 1),
    duplicateEntries.map((row) => `${String(row.id).slice(0, 8)}x${row.entries}/${row.voucherStatus}`).join(', ') ||
      'none',
  );
  const unbalanced = await sql(
    `SELECT count(*)::int AS count FROM journal_entries WHERE "totalDebit" <> "totalCredit"`,
  );
  check('every journal entry in the company still balances', unbalanced[0].count === 0, `${unbalanced[0].count} unbalanced`);
  const cashMismatch = [];
  for (const [code, expected] of model.cash) {
    if (!near(await delta(code), expected)) cashMismatch.push(`${code}: ${await delta(code)} vs ${expected}`);
  }
  const cashBalancesFinal = await api('/cash/accounts/balances');
  const cashRowsFinal = cashBalancesFinal.data?.rows ?? cashBalancesFinal.data?.accounts ?? [];
  const boxMismatch = [
    [bank.code, await delta(bankLedger.code)],
    [cashBox.code, await delta(cashLedger.code)],
  ].filter(([cashCode, ledgerMovement]) => {
    const row = cashRowsFinal.find((candidate) => candidate.code === cashCode);
    return !near(row?.balance, ledgerMovement);
  });
  check(
    'every cash box reports the balance its ledger account carries',
    cashMismatch.length === 0 && boxMismatch.length === 0,
    `${cashMismatch.join(', ') || 'ledger ok'}; ${boxMismatch.map(([code]) => code).join(', ') || 'cash accounts ok'}`,
  );
  check(
    'the ledger matches the documents: receivable and payable movements reconcile to the last cent',
    near(await delta(AR), model.receivable) && near(await delta(AP), model.payable),
    `receivable ${await delta(AR)} (expected ${model.receivable}), payable ${await delta(AP)} (expected ${model.payable})`,
  );

  const trial = await trialBalance();
  check(
    'the trial balance is still balanced after every collection and payment',
    near(trial?.totals?.debit ?? trial?.totalDebit, trial?.totals?.credit ?? trial?.totalCredit),
    `debit ${trial?.totals?.debit ?? trial?.totalDebit}, credit ${trial?.totals?.credit ?? trial?.totalCredit}`,
  );

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    // The job log is not always reachable, but an annotation is. One compact
    // line carries every failure so a run can be diagnosed from the API alone.
    const text = failed
      .map((row, index) => `${index + 1}) ${row.name}${row.detail ? ` — ${row.detail}` : ''}`)
      .join(' | ');
    console.log(
      `::error title=Collections and payments: ${failed.length}/${results.length} checks failed::${text.slice(0, 3800)}`,
    );
  }
  return failed.length === 0;
}

let outcome = false;
try {
  outcome = await main();
} catch (error) {
  console.error(`SCENARIO ERROR: ${error.stack ?? error.message}`);
  outcome = false;
} finally {
  await pool.end();
}

process.exit(outcome ? 0 : 1);
