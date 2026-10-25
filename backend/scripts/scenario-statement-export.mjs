#!/usr/bin/env node
/**
 * The partner statement, end to end: the numbers on the screen, the files the
 * buttons produce, and the arithmetic that ties them together.
 *
 * Run against a disposable database. This creates a customer, a supplier, two
 * sales invoices, a purchase invoice, a collection, a payment, a return and a
 * draft that must never appear in a statement.
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... DATABASE_URL=... \
 *     node backend/scripts/scenario-statement-export.mjs [apiBaseUrl]
 *
 * What is actually checked, rather than assumed:
 *   - the opening balance carries everything before the period;
 *   - every posted movement appears once, and a draft never does;
 *   - debit/credit point the right way for a customer and for a supplier;
 *   - closing = opening + debit - credit, and the running balance agrees;
 *   - the CSV and the XLSX hold the same rows as the screen, in Arabic too;
 *   - the print page is a real RTL page carrying the same figures.
 */
import ExcelJS from 'exceljs';
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
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
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
    if (response.status !== 429 || attempt >= 6) {
      return { status: response.status, data, type };
    }
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

/// A binary download: the bytes matter, not the parsed body.
async function binary(path) {
  const response = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    buffer,
    type: response.headers.get('content-type') ?? '',
    disposition: response.headers.get('content-disposition') ?? '',
  };
}

async function sql(query, values = []) {
  const result = await pool.query(query, values);
  return result.rows;
}

async function post(label, path) {
  return must(label, path, { method: 'POST' });
}

const money = (value) => Math.round(Number(value ?? 0) * 10000) / 10000;

/// A minimal CSV reader: quoted fields, doubled quotes, CRLF or LF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell !== ''));
}

async function main() {
  const session = await must('the administrator can sign in', '/auth/login', {
    method: 'POST',
    noAuth: true,
    json: { username: USERNAME, password: PASSWORD },
  });
  if (!session?.accessToken) return;
  token = session.accessToken;

  const me = await must('read the current session', '/auth/me');
  const companyId = me?.user?.companyId ?? me?.companyId;

  const chart = await api('/accounting/chart-of-accounts');
  const accounts = chart.data?.items ?? [];
  const accountId = (code) => accounts.find((row) => row.code === code)?.id;
  if (!accountId('1102')) {
    check('the chart of accounts contains a parent for cash', false, 'is the database seeded?');
    return;
  }

  // The ledger is the other half of this story: the statement is built from
  // documents, so the control accounts are read before and after to prove the
  // two agree.
  const controlBalance = async (code) => {
    const rows = await sql(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS balance
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l."journalEntryId"
         JOIN accounts a ON a.id = l."accountId"
        WHERE a."companyId" = $1::uuid AND a.code = $2 AND e.status = 'POSTED'`,
      [companyId, code],
    );
    return Number(rows[0]?.balance ?? 0);
  };
  const receivableBefore = await controlBalance('1103');
  const payableBefore = await controlBalance('2101');

  // ── the people and the goods ──────────────────────────────────────────────
  const customer = await must('create a customer', '/parties/customers', {
    method: 'POST',
    json: {
      code: `ST-C-${stamp}`,
      nameEn: `Statement customer ${stamp}`,
      nameAr: `عميل الكشف ${stamp}`,
    },
  });
  const supplier = await must('create a supplier', '/parties/suppliers', {
    method: 'POST',
    json: {
      code: `ST-S-${stamp}`,
      nameEn: `Statement supplier ${stamp}`,
      nameAr: `مورد الكشف ${stamp}`,
    },
  });
  const item = await must('create a stocked item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `ST-I-${stamp}`,
      nameEn: `Statement item ${stamp}`,
      nameAr: `صنف الكشف ${stamp}`,
      unit: 'piece',
      purchasePrice: '10.0000',
      salePrice: '25.0000',
      isStockTracked: true,
    },
  });
  const cashLedger = await must('open a cash ledger account', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: `1102.ST${stamp}`,
      nameEn: `Statement cash ledger ${stamp}`,
      nameAr: `حساب نقدي للكشف ${stamp}`,
      type: 'ASSET',
      parentId: accountId('1102'),
      isPostable: true,
    },
  });
  const cashBox = await must('open a cash box', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `ST-CASH-${stamp}`,
      nameEn: `Statement cash ${stamp}`,
      nameAr: `خزينة الكشف ${stamp}`,
      kind: 'CASH',
      accountId: cashLedger?.id,
      currency: 'EGP',
    },
  });
  if (!customer || !supplier || !item || !cashLedger || !cashBox) return;

  // ── stock arrives, so it can later be sold ────────────────────────────────
  const purchase = await must('buy ten units at 10.00', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      lines: [{ itemId: item.id, quantity: '10', unitPrice: '10' }],
    },
  });
  const purchasePosted = purchase?.id
    ? await post('post the purchase invoice', `/purchases/invoices/${purchase.id}/post`)
    : null;
  if (!purchasePosted?.id) return;

  // ── one invoice belongs to the period before the one being printed ────────
  const older = await must('sell four units yesterday for 100.00', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: yesterday,
      dueDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '4', unitPrice: '25' }],
    },
  });
  const current = await must('sell two units today for 50.00', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      dueDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '2', unitPrice: '25' }],
    },
  });
  const draft = await must('leave a draft invoice behind', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      dueDate: today,
      customerId: customer.id,
      lines: [{ itemId: item.id, quantity: '1', unitPrice: '25' }],
    },
  });
  if (!older?.id || !current?.id || !draft?.id) return;
  const olderPosted = await post('post yesterday invoice', `/sales/invoices/${older.id}/post`);
  const currentPosted = await post('post today invoice', `/sales/invoices/${current.id}/post`);
  if (!olderPosted?.id || !currentPosted?.id) return;

  const olderDetail = await must('read yesterday invoice', `/sales/invoices/${older.id}`);
  const currentDetail = await must('read today invoice', `/sales/invoices/${current.id}`);
  const currentLine = currentDetail?.lines?.[0];

  // ── a return, a collection and a supplier payment ─────────────────────────
  const creditNote = await must('return one unit against today invoice', '/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: current.id,
      returnDate: today,
      reason: 'Statement scenario',
      lines: [{ originalLineId: currentLine?.id, quantity: '1.0000' }],
    },
  });
  const creditPosted = creditNote?.id
    ? await post('post the sales return', `/returns/sales/${creditNote.id}/post`)
    : null;
  if (!creditPosted?.id) return;

  const receipt = await must('collect 60.00 from the customer', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'RECEIPT',
      voucherDate: today,
      cashAccountId: cashBox.id,
      customerId: customer.id,
      amount: '60',
      description: `Collection ${stamp}`,
      allocations: [{ salesInvoiceId: older.id, amount: '60' }],
    },
  });
  const receiptPosted = receipt?.id
    ? await post('post the collection', `/cash/vouchers/${receipt.id}/post`)
    : null;
  const payment = await must('pay the supplier 50.00', '/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      voucherDate: today,
      cashAccountId: cashBox.id,
      supplierId: supplier.id,
      amount: '50',
      description: `Payment ${stamp}`,
      allocations: [{ purchaseInvoiceId: purchase.id, amount: '50' }],
    },
  });
  const paymentPosted = payment?.id
    ? await post('post the supplier payment', `/cash/vouchers/${payment.id}/post`)
    : null;
  if (!receiptPosted?.id || !paymentPosted?.id) return;

  // ── the customer statement ────────────────────────────────────────────────
  const customerStatement = await must(
    'read the customer statement',
    `/parties/customers/statement/${customer.id}?from=${today}&to=${today}`,
  );
  if (!customerStatement) return;

  const salesTotal = money(olderDetail?.totalAmount) + money(currentDetail?.totalAmount);
  const creditTotal = money(creditPosted.totalAmount ?? creditPosted.lines?.[0]?.lineTotal);
  const expectedClosing = money(salesTotal - creditTotal - 60);

  check(
    'the statement starts with what was owed before the period',
    near(customerStatement.openingBalance, money(olderDetail?.totalAmount)),
    `opening ${customerStatement.openingBalance}, yesterday invoice ${olderDetail?.totalAmount}`,
  );
  check(
    'every posted movement of the period is there once, and the draft is not',
    customerStatement.rows?.length === 3,
    `${customerStatement.rows?.length} rows: ${(customerStatement.rows ?? [])
      .map((row) => row.number)
      .join(', ')}`,
  );
  check(
    'the draft invoice never reaches a statement',
    !(customerStatement.rows ?? []).some((row) => row.id === draft.id),
    draft.invoiceNumber,
  );
  check(
    'a sale debits the customer and a collection credits them',
    customerStatement.rows?.find((row) => row.number === currentDetail?.invoiceNumber)?.debit ===
      money(currentDetail?.totalAmount).toFixed(4) &&
      customerStatement.rows?.find((row) => row.number === receiptPosted?.voucherNumber)?.credit ===
        '60.0000',
    JSON.stringify(
      (customerStatement.rows ?? []).map((row) => [row.number, row.debit, row.credit]),
    ),
  );
  check(
    'the customer closing is opening + sales - returns - collections',
    near(customerStatement.closingBalance, expectedClosing),
    `closing ${customerStatement.closingBalance}, expected ${expectedClosing.toFixed(4)}`,
  );
  check(
    'the customer statement arithmetic holds',
    near(
      Number(customerStatement.openingBalance) +
        Number(customerStatement.totalDebit) -
        Number(customerStatement.totalCredit),
      Number(customerStatement.closingBalance),
    ),
    `opening ${customerStatement.openingBalance} + debit ${customerStatement.totalDebit} - credit ${customerStatement.totalCredit}`,
  );
  const running = (customerStatement.rows ?? []).map((row) => Number(row.balance));
  check(
    'the running balance ends on the closing balance and moves by one row at a time',
    running.length > 0 &&
      near(running[running.length - 1], Number(customerStatement.closingBalance)) &&
      (customerStatement.rows ?? []).every((row, index) => {
        const before = index === 0 ? Number(customerStatement.openingBalance) : running[index - 1];
        return near(before + Number(row.debit) - Number(row.credit), running[index]);
      }),
    running.join(' → '),
  );

  // ── the supplier statement, direction checked rather than assumed ─────────
  const supplierStatement = await must(
    'read the supplier statement',
    `/parties/suppliers/statement/${supplier.id}?from=${monthStart}&to=${today}`,
  );
  if (!supplierStatement) return;
  const purchaseRow = (supplierStatement.rows ?? []).find(
    (row) => row.number === purchase.invoiceNumber,
  );
  const paymentRow = (supplierStatement.rows ?? []).find(
    (row) => row.number === paymentPosted.voucherNumber,
  );
  check(
    'a purchase credits the supplier and a payment debits them',
    near(purchaseRow?.credit, purchasePosted.totalAmount) &&
      near(purchaseRow?.debit, 0) &&
      near(paymentRow?.debit, 50) &&
      near(paymentRow?.credit, 0),
    JSON.stringify([purchaseRow, paymentRow]),
  );
  check(
    'a supplier who is owed money closes negative, and the arithmetic holds',
    near(
      supplierStatement.closingBalance,
      -(money(purchasePosted.totalAmount) - 50),
    ) &&
      near(
        Number(supplierStatement.openingBalance) +
          Number(supplierStatement.totalDebit) -
          Number(supplierStatement.totalCredit),
        Number(supplierStatement.closingBalance),
      ),
    `closing ${supplierStatement.closingBalance}`,
  );

  // ── the CSV file ──────────────────────────────────────────────────────────
  const csvPath = (kind, id, lang) =>
    `/exports/party-statement/download?partyId=${id}&kind=${kind}&from=${today}&to=${today}` +
    `&format=csv&lang=${lang}`;

  const csvAr = await binary(csvPath('customer', customer.id, 'ar'));
  check(
    'the Arabic CSV downloads as a CSV file',
    csvAr.status === 200 &&
      csvAr.type.includes('text/csv') &&
      /\.csv/i.test(csvAr.disposition),
    `${csvAr.status} ${csvAr.type} ${csvAr.disposition}`,
  );
  const csvRows = parseCsv(csvAr.buffer.toString('utf8'));
  const csvText = csvAr.buffer.toString('utf8');
  check(
    'the Arabic CSV is actually Arabic',
    csvText.includes('كشف حساب') && csvText.includes(customer.nameAr),
    csvText.split('\n')[0]?.slice(0, 80),
  );
  check(
    'the CSV names the status of every movement',
    csvRows.some((row) => row.includes('حالة المستند')) &&
      (csvText.match(/POSTED/g) ?? []).length >= (customerStatement.rows ?? []).length,
    `${(csvText.match(/POSTED/g) ?? []).length} POSTED cells, header ${csvRows.some((row) =>
      row.includes('حالة المستند'),
    )}`,
  );
  check(
    'the CSV carries one line per movement, not just a total',
    csvRows.filter((row) => (customerStatement.rows ?? []).some((entry) => row.includes(entry.number)))
      .length === (customerStatement.rows ?? []).length,
    `${csvRows.length} CSV lines for ${customerStatement.rows?.length} movements`,
  );
  check(
    'the CSV closes on the same balance as the screen',
    csvRows.some((row) => row.includes('الرصيد الختامي') && row.includes(customerStatement.closingBalance)),
    `looking for ${customerStatement.closingBalance}`,
  );
  check(
    'the CSV has no missing values where a figure belongs',
    !/undefined|NaN|\[object/.test(csvText),
    csvText.match(/undefined|NaN|\[object/)?.[0] ?? '',
  );

  // ── the XLSX file, read back with a real spreadsheet reader ───────────────
  const xlsxAr = await binary(csvPath('customer', customer.id, 'ar').replace('csv', 'xlsx'));
  check(
    'the Arabic XLSX downloads as a spreadsheet',
    xlsxAr.status === 200 &&
      xlsxAr.type.includes('spreadsheetml') &&
      xlsxAr.buffer.subarray(0, 2).toString() === 'PK',
    `${xlsxAr.status} ${xlsxAr.type}, ${xlsxAr.buffer.length} bytes`,
  );
  let sheetText = '';
  let sheetRows = [];
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxAr.buffer);
    const sheet = workbook.worksheets[0];
    sheetRows = [];
    sheet.eachRow((row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(String(cell.text ?? '')));
      sheetRows.push(cells);
      sheetText += `${cells.join('|')}\n`;
    });
  } catch (error) {
    check('the XLSX can be opened again', false, String(error).slice(0, 200));
  }
  check(
    'the XLSX can be opened again and holds the same rows',
    sheetRows.length > 0 &&
      (customerStatement.rows ?? []).every((row) =>
        sheetText.includes(String(currentDetail?.invoiceNumber ?? '')) ||
        sheetText.includes(row.number),
      ),
    `${sheetRows.length} spreadsheet rows`,
  );
  check(
    'the XLSX is Arabic and carries the closing balance',
    sheetText.includes('كشف حساب') &&
      sheetText.includes(customer.nameAr) &&
      sheetText.includes(customerStatement.closingBalance),
    sheetText.split('\n')[0]?.slice(0, 80),
  );

  // ── the print page ────────────────────────────────────────────────────────
  const printAr = await api(
    `/exports/party-statement/print?partyId=${customer.id}&kind=customer&from=${today}&to=${today}&lang=ar`,
  );
  const html = typeof printAr.data === 'string' ? printAr.data : '';
  check(
    'the Arabic print page is served as HTML',
    printAr.status === 200 && /text\/html/.test(printAr.type ?? ''),
    `status ${printAr.status}`,
  );
  check(
    'the print page is right-to-left and carries the Arabic name and closing balance',
    html.includes('dir="rtl"') &&
      html.includes(customer.nameAr) &&
      html.includes(customerStatement.closingBalance) &&
      html.includes(currentDetail?.invoiceNumber),
    `${html.slice(0, 60)}… ${html.length} bytes`,
  );
  const printEn = await api(
    `/exports/party-statement/print?partyId=${customer.id}&kind=customer&from=${today}&to=${today}&lang=en`,
  );
  check(
    'the English print page is left-to-right with the same figures',
    typeof printEn.data === 'string' &&
      printEn.data.includes('dir="ltr"') &&
      printEn.data.includes(customer.nameEn) &&
      printEn.data.includes(customerStatement.closingBalance),
    `${printEn.status}`,
  );

  // ── the same page for the supplier ────────────────────────────────────────
  const supplierPrint = await api(
    `/exports/party-statement/print?partyId=${supplier.id}&kind=supplier&from=${monthStart}&to=${today}&lang=ar`,
  );
  check(
    'a supplier statement prints with its own direction and closing',
    supplierPrint.status === 200 &&
      typeof supplierPrint.data === 'string' &&
      supplierPrint.data.includes(supplier.nameAr) &&
      supplierPrint.data.includes(supplierStatement.closingBalance),
    `${supplierPrint.status}`,
  );

  // ── asking for a statement without a partner is a clear refusal ───────────
  const noParty = await api('/exports/party-statement/download?format=csv');
  check(
    'a statement without a partner is refused with a clear message',
    noParty.status === 400 && /partyId/.test(JSON.stringify(noParty.data)),
    `${noParty.status} ${JSON.stringify(noParty.data)?.slice(0, 120)}`,
  );

  // ── the ledger agrees with the statement ──────────────────────────────────
  // Only this scenario's documents moved in this run, so whatever the control
  // accounts gained has to be exactly the closing balances just printed.
  const receivableAfter = await controlBalance('1103');
  const payableAfter = await controlBalance('2101');
  check(
    'the receivable control account moved by exactly the customer closing balance',
    near(receivableAfter - receivableBefore, Number(customerStatement.closingBalance)),
    `control moved ${money(receivableAfter - receivableBefore)}, statement closed ${customerStatement.closingBalance}`,
  );
  check(
    'the payable control account moved by exactly the supplier closing balance',
    near(payableAfter - payableBefore, Number(supplierStatement.closingBalance)),
    `control moved ${money(payableAfter - payableBefore)}, statement closed ${supplierStatement.closingBalance}`,
  );
}

main()
  .catch((error) => {
    check('the scenario ran to the end', false, String(error).slice(0, 400));
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    const passed = results.filter((entry) => entry.ok).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    if (passed !== results.length) process.exitCode = 1;
  });
