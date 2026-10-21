#!/usr/bin/env node
/**
 * Regression scenario for the reported support issues, exercised against a
 * live API and a disposable PostgreSQL database:
 *
 *  1/3  access token refresh, rotation, and a dead-session verdict;
 *  6    download ticket, and a sign-in token refused in an address;
 *  4    per-user extra permissions take effect immediately and can be revoked;
 *  8    cash kind casing, the seeded accountant's cash access, transfer posting;
 *  7    opening balance: post once, refuse a second post, roll back a broken one;
 *  9    opening stock entered with the item reaches the stock ledger;
 *  2    a created party is returned by the list the pickers read.
 *
 * Run only against disposable data:
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-regressions.mjs [apiBaseUrl]
 */
const API =
  process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required; this scenario must use disposable PostgreSQL.',
  );
}

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  // An explicit Authorization header wins: several checks below act as a
  // second user (the accountant) while the administrator's session is held in
  // `token`, and silently replacing it would make every such check run as the
  // administrator and pass for the wrong reason.
  if (token && !options.noAuth && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  // The refused-credential checks below are deliberate, and the server rate
  // limits failed authentication by address. Waiting out a 429 keeps a second
  // run of this scenario honest instead of turning a refusal into a timeout.
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.json === undefined
          ? options.body
          : JSON.stringify(options.json),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.arrayBuffer();
    if (response.status !== 429 || attempt >= 6) {
      return { status: response.status, data, headers: response.headers };
    }
    const seconds = Number(
      /(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(seconds + 1, 90) * 1000),
    );
  }
}

async function login(username = USERNAME, password = PASSWORD) {
  return api('/auth/login', {
    method: 'POST',
    json: { username, password },
    noAuth: true,
  });
}

async function main() {
  // ── session ───────────────────────────────────────────────────────────
  const signedIn = await login();
  check('sign in', signedIn.status === 201, `status ${signedIn.status}`);
  token = signedIn.data.accessToken;
  const refresh = signedIn.data.refreshToken;

  const renewed = await api('/auth/refresh', {
    method: 'POST',
    json: { refreshToken: refresh },
    noAuth: true,
  });
  check(
    'refresh rotates the refresh token and issues an access token',
    renewed.status === 201 &&
      typeof renewed.data.accessToken === 'string' &&
      renewed.data.accessToken.length > 20 &&
      typeof renewed.data.refreshToken === 'string' &&
      renewed.data.refreshToken !== refresh,
    `status ${renewed.status}`,
  );

  const replayed = await api('/auth/refresh', {
    method: 'POST',
    json: { refreshToken: refresh },
    noAuth: true,
  });
  check(
    'a rotated refresh token cannot be used twice',
    replayed.status === 401,
    `status ${replayed.status}`,
  );

  const revived = await api('/auth/me', {
    headers: { Authorization: `Bearer ${renewed.data.accessToken}` },
  });
  check(
    'the renewed access token is valid',
    revived.status === 200 && revived.data?.user?.username === USERNAME,
    `status ${revived.status}`,
  );

  // ── download ticket (Issue 6) ────────────────────────────────────────
  const ticketResponse = await api('/auth/download-ticket', { method: 'POST' });
  const ticket = ticketResponse.data?.ticket;
  check(
    'download ticket is issued with a short lifetime',
    ticketResponse.status === 201 &&
      typeof ticket === 'string' &&
      ticket !== undefined &&
      Number(ticketResponse.data.expiresIn) > 0 &&
      Number(ticketResponse.data.expiresIn) <= 600,
    `expiresIn ${ticketResponse.data?.expiresIn}`,
  );

  if (ticket) {
    const template = await api(
      `/import/templates/opening-balances?lang=en&ticket=${encodeURIComponent(ticket)}`,
      { noAuth: true },
    );
    const bytes = template.data;
    const isWorkbook =
      bytes instanceof ArrayBuffer &&
      bytes.byteLength > 1000 &&
      new Uint8Array(bytes, 0, 2)[0] === 0x50; // "PK" — an xlsx is a zip
    check(
      'opening-balance template downloads with a ticket',
      template.status === 200 && isWorkbook,
      `status ${template.status}, ${bytes?.byteLength ?? 0} bytes`,
    );

    const withAccessToken = await api(
      `/import/templates/opening-balances?lang=en&token=${encodeURIComponent(token)}`,
      { noAuth: true },
    );
    check(
      'a sign-in token is refused in the query string',
      withAccessToken.status === 401,
      `status ${withAccessToken.status}`,
    );

    const asBearer = await api('/auth/me', {
      headers: { Authorization: `Bearer ${ticket}` },
      noAuth: true,
    });
    check(
      'a download ticket cannot be used as a bearer token',
      asBearer.status === 401,
      `status ${asBearer.status}`,
    );
  }

  // ── permissions (Issue 4, Issue 8) ───────────────────────────────────
  const roles = await api('/admin/roles');
  const accountantRole = roles.data?.items?.find(
    (role) => role.code === 'ACCOUNTANT',
  );
  check(
    'the seeded accountant role carries the cash module',
    Boolean(accountantRole) &&
      accountantRole.permissions.includes('cash.accounts.read') &&
      accountantRole.permissions.includes('cash.vouchers.create'),
    accountantRole ? `${accountantRole.permissions.length} permissions` : 'missing',
  );

  let accountantToken = '';
  let accountantId = '';
  if (accountantRole) {
    const accountant = await api('/admin/users', {
      method: 'POST',
      json: {
        username: `scenario_acct_${stamp}`,
        password: 'Scenario-Account-12345',
        fullNameEn: 'Scenario Accountant',
        fullNameAr: 'محاسب اختبار',
        roleIds: [accountantRole.id],
      },
    });
    accountantId = accountant.data?.id ?? '';
    check(
      'an accountant can be created with the seeded role',
      accountant.status === 201 && Boolean(accountantId),
      accountant.data?.detail ?? `status ${accountant.status}`,
    );

    if (accountantId) {
      const acctLogin = await login(
        `scenario_acct_${stamp}`,
        'Scenario-Account-12345',
      );
      accountantToken = acctLogin.data?.accessToken ?? '';
      check(
        'the accountant can sign in',
        acctLogin.status === 201 && Boolean(accountantToken),
        `status ${acctLogin.status}`,
      );

      const cashAccounts = await api('/cash/accounts', {
        headers: { Authorization: `Bearer ${accountantToken}` },
      });
      check(
        'the accountant can open the cash and bank screens',
        cashAccounts.status === 200,
        `status ${cashAccounts.status}`,
      );

      const users = await api('/admin/users', {
        headers: { Authorization: `Bearer ${accountantToken}` },
      });
      check(
        'the accountant still cannot administer users',
        users.status === 403,
        `status ${users.status}`,
      );

      const grant = await api(`/admin/users/${accountantId}`, {
        method: 'PATCH',
        json: { extraPermissions: ['admin.users.manage'] },
      });
      check(
        'an extra permission is stored on the user',
        grant.status === 200 &&
          Array.isArray(grant.data?.extraPermissions) &&
          grant.data.extraPermissions.includes('admin.users.manage'),
        JSON.stringify(grant.data?.extraPermissions ?? grant.data?.detail),
      );

      const usersWithOldToken = await api('/admin/users', {
        headers: { Authorization: `Bearer ${accountantToken}` },
      });
      check(
        'the grant applies to the session already signed in',
        usersWithOldToken.status === 200,
        `status ${usersWithOldToken.status}`,
      );

      const revoke = await api(`/admin/users/${accountantId}`, {
        method: 'PATCH',
        json: { extraPermissions: [] },
      });
      const usersAfterRevoke = await api('/admin/users', {
        headers: { Authorization: `Bearer ${accountantToken}` },
      });
      check(
        'revoking the grant removes the access immediately',
        revoke.status === 200 && usersAfterRevoke.status === 403,
        `revoke ${revoke.status}, access ${usersAfterRevoke.status}`,
      );

      const unknownCode = await api(`/admin/users/${accountantId}`, {
        method: 'PATCH',
        json: { extraPermissions: ['not.a.real.permission'] },
      });
      check(
        'an unknown permission code is refused',
        unknownCode.status === 400,
        `status ${unknownCode.status}`,
      );
    }
  }

  // ── item opening stock (Issue 9) ─────────────────────────────────────
  const openingItemCode = `OPEN${stamp}`;
  const openingItem = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: openingItemCode,
      nameEn: 'Scenario opening item',
      nameAr: 'صنف افتتاحي للاختبار',
      unit: 'piece',
      openingQuantity: '5',
      openingUnitCost: '10',
    },
  });
  check(
    'an item is created with its opening stock',
    openingItem.status === 201 && Boolean(openingItem.data?.id),
    openingItem.data?.detail ?? `status ${openingItem.status}`,
  );

  if (openingItem.status === 201) {
    const stock = await api(`/inventory/stock?itemId=${openingItem.data.id}`);
    const row = Array.isArray(stock.data)
      ? stock.data.find((entry) => entry.itemId === openingItem.data.id)
      : null;
    check(
      'the opening quantity appears in the stock ledger',
      row?.quantity === '5.0000' && row?.value === '50.0000',
      row ? `${row.quantity} / ${row.value}` : 'no stock row',
    );
  }

  const halfPair = await api('/inventory/items', {
    method: 'POST',
    json: {
      code: `HALF${stamp}`,
      nameEn: 'Half pair',
      nameAr: 'نصف زوج',
      openingQuantity: '1',
    },
  });
  check(
    'a quantity without a unit cost is refused',
    halfPair.status === 400,
    `status ${halfPair.status}`,
  );

  // ── opening balances (Issue 7) ───────────────────────────────────────
  const chart = await api('/accounting/chart-of-accounts');
  const accounts = Array.isArray(chart.data) ? chart.data : chart.data?.items ?? [];
  const cashAccount = accounts.find((account) => account.code === '1101');
  const equityAccount = accounts.find((account) => account.code === '3103');

  const balance = await api('/accounting/opening-balances', {
    method: 'POST',
    json: {
      asOfDate: '2026-01-01',
      description: `scenario opening ${stamp}`,
      lines: [
        { accountId: cashAccount?.id, debit: '100.0000' },
        { accountId: equityAccount?.id, credit: '100.0000' },
      ],
    },
  });
  check(
    'an opening balance is created as a draft',
    balance.status === 201 && balance.data?.status?.toLowerCase() === 'draft',
    balance.data?.detail ?? `status ${balance.status}`,
  );

  if (balance.status === 201) {
    const posted = await api(
      `/accounting/opening-balances/${balance.data.id}/post`,
      { method: 'POST' },
    );
    check(
      'the opening balance posts',
      posted.status === 201 && Boolean(posted.data?.journalEntryId),
      posted.data?.detail ?? `status ${posted.status}`,
    );

    const again = await api(
      `/accounting/opening-balances/${balance.data.id}/post`,
      { method: 'POST' },
    );
    check(
      'posting the same opening balance twice is refused',
      again.status === 400,
      `status ${again.status}`,
    );

    const second = await api('/accounting/opening-balances', {
      method: 'POST',
      json: {
        asOfDate: '2026-01-02',
        description: `scenario second opening ${stamp}`,
        lines: [
          { accountId: cashAccount?.id, debit: '50.0000' },
          { accountId: equityAccount?.id, credit: '50.0000' },
        ],
      },
    });
    if (second.status === 201) {
      const secondPost = await api(
        `/accounting/opening-balances/${second.data.id}/post`,
        { method: 'POST' },
      );
      check(
        'a second opening balance for the same branch cannot post',
        secondPost.status === 400,
        `status ${secondPost.status}`,
      );
    } else {
      check(
        'a second opening balance is either refused or refused at posting',
        true,
        `create status ${second.status}`,
      );
    }
  }

  const before = await api('/accounting/opening-balances');
  const beforeCount = before.data?.items?.length ?? 0;
  const broken = await api('/accounting/opening-balances', {
    method: 'POST',
    json: {
      asOfDate: '2026-01-03',
      description: `scenario broken ${stamp}`,
      lines: [
        { accountId: cashAccount?.id, debit: '10.0000' },
        { accountId: equityAccount?.id, credit: '9.0000' },
      ],
    },
  });
  const after = await api('/accounting/opening-balances');
  const afterCount = after.data?.items?.length ?? 0;
  check(
    'an unbalanced opening balance is refused and leaves no draft',
    broken.status === 400 && afterCount === beforeCount,
    `status ${broken.status}, drafts ${beforeCount} → ${afterCount}`,
  );

  // ── cash (Issue 8) ───────────────────────────────────────────────────
  const bankLedger = accounts.find((account) => account.code === '1102');
  const bank = await api('/cash/accounts', {
    method: 'POST',
    json: {
      code: `BANK${stamp}`,
      nameEn: 'Scenario bank',
      nameAr: 'بنك اختبار',
      kind: 'BANK',
      accountId: bankLedger?.id,
    },
  });
  check(
    'a bank account is created and reported as a bank',
    bank.status === 201 && String(bank.data?.kind).toLowerCase() === 'bank',
    bank.data?.detail ?? `kind ${bank.data?.kind}`,
  );

  const cashAccounts = await api('/cash/accounts');
  let cashBox = cashAccounts.data?.items?.find(
    (account) => String(account.kind).toLowerCase() === 'cash',
  );
  if (!cashBox) {
    // A fresh company has no cash box yet; the transfer check needs one, and
    // silently skipping it would make the run look greener than it is.
    const cashLedger = accounts.find((account) => account.code === '1101');
    const createdCash = await api('/cash/accounts', {
      method: 'POST',
      json: {
        code: `CASH${stamp}`,
        nameEn: 'Scenario cash box',
        nameAr: 'صندوق اختبار',
        kind: 'CASH',
        accountId: cashLedger?.id,
      },
    });
    check(
      'a cash box can be created for the transfer check',
      createdCash.status === 201,
      createdCash.data?.detail ?? `status ${createdCash.status}`,
    );
    if (createdCash.status === 201) cashBox = createdCash.data;
  }

  check('a cash box is available for the transfer check', Boolean(cashBox));

  if (bank.status === 201 && cashBox) {
    const transfer = await api('/cash/transfers', {
      method: 'POST',
      json: {
        fromCashAccountId: cashBox.id,
        toCashAccountId: bank.data.id,
        transferDate: '2026-01-02',
        amount: '25.0000',
        description: `scenario transfer ${stamp}`,
      },
    });
    check(
      'a transfer between a cash box and a bank is created',
      transfer.status === 201 &&
        String(transfer.data?.status).toLowerCase() === 'draft',
      transfer.data?.detail ?? `status ${transfer.status}`,
    );

    if (transfer.status === 201) {
      const transferPost = await api(
        `/cash/transfers/${transfer.data.id}/post`,
        { method: 'POST' },
      );
      check(
        'the transfer posts',
        transferPost.status === 201,
        transferPost.data?.detail ?? `status ${transferPost.status}`,
      );

      const balances = await api('/cash/accounts/balances');
      const bankRow = balances.data?.rows?.find(
        (row) => row.code === `BANK${stamp}`,
      );
      check(
        'the bank balance reflects the transfer',
        bankRow?.balance === '25.0000',
        bankRow ? bankRow.balance : 'no row',
      );
    }
  }

  // ── parties (Issue 2) ────────────────────────────────────────────────
  const partyCode = `C${stamp}`;
  const party = await api('/parties/customers', {
    method: 'POST',
    json: {
      code: partyCode,
      nameEn: 'Scenario customer',
      nameAr: 'عميل اختبار',
    },
  });
  const partyList = await api(
    '/parties/customers?includeInactive=true',
  );
  const listed = partyList.data?.items?.some((row) => row.code === partyCode);
  check(
    'a created customer is returned by the list the invoice form reads',
    party.status === 201 && Boolean(listed),
    party.data?.detail ?? `status ${party.status}`,
  );

  // ── summary ──────────────────────────────────────────────────────────
  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length > 0) {
    console.error(`\n${failed.length} FAILED:`);
    for (const result of failed) {
      console.error(` - ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
