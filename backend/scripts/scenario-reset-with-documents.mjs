#!/usr/bin/env node
/**
 * A company reset with real business documents in the way.
 *
 * The reset is the one button that deletes a company's books, so the order it
 * deletes in is a safety property, not a detail. A live run found that order
 * broken: a quotation that had been converted into an invoice holds a
 * restrictive reference to that invoice (and every quotation holds one to its
 * customer, its items and the branch), so the transaction died on
 * `quotations_convertedInvoiceId_fkey` and the reset answered 500 with the
 * company untouched. The unit test now guards the order; this scenario proves
 * it on a real PostgreSQL with a full document chain behind it:
 *
 *   quotation -> converted invoice -> posted invoice -> receipt
 *   purchase invoice -> payment
 *   and the offer's own items, customer, supplier and warehouse.
 *
 * After the reset it checks that the documents are really gone (not merely
 * that the endpoint returned 200), that the verified safety backup exists on
 * disk, that the administrator survived, and that first-run setup can build a
 * working company again.
 *
 * The reset only runs when the caller says the database is disposable:
 *
 *   ENABLE_DISPOSABLE_RESET=true \
 *   DATABASE_URL=postgresql://... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-reset-with-documents.mjs [apiBaseUrl]
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import pg from 'pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required; this scenario must use disposable PostgreSQL.');
}
if (process.env.ENABLE_DISPOSABLE_RESET !== 'true') {
  throw new Error(
    'Refusing to run: this scenario resets the company. Set ENABLE_DISPOSABLE_RESET=true ' +
      'and point DATABASE_URL at a disposable database.',
  );
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);

const money = (value) => Math.round(Number(value ?? 0) * 10000) / 10000;
const near = (value, expected, tolerance = 0.0001) =>
  Math.abs(money(value) - money(expected)) <= tolerance;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const bearer = options.token ?? token;
  if (bearer && !options.noAuth) headers.Authorization = `Bearer ${bearer}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();
  return { status: response.status, data };
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 300)}`);
  return null;
}

async function sql(query, values = []) {
  const result = await pool.query(query, values);
  return result.rows;
}

function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.items ?? payload?.rows ?? payload?.data ?? [];
}

async function main() {
  console.log(`Reset with documents in the way, against ${API}\n`);

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
  check('the session has a company', Boolean(companyId), String(companyId).slice(0, 8));

  // ─────────────────────────────────────────── 1. a full chain of documents
  const chart = await api('/accounting/chart-of-accounts');
  const accounts = listOf(chart.data);
  const accountByCode = (code) => accounts.find((row) => row.code === code);
  check(
    'the chart of accounts is seeded, so documents can post',
    Boolean(accountByCode('1101')) && Boolean(accountByCode('1103')),
    `${accounts.length} accounts`,
  );

  const warehouses = listOf((await api('/inventory/warehouses')).data);
  const warehouseId = warehouses[0]?.id;
  // A fresh company has no cash book until one is opened, so open it here:
  // money has to have somewhere to land for the collection to post.
  let cashAccount = listOf((await api('/cash/accounts')).data).find(
    (row) => row.kind === 'CASH',
  );
  if (!cashAccount && accountByCode('1101')) {
    cashAccount = await must('open a cash box on account 1101', '/cash/accounts', {
      method: 'POST',
      json: {
        code: `RS-CASH-${stamp}`,
        nameEn: `Reset cash box ${stamp}`,
        nameAr: `خزينة التصفير ${stamp}`,
        kind: 'CASH',
        accountId: accountByCode('1101').id,
        currency: 'EGP',
      },
    });
  }
  check(
    'there is a warehouse and a cash box to move stock and money through',
    Boolean(warehouseId) && Boolean(cashAccount?.id),
    `warehouse ${String(warehouseId).slice(0, 8)}, cash ${cashAccount?.code ?? 'none'}`,
  );

  const item = await must('create a stocked item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `RS-ITEM-${stamp}`,
      nameEn: `Reset item ${stamp}`,
      nameAr: `صنف التصفير ${stamp}`,
      unit: 'PCS',
      isStockTracked: true,
      salePrice: '200',
      purchasePrice: '120',
      taxRate: '0',
    },
  });
  const customer = await must('create a customer', '/parties/customers', {
    method: 'POST',
    json: { code: `RS-C-${stamp}`, nameEn: `Reset customer ${stamp}`, nameAr: `عميل ${stamp}`, paymentTermDays: 30 },
  });
  const supplier = await must('create a supplier', '/parties/suppliers', {
    method: 'POST',
    json: { code: `RS-S-${stamp}`, nameEn: `Reset supplier ${stamp}`, nameAr: `مورد ${stamp}`, paymentTermDays: 30 },
  });
  if (!item || !customer || !supplier) return false;

  // Stock first: a posted purchase invoice is how the item reaches the shelf.
  const purchase = await must('create a purchase invoice for 10 units at 120', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      dueDate: today,
      supplierId: supplier.id,
      warehouseId,
      lines: [{ itemId: item.id, quantity: '10', unitPrice: '120' }],
    },
  });
  if (purchase) {
    await must('post the purchase invoice', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' });
  }

  const quotation = await must('create a quotation for the customer', '/sales/quotations', {
    method: 'POST',
    json: {
      quotationDate: today,
      validUntil: today,
      customerId: customer.id,
      subject: `Reset offer ${stamp}`,
      notes: 'Written so the reset has an offer to clear',
      tables: [
        {
          title: 'Items',
          lines: [{ itemId: item.id, quantity: '2', unitPrice: '200' }],
        },
      ],
    },
  });
  if (!quotation) return false;

  await must('send the quotation', `/sales/quotations/${quotation.id}/send`, { method: 'POST', json: {} });
  await must('accept the quotation', `/sales/quotations/${quotation.id}/accept`, { method: 'POST', json: {} });
  const converted = await must(
    'convert the accepted quotation into an invoice',
    `/sales/quotations/${quotation.id}/convert`,
    { method: 'POST', json: { invoiceDate: today, warehouseId } },
  );
  const invoiceId = converted?.invoice?.id;
  check('the conversion produced a draft sales invoice', Boolean(invoiceId), String(invoiceId ?? '').slice(0, 8));

  if (invoiceId) {
    await must('post the converted invoice', `/sales/invoices/${invoiceId}/post`, { method: 'POST' });
    const receipt = await must('collect part of the invoice', '/cash/vouchers', {
      method: 'POST',
      json: {
        kind: 'RECEIPT',
        voucherDate: today,
        cashAccountId: cashAccount.id,
        customerId: customer.id,
        amount: '150',
        description: `Reset collection ${stamp}`,
        allocations: [{ salesInvoiceId: invoiceId, amount: '150' }],
      },
    });
    if (receipt) {
      await must('post the collection', `/cash/vouchers/${receipt.id}/post`, { method: 'POST' });
    }
    if (purchase) {
      const payment = await must('pay part of the purchase invoice', '/cash/vouchers', {
        method: 'POST',
        json: {
          kind: 'PAYMENT',
          voucherDate: today,
          cashAccountId: cashAccount.id,
          supplierId: supplier.id,
          amount: '400',
          description: `Reset payment ${stamp}`,
          allocations: [{ purchaseInvoiceId: purchase.id, amount: '400' }],
        },
      });
      if (payment) {
        await must('post the payment', `/cash/vouchers/${payment.id}/post`, { method: 'POST' });
      }
    }
  }

  // The state that made the old reset fail: a quotation row holding a
  // restrictive pointer at a sales invoice.
  const conversionRow = await sql(
    `SELECT count(*)::int AS count FROM quotations
      WHERE "companyId" = $1::uuid AND "convertedInvoiceId" IS NOT NULL`,
    [companyId],
  );
  check(
    'the offer really does point at the invoice it became',
    conversionRow[0].count === 1,
    `${conversionRow[0].count} converted offers`,
  );

  const before = {
    quotations: (await sql(`SELECT count(*)::int AS c FROM quotations WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    invoices: (await sql(`SELECT count(*)::int AS c FROM sales_invoices WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    vouchers: (await sql(`SELECT count(*)::int AS c FROM cash_vouchers WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    entries: (await sql(`SELECT count(*)::int AS c FROM journal_entries WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
  };
  check(
    'documents and entries exist before the reset',
    before.quotations > 0 && before.invoices > 0 && before.vouchers > 0 && before.entries > 0,
    JSON.stringify(before),
  );

  const preview = await api('/admin/reset');
  check(
    'the reset preview counts the offers and the money documents it is about to clear',
    preview.status === 200 &&
      Number(preview.data?.counts?.quotations ?? 0) >= before.quotations &&
      Number(preview.data?.counts?.cashVouchers ?? 0) >= before.vouchers,
    `status ${preview.status}, quotations ${preview.data?.counts?.quotations}, vouchers ${preview.data?.counts?.cashVouchers}`,
  );

  // ─────────────────────────────────────────────────────────── 2. the reset
  const reset = await api('/admin/reset', {
    method: 'POST',
    json: { password: PASSWORD, confirmation: 'RESET' },
  });
  check(
    'the reset succeeds with an offer converted into a posted invoice behind it',
    reset.status === 200 && reset.data?.reset === true,
    `status ${reset.status}${reset.status === 200 ? '' : ` — ${JSON.stringify(reset.data)?.slice(0, 240)}`}`,
  );
  check(
    'it wrote a verified safety backup first and says how big it is',
    Boolean(reset.data?.backupFile) &&
      Number(reset.data?.backupBytes) > 0 &&
      Number(reset.data?.backupEntries) > 0,
    `${reset.data?.backupFile}, ${reset.data?.backupBytes ?? 0} bytes / ${reset.data?.backupEntries ?? 0} entries`,
  );
  check(
    'the offers were cleared in this run, not skipped',
    Number(reset.data?.deleted?.quotations ?? 0) >= before.quotations,
    `quotations ${reset.data?.deleted?.quotations}`,
  );

  const after = {
    quotations: (await sql(`SELECT count(*)::int AS c FROM quotations WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    legacy: (await sql(`SELECT count(*)::int AS c FROM quotations_legacy WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    invoices: (await sql(`SELECT count(*)::int AS c FROM sales_invoices WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    purchases: (await sql(`SELECT count(*)::int AS c FROM purchase_invoices WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    vouchers: (await sql(`SELECT count(*)::int AS c FROM cash_vouchers WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    allocations: (await sql(`SELECT count(*)::int AS c FROM cash_voucher_allocations a
                               JOIN cash_vouchers v ON v.id = a."voucherId" WHERE v."companyId" = $1::uuid`, [companyId]))[0].c,
    entries: (await sql(`SELECT count(*)::int AS c FROM journal_entries WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    lines: (await sql(`SELECT count(*)::int AS c FROM journal_lines l
                         JOIN journal_entries e ON e.id = l."journalEntryId" WHERE e."companyId" = $1::uuid`, [companyId]))[0].c,
    movements: (await sql(`SELECT count(*)::int AS c FROM stock_movements WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    balances: (await sql(`SELECT count(*)::int AS c FROM stock_balances WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    customers: (await sql(`SELECT count(*)::int AS c FROM customers WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    suppliers: (await sql(`SELECT count(*)::int AS c FROM suppliers WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    items: (await sql(`SELECT count(*)::int AS c FROM items WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    accounts: (await sql(`SELECT count(*)::int AS c FROM accounts WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    users: (await sql(`SELECT count(*)::int AS c FROM users WHERE "companyId" = $1::uuid`, [companyId]))[0].c,
    admin: (await sql(`SELECT count(*)::int AS c FROM users WHERE "companyId" = $1::uuid AND username = $2`, [companyId, USERNAME]))[0].c,
  };
  check(
    'every business table of the company is empty afterwards, offers and old offer rows included',
    Object.entries(after)
      .filter(([name]) => !['users', 'admin'].includes(name))
      .every(([, value]) => value === 0),
    JSON.stringify(after),
  );
  check(
    'the administrator was kept and every other account was removed',
    after.admin === 1 && after.users === 1,
    `users ${after.users}, administrators ${after.admin}`,
  );

  const companyRow = await sql(
    `SELECT "deletedAt" IS NOT NULL AS reset FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  check(
    'the company itself is put back into the first-run state, not destroyed',
    companyRow[0]?.reset === true,
    `deletedAt set: ${companyRow[0]?.reset}`,
  );

  // ────────────────────────────────────── 3. the backup really is on disk
  const capabilities = await api('/backup/full/capabilities');
  const backupDirectory = capabilities.data?.backupDirectory;
  let safetySize = 0;
  let safetyPath = '';
  for (const folder of [backupDirectory, join(process.cwd(), 'backups')]) {
    if (!folder) continue;
    const candidate = join(folder, String(reset.data?.backupFile ?? ''));
    try {
      const info = await stat(candidate);
      if (info.isFile() && info.size > 0) {
        safetySize = info.size;
        safetyPath = candidate;
        break;
      }
    } catch {
      // Try the next folder the server says it writes to.
    }
  }
  check(
    'the safety backup the reset named is a real file on disk, and matches the size it reported',
    safetySize > 0 && safetySize === Number(reset.data?.backupBytes ?? -1),
    safetyPath ? `${safetyPath} (${safetySize} bytes)` : `not found under ${backupDirectory}`,
  );

  // And it is a file that can be read back: the JSON is the whole company.
  let safetyReadable = false;
  if (safetyPath) {
    try {
      const parsed = JSON.parse(await readFile(safetyPath, 'utf8'));
      safetyReadable =
        parsed?.format === 'kayan-backup' &&
        parsed?.companyId === companyId &&
        Object.values(parsed?.counts ?? {}).some((count) => Number(count) > 0);
    } catch {
      safetyReadable = false;
    }
  }
  check(
    'the safety backup parses back into this company, with the rows it says it holds',
    safetyReadable,
    safetyPath ? 'format, company and counts verified' : 'no file to read',
  );

  // ──────────────────────────────────────── 4. the program still works
  const setupStatus = await api('/setup/status', { noAuth: true });
  check(
    'the next start asks for first-run setup again',
    setupStatus.status === 200 && setupStatus.data?.needsSetup === true,
    `needsSetup ${setupStatus.data?.needsSetup}, companies ${setupStatus.data?.companyCount}`,
  );

  const signInAgain = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  check(
    'the kept administrator can sign in with the same password',
    signInAgain.status < 300 && Boolean(signInAgain.data?.accessToken),
    `status ${signInAgain.status}`,
  );

  const completed = await api('/setup/initial', {
    method: 'POST',
    noAuth: true,
    json: {
      companyCode: reset.data?.companyCode,
      companyNameEn: 'KAYAN after reset',
      companyNameAr: 'كيان بعد إعادة الضبط',
      facilityKind: 'HEADQUARTERS',
      unitCode: 'MAIN',
      unitNameEn: 'Head Office',
      unitNameAr: 'المركز الرئيسي',
      adminUsername: USERNAME,
      adminPassword: PASSWORD,
      adminFullNameEn: 'Reset Administrator',
      adminFullNameAr: 'مدير بعد التصفير',
      seedChartOfAccounts: true,
    },
  });
  check(
    'first-run setup rebuilds a working company on the reset database',
    completed.status < 300 && completed.data?.companyId === companyId,
    `status ${completed.status}, company ${completed.data?.companyCode}`,
  );

  token = '';
  const freshLogin = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = freshLogin.data?.accessToken ?? '';
  const rebuiltChart = await api('/accounting/chart-of-accounts');
  const rebuiltAccounts = listOf(rebuiltChart.data);
  const health = await api('/health', { noAuth: true });
  check(
    'the rebuilt company has a chart of accounts, a branch and a healthy API',
    freshLogin.status < 300 && rebuiltAccounts.length > 0 && health.status === 200,
    `${rebuiltAccounts.length} accounts, health ${health.status}`,
  );

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    const text = failed
      .map((row, index) => `${index + 1}) ${row.name}${row.detail ? ` — ${row.detail}` : ''}`)
      .join(' | ');
    console.log(
      `::error title=Reset with documents: ${failed.length}/${results.length} checks failed::${text.slice(0, 3800)}`,
    );
  }
  return failed.length === 0;
}

let outcome = false;
try {
  outcome = await main();
} catch (error) {
  console.error(error);
  results.push({ name: 'scenario crashed', ok: false, detail: String(error?.message ?? error) });
} finally {
  await pool.end().catch(() => {});
  const failed = results.filter((row) => !row.ok);
  if (!outcome && failed.length > 0) {
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}
