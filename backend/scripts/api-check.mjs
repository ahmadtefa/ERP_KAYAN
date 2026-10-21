#!/usr/bin/env node
/**
 * Drives the real routes of a running KAYAN API, the way the screens do,
 * and checks what comes back.
 *
 * This is the check that says whether the program works - not whether it
 * compiles. It signs in, renews its session, takes a full backup, downloads
 * it, uploads it back, restores it, exports and prints a report, downloads
 * an import template and imports it, and then (only when it is told the
 * database is disposable) resets the company and sets it up again.
 *
 *   node scripts/api-check.mjs [apiBaseUrl]
 *
 * Environment:
 *   APP_URL               where the API is (default http://127.0.0.1:3000/api/v1)
 *   ADMIN_USERNAME        sign-in name           (default: admin)
 *   ADMIN_PASSWORD        sign-in secret         (default: Admin@12345)
 *   KAYAN_E2E_ALLOW_RESET set to 1 to run the destructive reset section.
 *                         Only ever do that against a throwaway database.
 *
 * Exit code 0 means every check passed. Each check prints PASS/FAIL with
 * what it saw.
 */
const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const ALLOW_RESET = process.env.KAYAN_E2E_ALLOW_RESET === '1';

const results = [];

function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let token = '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, options = {}, attempt = 0) {
  const headers = { ...(options.headers ?? {}) };
  if (token && !options.noAuth) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.json !== undefined
        ? JSON.stringify(options.json)
        : options.body,
    redirect: 'manual',
  });

  // Sign-in and renewal are rate-limited by design. Running this check twice
  // within a minute is a normal thing to do, so it waits when it is asked to
  // rather than reporting a failure that is not one.
  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 1);
    await sleep(Math.min(Math.max(retryAfter, 1), 70) * 1000);
    return call(path, options, attempt + 1);
  }

  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.arrayBuffer().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

async function main() {
  // ─────────────────────────────────────────────────────────── 1. sign in
  const login = await call('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  check('sign in as the administrator', Boolean(token), `status ${login.status}`);
  if (!token) return false;

  // ────────────────────────────────────── 2. what this machine can do
  const caps = await call('/backup/full/capabilities');
  check(
    'the server reports the PostgreSQL tools it found',
    caps.status === 200 && caps.data?.available === true,
    caps.data?.version ?? caps.data?.reason ?? `status ${caps.status}`,
  );
  if (caps.data?.available !== true) return false;

  // ──────────────────────────────────────────────────── 3. take a backup
  const created = await call('/backup/full', { method: 'POST' });
  const name = created.data?.file?.name ?? '';
  check(
    'taking a full backup returns a file that exists',
    created.status === 201 && /\.dump$/.test(name),
    `${name} (${created.data?.file?.sizeBytes ?? 0} bytes)`,
  );
  if (!name) return false;

  const listing = await call('/backup/full');
  check(
    'the backup appears in the list',
    Array.isArray(listing.data) && listing.data.some((f) => f.name === name),
    `${listing.data?.length ?? 0} file(s)`,
  );

  // ───────────────────────────────────────────────────────── 4. download
  const downloaded = await call(
    `/backup/full/${encodeURIComponent(name)}/download`,
  );
  const bytes = downloaded.data instanceof ArrayBuffer ? new Uint8Array(downloaded.data) : new Uint8Array();
  const magic = String.fromCharCode(...bytes.subarray(0, 5));
  check(
    'downloading the backup returns the bytes with an attachment header',
    downloaded.status === 200 &&
      (downloaded.headers.get('content-disposition') ?? '').includes('attachment'),
    `${bytes.length} bytes, ${downloaded.headers.get('content-disposition') ?? 'no header'}`,
  );
  check('the downloaded file is a PostgreSQL Custom archive', magic === 'PGDMP', magic);

  // A download without a token must be refused, not handed out.
  const anonymous = await call(
    `/backup/full/${encodeURIComponent(name)}/download`,
    { noAuth: true },
  );
  check('a download without a token is refused', anonymous.status === 401, `status ${anonymous.status}`);

  // ─────────────────────────────────── 4b. one-minute download tickets
  //
  // A print page or a file opened by the browser cannot carry an
  // Authorization header, so something has to be in the address. It is a
  // ticket minted for a minute, never the sign-in token.
  const ticket = await call('/auth/download-ticket', { method: 'POST' });
  const ticketValue = ticket.data?.ticket ?? '';
  check(
    'the server mints a short-lived download ticket',
    ticket.status === 201 && ticketValue.length > 0 && ticket.data?.expiresIn <= 600,
    `expires in ${ticket.data?.expiresIn}s`,
  );

  if (ticketValue) {
    const withTicket = await call(
      `/backup/full/${encodeURIComponent(name)}/download?ticket=${encodeURIComponent(ticketValue)}`,
      { noAuth: true },
    );
    check(
      'the ticket opens the file',
      withTicket.status === 200,
      `status ${withTicket.status}`,
    );
  }

  // The point of the whole exercise: this is what used to work.
  const withAccessToken = await call(
    `/backup/full/${encodeURIComponent(name)}/download?ticket=${encodeURIComponent(token)}`,
    { noAuth: true },
  );
  check(
    'the sign-in token is refused in an address',
    withAccessToken.status === 401,
    `status ${withAccessToken.status} — ${withAccessToken.data?.detail ?? ''}`,
  );

  const ticketAsBearer = await call('/backup/full', {
    headers: { Authorization: `Bearer ${ticketValue}` },
    noAuth: true,
  });
  check(
    'a download ticket is not accepted as a bearer token',
    ticketAsBearer.status === 401,
    `status ${ticketAsBearer.status}`,
  );

  // ───────────────────────────────────────────── 5. refuse a bad upload
  const form = new FormData();
  form.append('confirm', 'true');
  form.append('file', new Blob(['this is not a dump at all']), 'bogus.dump');
  const refused = await call('/backup/full/restore', { method: 'POST', body: form });
  check(
    'a file that is not a dump is refused without touching the database',
    refused.status === 400,
    refused.data?.detail ?? `status ${refused.status}`,
  );

  const noConfirm = new FormData();
  noConfirm.append('file', new Blob([bytes]), 'restored.dump');
  const unconfirmed = await call('/backup/full/restore', {
    method: 'POST',
    body: noConfirm,
  });
  check(
    'a restore without confirm=true is refused',
    unconfirmed.status === 400,
    unconfirmed.data?.detail ?? `status ${unconfirmed.status}`,
  );

  // ───────────────────────────────────────────────────────── 6. restore
  const upload = new FormData();
  upload.append('confirm', 'true');
  upload.append('file', new Blob([bytes]), 'restored.dump');
  const restored = await call('/backup/full/restore', {
    method: 'POST',
    body: upload,
  });
  check(
    'uploading the dump back restores the database',
    restored.status === 201 && restored.data?.restored === true,
    `${restored.data?.source ?? ''} · safety ${restored.data?.safetyBackup ?? ''}${
      restored.data ? ` · checked ${restored.data.checked}` : ''
    }`,
  );
  check(
    'the restore was rehearsed in a scratch database first',
    restored.data?.rehearsed === true,
    `rehearsed=${restored.data?.rehearsed}`,
  );

  // The program still works after being put back.
  const after = await call('/auth/me');
  check('the program still answers after the restore', after.status === 200, `status ${after.status}`);

  // A whole-database restore puts the audit trail back to what the archive
  // holds, so there is deliberately no "the restore was logged" check here:
  // the entry that recorded it does not survive the very thing it recorded.
  // The reset below is a different matter — it clears audit logs and then
  // writes its own entry, which is the one that has to be findable.

  // ─────────────────────────────────────── 4c. renewing the session
  //
  // A sign-in token is short-lived on purpose. What must not happen is being
  // thrown back to the sign-in screen in the middle of the working day -
  // which is what used to happen: the client kept a refresh token and never
  // spent it, so a quarter of an hour after signing in, every protected
  // screen started answering "Invalid or expired token". Financial Periods
  // was simply where it was noticed.
  const refreshed = await call('/auth/refresh', {
    method: 'POST',
    noAuth: true,
    json: { refreshToken: login.data?.refreshToken ?? '' },
  });
  const secondToken = refreshed.data?.accessToken ?? '';
  check(
    'a spent session is renewed with the refresh token',
    refreshed.status === 201 && secondToken.length > 0,
    `status ${refreshed.status}`,
  );

  if (secondToken) {
    const asSecond = await call('/accounting/fiscal-periods', {
      headers: { Authorization: `Bearer ${secondToken}` },
      noAuth: true,
    });
    check(
      'the renewed token opens the financial periods list',
      asSecond.status === 200,
      `status ${asSecond.status}`,
    );
  }

  // Rotation: the refresh token that was just spent must not work twice.
  const replayed = await call('/auth/refresh', {
    method: 'POST',
    noAuth: true,
    json: { refreshToken: login.data?.refreshToken ?? '' },
  });
  check(
    'a refresh token is spent by being used',
    replayed.status === 401,
    `status ${replayed.status}`,
  );

  const invented = await call('/auth/refresh', {
    method: 'POST',
    noAuth: true,
    json: { refreshToken: 'not-a-real-refresh-token' },
  });
  check(
    'an invented refresh token is refused',
    invented.status === 401,
    `status ${invented.status}`,
  );

  const stale = await call('/accounting/fiscal-periods', {
    headers: { Authorization: 'Bearer not.a.token' },
    noAuth: true,
  });
  check(
    'a token that never was is refused with a sentence, not a crash',
    stale.status === 401 && typeof stale.data?.detail === 'string',
    stale.data?.detail ?? `status ${stale.status}`,
  );

  // ────────────────────────────────────── 5. the everyday screens
  const periods = await call('/accounting/fiscal-periods');
  const periodRows = periods.data?.items ?? periods.data ?? [];
  check(
    'the financial periods list answers',
    periods.status === 200 && Array.isArray(periodRows),
    `${Array.isArray(periodRows) ? periodRows.length : 'not a list'} period(s)`,
  );

  for (const [path, label] of [
    ['/company/profile', 'the company profile'],
    ['/company/branches', 'the company branches'],
    ['/accounting/chart-of-accounts', 'the chart of accounts'],
    ['/parties/customers', 'the customers list'],
    ['/parties/suppliers', 'the suppliers list'],
    ['/inventory/items', 'the items list'],
    ['/sales/invoices', 'the sales invoices'],
    ['/purchases/invoices', 'the purchase invoices'],
    ['/inventory/stock', 'the stock levels'],
    ['/reports/trial-balance', 'the trial balance'],
  ]) {
    const answer = await call(path);
    check(`${label} answers`, answer.status === 200, `status ${answer.status}`);
  }

  const profileRes = await call('/company/profile');
  check(
    'the company profile carries identity and names for the dashboard',
    profileRes.status === 200 &&
      Boolean(profileRes.data?.nameAr || profileRes.data?.nameEn) &&
      Boolean(profileRes.data?.code),
    `code=${profileRes.data?.code}, nameAr=${profileRes.data?.nameAr}`,
  );

  // ──────────────────────────────────── 6. exports, printing, imports
  async function ticketed(path) {
    const minted = await call('/auth/download-ticket', { method: 'POST' });
    return `${path}${path.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(
      minted.data?.ticket ?? '',
    )}`;
  }

  for (const [path, label, expected] of [
    [
      '/exports/trial-balance/download?format=xlsx&lang=ar&from=2026-01-01&to=2026-12-31',
      'a report as a spreadsheet',
      'PK',
    ],
    [
      '/exports/trial-balance/download?format=csv&lang=ar&from=2026-01-01&to=2026-12-31',
      'a report as a CSV that Excel will read as Arabic',
      '﻿',
    ],
    [
      '/exports/lists/fiscal-periods/download?format=xlsx&lang=ar',
      'an everyday list as a spreadsheet',
      'PK',
    ],
    ['/exports/lists/customers/download?format=csv&lang=en', 'a list as a CSV', 'CSV'],
  ]) {
    const answer = await call(await ticketed(path), { noAuth: true });
    // A workbook starts with the zip signature; a CSV starts with the
    // byte-order mark that makes Excel read it as Arabic rather than as
    // gibberish.
    const body =
      answer.data instanceof ArrayBuffer
        ? Buffer.from(answer.data)
        : Buffer.alloc(0);
    const head = body.subarray(0, 2).toString('latin1');
    const startsRight =
      expected === 'PK' ? head === 'PK' : body.subarray(0, 3).toString('utf8') === '﻿';
    check(
      `${label} downloads with the ticket`,
      answer.status === 200 && startsRight,
      `status ${answer.status}, ${body.length} bytes, starts with ${JSON.stringify(head)}`,
    );
    check(
      `${label} arrives as an attachment with a file name`,
      (answer.headers.get('content-disposition') ?? '').includes('attachment'),
      answer.headers.get('content-disposition') ?? 'no header',
    );
  }

  const printPage = await call(
    await ticketed('/exports/trial-balance/print?lang=ar&auto=1&from=2026-01-01&to=2026-12-31'),
    { noAuth: true },
  );
  const printed =
    printPage.data instanceof ArrayBuffer
      ? Buffer.from(printPage.data).toString('utf8')
      : '';
  check(
    'the print page is a real page that prints itself',
    printPage.status === 200 &&
      printed.includes('<html') &&
      printed.includes('print()'),
    `${printed.length} characters`,
  );
  const profile = await call('/company/profile');
  const arabicName = `${profile.data?.nameAr ?? ''}`.trim();
  check(
    'the print page carries the company name in Arabic when asked for Arabic',
    arabicName.length > 0 && printed.includes(arabicName),
    printed.includes(arabicName)
      ? `“${arabicName}” is in the page`
      : `“${arabicName}” is missing from the page`,
  );

  const listPrint = await call(
    await ticketed('/exports/lists/customers/print?lang=ar&auto=1'),
    { noAuth: true },
  );
  check(
    'an everyday list has a print page too',
    listPrint.status === 200,
    `status ${listPrint.status}`,
  );

  const unknownReport = await call(
    await ticketed('/exports/not-a-report/download?format=csv&lang=en'),
    { noAuth: true },
  );
  check(
    'an export that does not exist says so instead of failing quietly',
    unknownReport.status >= 400 && unknownReport.status < 500,
    `status ${unknownReport.status} — ${unknownReport.data?.detail ?? ''}`,
  );

  // The import screen: the file it hands out has to be a file it accepts.
  for (const kind of ['customers', 'suppliers', 'items']) {
    const template = await call(
      await ticketed(`/import/templates/${kind}?lang=en`),
      { noAuth: true },
    );
    const body =
      template.data instanceof ArrayBuffer
        ? Buffer.from(template.data)
        : Buffer.alloc(0);
    check(
      `the ${kind} template downloads as a real workbook`,
      template.status === 200 && body.subarray(0, 2).toString('latin1') === 'PK',
      `${body.length} bytes`,
    );

    const dry = new FormData();
    dry.append(
      'file',
      new Blob([body], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${kind}.xlsx`,
    );
    const read = await fetch(`${API}/import/${kind}?dryRun=true&mode=insert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: dry,
    });
    const report = await read.json().catch(() => null);
    check(
      `the ${kind} template is accepted back exactly as it was downloaded`,
      read.status === 201 &&
        report?.errors?.length === 0 &&
        report?.created === 1,
      `created ${report?.created ?? 0}, errors ${report?.errors?.length ?? -1}`,
    );
  }

  // A dry run must not write, and a bad row must be named by row and column.
  const badRows = new FormData();
  badRows.append(
    'file',
    new Blob(['Code,Name (English),Name (Arabic)\n,No code,بدون\n'], {
      type: 'text/csv',
    }),
    'customers.csv',
  );
  const dryRun = await fetch(
    `${API}/import/customers?dryRun=true&mode=insert`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: badRows },
  );
  const dryReport = await dryRun.json().catch(() => null);
  check(
    'a row that cannot be imported is named by row and column',
    dryRun.status === 201 && dryReport?.errors?.length === 1,
    `${dryReport?.errors?.[0]?.column ?? '?'}: ${dryReport?.errors?.[0]?.message ?? '?'}`,
  );
  const stillEmpty = await call('/parties/customers');
  check(
    'a dry run writes nothing',
    (stillEmpty.data?.items?.length ?? -1) === 0,
    `${stillEmpty.data?.items?.length ?? -1} customer(s)`,
  );

  // ──────────────────────────────────────────────── 7. the company reset
  const preview = await call('/admin/reset');
  check(
    'the reset screen can ask what a reset would remove',
    preview.status === 200 && typeof preview.data?.counts === 'object',
    Object.entries(preview.data?.counts ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(' '),
  );

  const wrongPassword = await call('/admin/reset', {
    method: 'POST',
    json: { password: 'definitely not the password', confirmation: 'RESET' },
  });
  check('a reset with the wrong password is refused', wrongPassword.status === 401, `status ${wrongPassword.status}`);

  const wrongWord = await call('/admin/reset', {
    method: 'POST',
    json: { password: PASSWORD, confirmation: 'reset' },
  });
  check('a reset without the typed confirmation is refused', wrongWord.status === 400, `status ${wrongWord.status}`);

  if (!ALLOW_RESET) {
    console.log(
      '\nSKIP  the destructive reset (set KAYAN_E2E_ALLOW_RESET=1 against a throwaway database)',
    );
  } else {
    // Something has to be there for the reset to have removed. An account is
    // the smallest thing the reset clears that a screen shows afterwards.
    const made = await call('/accounting/chart-of-accounts', {
      method: 'POST',
      json: {
        code: '9001',
        nameEn: 'Reset check account',
        nameAr: 'حساب فحص إعادة الضبط',
        type: 'ASSET',
        isPostable: true,
      },
    });
    check(
      'something exists for the reset to remove',
      made.status === 201,
      `status ${made.status} ${made.data?.code ?? ''}`,
    );

    const before = await call('/accounting/chart-of-accounts');
    const beforeCount = before.data?.items?.length ?? -1;
    const reset = await call('/admin/reset', {
      method: 'POST',
      json: { password: PASSWORD, confirmation: 'RESET' },
    });
    check(
      'the reset clears the company and keeps a verified backup',
      reset.status === 200 && reset.data?.reset === true,
      `${reset.data?.backupFile ?? ''} (${reset.data?.backupEntries ?? 0} objects)`,
    );

    // The two checks that look at the wiped company run after the setup
    // below brings it back and this script signs in again: between the
    // reset and the setup there is no signed-in user to read them with.
    const status = await call('/setup/status', { noAuth: true });
    check(
      'the program asks to be set up again',
      status.status === 200 && status.data?.needsSetup === true,
      JSON.stringify(status.data),
    );

    const setup = await call('/setup/initial', {
      method: 'POST',
      noAuth: true,
      json: {
        companyCode: 'KAYAN',
        companyNameEn: 'Kayan Company',
        companyNameAr: 'شركة كيان',
        adminUsername: USERNAME,
        adminPassword: PASSWORD,
      },
    });
    check(
      'the first-run setup can be completed again',
      setup.status === 201 || setup.status === 200,
      `${setup.data?.companyCode ?? ''} ${setup.data?.adminUsername ?? ''} (status ${setup.status})`,
    );

    const signedInAgain = await call('/auth/login', {
      method: 'POST',
      noAuth: true,
      json: { username: USERNAME, password: PASSWORD },
    });
    check(
      'the administrator can sign in after the reset and setup',
      Boolean(signedInAgain.data?.accessToken),
      `status ${signedInAgain.status}`,
    );
    // Everything after this point acts as the NEW administrator: the token
    // from before the reset names a user and company that no longer exist.
    token = signedInAgain.data?.accessToken ?? token;

    const accounts = await call('/accounting/chart-of-accounts?pageSize=200');
    const itemsAfter = accounts.data?.items ?? [];
    check(
      'the company holds no operational data afterwards',
      accounts.status === 200 &&
        !itemsAfter.some((account) => account.code === '9001'),
      `${beforeCount} accounts before the reset; account 9001 ${
        itemsAfter.some((account) => account.code === '9001')
          ? 'still there'
          : 'gone'
      } (${itemsAfter.length} seeded defaults after setup)`,
    );

    const audit = await call('/admin/audit-logs?pageSize=50');
    const entries = audit.data?.items ?? [];
    check(
      'the reset is in the audit trail, and the password is not',
      entries.some((entry) => entry.action === 'RESET') &&
        !JSON.stringify(entries).includes(PASSWORD),
      `${entries.length} entries`,
    );
  }

  // ─────────────────────────────────────────────────────── reaching it from
  // Another machine on the network. The program runs on one desk and is
  // opened from a tablet or a second desk beside it, and a browser will not
  // let a page read a reply unless the reply names the page's own address.
  {
    const ask = async (origin, init = {}) => {
      const response = await fetch(`${API}/health`, {
        ...init,
        headers: { ...(init.headers ?? {}), Origin: origin },
        redirect: 'manual',
      });
      return {
        status: response.status,
        allowed: response.headers.get('access-control-allow-origin'),
        credentials: response.headers.get('access-control-allow-credentials'),
      };
    };

    for (const origin of [
      'http://192.168.1.42:8080',
      'http://10.0.0.7:3000',
      'http://172.16.4.3:8000',
      'http://kayan-office.local',
    ]) {
      const reply = await ask(origin);
      check(
        `a page opened on the network at ${origin} is allowed in`,
        reply.allowed === origin && reply.credentials === 'true',
        `allow-origin=${reply.allowed ?? 'absent'}, credentials=${reply.credentials ?? 'absent'}`,
      );
    }

    const preflight = await ask('http://192.168.1.42:8080', {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    check(
      'the browser’s own pre-flight for a signed request is answered',
      preflight.status < 400 && preflight.allowed === 'http://192.168.1.42:8080',
      `status ${preflight.status}, allow-origin=${preflight.allowed ?? 'absent'}`,
    );

    // A client that is not a page sends no Origin at all.
    const noOrigin = await fetch(`${API}/health`, { redirect: 'manual' });
    check(
      'a client that sends no Origin (curl, the mobile build) is not turned away',
      noOrigin.status === 200,
      `status ${noOrigin.status}`,
    );
  }

  const failures = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failures.length}/${results.length} checks passed` +
      (failures.length ? ` — FAILED: ${failures.map((f) => f.name).join('; ')}` : ''),
  );
  return failures.length === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error('the check itself broke:', error);
    process.exit(2);
  });
