#!/usr/bin/env node
/**
 * Exercises the existing accounting workbook imports through the live API.
 * Run only against a disposable PostgreSQL database seeded with a company:
 * this creates chart accounts, one opening-balance draft, and a test item.
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-imports.mjs [apiBaseUrl]
 */
const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required; this scenario must use disposable PostgreSQL.');
}

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);

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
      body: options.json === undefined ? options.body : JSON.stringify(options.json),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status !== 429 || attempt >= 6) return { status: response.status, data, headers: response.headers };
    const seconds = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5);
    await sleep(Math.min(seconds + 1, 90) * 1000);
  }
}

async function uploadCsv(kind, csv, { dryRun, fileName }) {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), fileName);
  return api(`/import/${kind}?dryRun=${dryRun ? 'true' : 'false'}&mode=insert`, {
    method: 'POST',
    body: form,
  });
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    noAuth: true,
    json: { username: USERNAME, password: PASSWORD },
  });
  token = login.data?.accessToken ?? '';
  check('accounting import scenario can sign in', login.status === 201 && Boolean(token), `HTTP ${login.status}`);
  if (!token) return;

  const chartTemplate = await api('/import/templates/chart-of-accounts');
  const openingTemplate = await api('/import/templates/opening-balances');
  check('chart-of-accounts import template is a real XLSX download',
    chartTemplate.status === 200 &&
      String(chartTemplate.headers.get('content-type')).includes('spreadsheetml') &&
      String(chartTemplate.data).length > 100,
    `HTTP ${chartTemplate.status}, ${String(chartTemplate.data).length} bytes of response text`);
  check('opening-balances import template is a real XLSX download',
    openingTemplate.status === 200 &&
      String(openingTemplate.headers.get('content-type')).includes('spreadsheetml') &&
      String(openingTemplate.data).length > 100,
    `HTTP ${openingTemplate.status}, ${String(openingTemplate.data).length} bytes of response text`);

  // ──────────────────────────────────────────────── template permissions
  // The blank sheet writes nothing, so it follows the read grant; the upload
  // that posts figures keeps the manage grant. A granted reader who asks for a
  // sheet they may not have must be refused with a message, not a blank file.
  const observerRole = await api('/admin/roles', {
    method: 'POST',
    json: {
      code: `OBSERVER_${stamp}`,
      nameEn: 'Scenario opening-balance reader',
      nameAr: 'مراجع أرصدة افتتاحية',
      permissions: ['accounting.openingbalances.read'],
    },
  });
  const observerRoleId = observerRole.data?.id ?? '';
  check('a role holding only the opening-balance read grant can be created',
    observerRole.status === 201 && Boolean(observerRoleId),
    observerRole.data?.detail ?? `HTTP ${observerRole.status}`);

  let readerToken = '';
  if (observerRoleId) {
    const reader = await api('/admin/users', {
      method: 'POST',
      json: {
        username: `scenario_reader_${stamp}`,
        password: 'Scenario-Reader-12345',
        fullNameEn: 'Scenario Reader',
        fullNameAr: 'مراجع اختبار',
        roleIds: [observerRoleId],
      },
    });
    check('an opening-balance reader can be created with that role',
      reader.status === 201 && Boolean(reader.data?.id),
      reader.data?.detail ?? `HTTP ${reader.status}`);

    if (reader.data?.id) {
      const readerLogin = await api('/auth/login', {
        method: 'POST',
        noAuth: true,
        json: { username: `scenario_reader_${stamp}`, password: 'Scenario-Reader-12345' },
      });
      readerToken = readerLogin.data?.accessToken ?? '';
      check('the opening-balance reader can sign in',
        readerLogin.status === 201 && Boolean(readerToken),
        `HTTP ${readerLogin.status}`);
    }
  }

  if (readerToken) {
    const asReader = (path, options = {}) => api(path, {
      ...options,
      noAuth: true,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${readerToken}` },
    });

    const readerSheet = await asReader('/import/templates/opening-balances');
    check('a reader may download the opening-balance sheet without the manage grant',
      readerSheet.status === 200 &&
        String(readerSheet.headers.get('content-type')).includes('spreadsheetml'),
      `HTTP ${readerSheet.status}`);

    const readerUpload = await asReader('/import/opening-balances?dryRun=true&mode=insert', {
      method: 'POST',
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob([
          'As-of date,Branch code,Warehouse code,Account code,Debit,Credit,Item code,Opening quantity,Unit cost\n' +
          '2026-01-01,,,1101,1,0,,,\n2026-01-01,,,3103,0,1,,,\n',
        ], { type: 'text/csv' }), 'reader-opening.csv');
        return form;
      })(),
    });
    check('the same reader cannot upload opening balances',
      readerUpload.status === 403,
      `HTTP ${readerUpload.status}`);

    const refusedSheet = await asReader('/import/templates/customers');
    check('a reader without the customer grant cannot download the customer sheet',
      refusedSheet.status === 403,
      `HTTP ${refusedSheet.status}`);

    const anonymousSheet = await api('/import/templates/opening-balances', { noAuth: true });
    check('the opening-balance sheet cannot be downloaded without signing in',
      anonymousSheet.status === 401,
      `HTTP ${anonymousSheet.status}`);
  }

  const parentCode = `E2E-${stamp}`;
  const childCode = `${parentCode}-01`;
  const accountCsv = [
    'Code,Name (English),Name (Arabic),Account type,Parent code,Can receive postings,Active,Currency,Description',
    `${childCode},Imported child account,حساب فرعي مستورد,EXPENSE,${parentCode},yes,yes,EGP,API import scenario`,
    `${parentCode},Imported test group,مجموعة اختبار مستوردة,EXPENSE,,yes,yes,EGP,API import scenario`,
  ].join('\n');
  const accountPreview = await uploadCsv('chart-of-accounts', accountCsv, {
    dryRun: true,
    fileName: 'account-import-preview.csv',
  });
  check('chart preview validates parent/child rows without writing',
    accountPreview.status < 300 && accountPreview.data?.dryRun === true &&
      accountPreview.data?.created === 2 && accountPreview.data?.errors?.length === 0,
    `HTTP ${accountPreview.status}, would create ${accountPreview.data?.created ?? 0}, errors ${accountPreview.data?.errors?.length ?? '?'}`);

  const accountCommit = await uploadCsv('chart-of-accounts', accountCsv, {
    dryRun: false,
    fileName: 'account-import-commit.csv',
  });
  check('chart import commits parents before children',
    accountCommit.status < 300 && accountCommit.data?.created === 2 &&
      accountCommit.data?.errors?.length === 0,
    `HTTP ${accountCommit.status}, created ${accountCommit.data?.created ?? 0}`);
  const accountReplay = await uploadCsv('chart-of-accounts', accountCsv, {
    dryRun: false,
    fileName: 'account-import-replay.csv',
  });
  check('re-uploading chart codes is idempotent and skips both existing accounts',
    accountReplay.status < 300 && accountReplay.data?.created === 0 &&
      accountReplay.data?.skipped === 2 && accountReplay.data?.errors?.length === 0,
    `HTTP ${accountReplay.status}, created ${accountReplay.data?.created ?? 0}, skipped ${accountReplay.data?.skipped ?? 0}`);

  const duplicateCode = `E2E-DUP-${stamp}`;
  const duplicateAccounts = [
    'Code,Name (English),Name (Arabic),Account type,Parent code,Can receive postings,Active',
    `${duplicateCode},Duplicate one,مكرر أول,EXPENSE,,yes,yes`,
    `${duplicateCode},Duplicate two,مكرر ثان,EXPENSE,,yes,yes`,
  ].join('\n');
  const duplicateReport = await uploadCsv('chart-of-accounts', duplicateAccounts, {
    dryRun: false,
    fileName: 'duplicate-account-codes.csv',
  });
  check('duplicate codes in one workbook report a row error and commit nothing',
    duplicateReport.status < 300 && duplicateReport.data?.created === 0 &&
      duplicateReport.data?.errors?.some((error) => /appears more than once/i.test(error.message)),
    `HTTP ${duplicateReport.status}, created ${duplicateReport.data?.created ?? 0}, errors ${duplicateReport.data?.errors?.length ?? '?'}`);

  const openingCsv = [
    'As-of date,Branch code,Warehouse code,Account code,Debit,Credit,Customer code,Supplier code,Item code,Opening quantity,Unit cost,Description',
    '2026-01-01,,,1101,1000.0000,0,,,,,,Imported opening cash',
    '2026-01-01,,,3101,0,1000.0000,,,,,,Imported opening equity',
  ].join('\n');
  const openingPreview = await uploadCsv('opening-balances', openingCsv, {
    dryRun: true,
    fileName: 'opening-balance-preview.csv',
  });
  check('balanced opening workbook preview validates without creating a draft',
    openingPreview.status < 300 && openingPreview.data?.dryRun === true &&
      openingPreview.data?.created === 1 && openingPreview.data?.validRows === 2 &&
      openingPreview.data?.errors?.length === 0 && !openingPreview.data?.draft,
    `HTTP ${openingPreview.status}, valid rows ${openingPreview.data?.validRows ?? 0}`);

  const openingCommit = await uploadCsv('opening-balances', openingCsv, {
    dryRun: false,
    fileName: 'opening-balance-commit.csv',
  });
  check('balanced opening workbook creates a reviewable draft, not a posted journal',
    openingCommit.status < 300 && openingCommit.data?.created === 1 &&
      openingCommit.data?.errors?.length === 0 && Boolean(openingCommit.data?.draft?.id) &&
      String(openingCommit.data?.draft?.status).toLowerCase() === 'draft',
    `HTTP ${openingCommit.status}, draft ${openingCommit.data?.draft?.documentNumber ?? 'missing'}`);
  const openingReplay = await uploadCsv('opening-balances', openingCsv, {
    dryRun: false,
    fileName: 'opening-balance-replay.csv',
  });
  check('the exact same opening workbook is replay-safe and returns the existing draft',
    openingReplay.status < 300 && openingReplay.data?.created === 0 &&
      openingReplay.data?.skipped === 1 &&
      openingReplay.data?.draft?.id === openingCommit.data?.draft?.id,
    `HTTP ${openingReplay.status}, skipped ${openingReplay.data?.skipped ?? 0}`);

  const unbalancedCsv = openingCsv.replace('0,1000.0000,', '0,900.0000,');
  const unbalanced = await uploadCsv('opening-balances', unbalancedCsv, {
    dryRun: false,
    fileName: 'unbalanced-opening-balance.csv',
  });
  check('an unbalanced opening workbook reports the difference and creates no draft',
    unbalanced.status < 300 && unbalanced.data?.created === 0 &&
      unbalanced.data?.errors?.some((error) => /not balanced/i.test(error.message)) &&
      !unbalanced.data?.draft,
    `HTTP ${unbalanced.status}, created ${unbalanced.data?.created ?? 0}, errors ${unbalanced.data?.errors?.length ?? '?'}`);

  const testItemCode = `E2E-IMP-${stamp}`;
  const testItem = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: testItemCode,
      nameEn: `Import stock ${stamp}`,
      nameAr: `مخزون استيراد ${stamp}`,
      unit: 'piece',
      purchasePrice: '10.0000',
      salePrice: '15.0000',
      isStockTracked: true,
    },
  });
  check('create a stock item for duplicate-opening-line validation',
    testItem.status < 300 && Boolean(testItem.data?.id), `HTTP ${testItem.status}`);
  if (testItem.status < 300 && testItem.data?.id) {
    const duplicateStockCsv = [
      'As-of date,Branch code,Warehouse code,Account code,Debit,Credit,Item code,Opening quantity,Unit cost',
      `2026-01-01,,,1104,10,0,${testItemCode},1,10`,
      `2026-01-01,,,1104,10,0,${testItemCode},1,10`,
      '2026-01-01,,,3101,0,20,,,',
    ].join('\n');
    const duplicateStock = await uploadCsv('opening-balances', duplicateStockCsv, {
      dryRun: false,
      fileName: 'duplicate-opening-stock.csv',
    });
    check('duplicate stock-item lines are rejected before a draft can be created',
      duplicateStock.status < 300 && duplicateStock.data?.created === 0 &&
        duplicateStock.data?.errors?.some((error) => /stock item .* repeated/i.test(error.message)) &&
        !duplicateStock.data?.draft,
      `HTTP ${duplicateStock.status}, created ${duplicateStock.data?.created ?? 0}, errors ${duplicateStock.data?.errors?.length ?? '?'}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} import checks passed` +
    (failed.length ? `\nFAILED:\n  - ${failed.map((result) => `${result.name}: ${result.detail}`).join('\n  - ')}` : ''));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
